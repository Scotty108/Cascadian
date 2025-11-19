#!/usr/bin/env tsx
/**
 * P&L Calculation System - Complete Implementation
 *
 * This script implements the corrected P&L calculation system that:
 * 1. Creates materialized bridge table (NOT a view) to avoid evaluation order issues
 * 2. Uses LEFT-PADDING for CTF IDs (62 chars → 64 chars with leading zeros)
 * 3. Aggregates at token level before collapsing to condition level
 * 4. Validates results against target wallet ($87,030.51 ± 2%)
 *
 * Expected outcome: Close the $72K gap (from $14,262 to ~$87,030)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const TARGET_PNL = 87030.51;
const VARIANCE_THRESHOLD = 2.0; // ±2%

interface ValidationResult {
  step: string;
  status: '✅' | '❌';
  details: string;
  metric?: number;
}

const results: ValidationResult[] = [];

// Initialize ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function executeSQL(sql: string, description: string): Promise<boolean> {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📋 ${description}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    await clickhouse.command({ query: sql });
    console.log(`✅ Success: ${description}`);
    results.push({ step: description, status: '✅', details: 'Created successfully' });
    return true;
  } catch (error: any) {
    console.error(`❌ Failed: ${description}`);
    console.error(`Error: ${error.message}`);
    results.push({ step: description, status: '❌', details: error.message });
    return false;
  }
}

async function getRowCount(table: string): Promise<number> {
  const result = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${table}`,
    format: 'JSONEachRow',
  });
  const rows = await result.json<{ cnt: string }>();
  return parseInt(rows[0].cnt);
}

async function step1_createBridgeTable(): Promise<boolean> {
  const sql = `
CREATE TABLE IF NOT EXISTS ctf_to_market_bridge_mat
(
  condition_id_ctf    FixedString(64),
  condition_id_market FixedString(64)
)
ENGINE = ReplacingMergeTree
ORDER BY condition_id_ctf
AS
SELECT
  lower(concat(repeat('0', 64 - length(hex(bitShiftRight(toUInt256(asset_id), 8)))),
               hex(bitShiftRight(toUInt256(asset_id), 8))))            AS condition_id_ctf,
  anyHeavy(lower(replaceAll(condition_id, '0x','')))                   AS condition_id_market
FROM
(
  SELECT condition_id, asset_id
  FROM clob_fills
  WHERE asset_id NOT IN ('asset','')
) f
GROUP BY condition_id_ctf;
`;

  const success = await executeSQL(sql, 'Step 1: Create Materialized Bridge Table');

  if (success) {
    const count = await getRowCount('ctf_to_market_bridge_mat');
    console.log(`📊 Bridge table contains ${count.toLocaleString()} CTF→Market mappings`);
    results[results.length - 1].metric = count;
  }

  return success;
}

async function step2_createWinnersView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW winners_ctf AS
SELECT b.condition_id_ctf, r.payout_numerators, r.payout_denominator
FROM market_resolutions_final r
JOIN ctf_to_market_bridge_mat b
  ON b.condition_id_market = r.condition_id_norm
WHERE length(r.payout_numerators) > 0 AND r.payout_denominator > 0;
`;

  const success = await executeSQL(sql, 'Step 2: Create Winners View');

  if (success) {
    const count = await getRowCount('winners_ctf');
    console.log(`📊 Winners view contains ${count.toLocaleString()} resolved conditions`);
    results[results.length - 1].metric = count;
  }

  return success;
}

async function step3_createPerSharePayoutView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW token_per_share_payout AS
SELECT
  condition_id_ctf,
  arrayMap(i -> toFloat64(payout_numerators[i]) / nullIf(toFloat64(payout_denominator), 0.0),
           arrayEnumerate(payout_numerators)) AS pps
FROM winners_ctf;
`;

  return await executeSQL(sql, 'Step 3: Create Token Per-Share Payout View');
}

async function step4_createWalletTokenFlowsView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW wallet_token_flows AS
SELECT
  lower(coalesce(cf.user_eoa, cf.proxy_wallet)) AS wallet,
  lower(concat(repeat('0', 64 - length(hex(bitShiftRight(toUInt256(cf.asset_id), 8)))),
               hex(bitShiftRight(toUInt256(cf.asset_id), 8))))        AS condition_id_ctf,
  toUInt16(bitAnd(toUInt256(cf.asset_id), 255))                       AS index_set_mask,
  sumIf(toFloat64(cf.size)/1e6,  cf.side='BUY')
    - sumIf(toFloat64(cf.size)/1e6,  cf.side='SELL')                  AS net_shares,
  sumIf(-toFloat64(cf.size)/1e6*toFloat64(cf.price), cf.side='BUY')
    + sumIf( toFloat64(cf.size)/1e6*toFloat64(cf.price), cf.side='SELL') AS gross_cf,
  sum(toFloat64(cf.size)/1e6*toFloat64(cf.price)
      * coalesce(cf.fee_rate_bps,0)/10000.0)                          AS fees
FROM
(
  SELECT *
  FROM clob_fills
  WHERE asset_id NOT IN ('asset','')
) cf
GROUP BY wallet, condition_id_ctf, index_set_mask;
`;

  return await executeSQL(sql, 'Step 4: Create Wallet Token Flows View');
}

async function step5_createTokenLevelPnLView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW wallet_condition_pnl_token AS
SELECT
  f.wallet, f.condition_id_ctf, f.index_set_mask,
  f.net_shares, f.gross_cf, f.fees,
  if(length(t.pps) > 0,
     arraySum(arrayMap(j ->
       if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
          coalesce(arrayElement(t.pps, j), 0.0), 0.0),
       arrayEnumerate(t.pps))) * f.net_shares,
     0.0)                                                       AS realized_payout,
  f.gross_cf
  + if(length(t.pps) > 0,
       arraySum(arrayMap(j ->
         if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
            coalesce(arrayElement(t.pps, j), 0.0), 0.0),
         arrayEnumerate(t.pps))) * f.net_shares,
       0.0)                                                     AS pnl_gross,
  f.gross_cf - f.fees
  + if(length(t.pps) > 0,
       arraySum(arrayMap(j ->
         if(bitAnd(f.index_set_mask, bitShiftLeft(1, j-1))>0,
            coalesce(arrayElement(t.pps, j), 0.0), 0.0),
         arrayEnumerate(t.pps))) * f.net_shares,
       0.0)                                                     AS pnl_net
FROM wallet_token_flows f
LEFT JOIN token_per_share_payout t USING (condition_id_ctf);
`;

  return await executeSQL(sql, 'Step 5: Create Token-Level P&L View');
}

async function step6_createConditionLevelPnLView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW wallet_condition_pnl AS
SELECT wallet, condition_id_ctf,
       sum(gross_cf) AS gross_cf, sum(fees) AS fees,
       sum(realized_payout) AS realized_payout,
       sum(pnl_gross) AS pnl_gross, sum(pnl_net) AS pnl_net
FROM wallet_condition_pnl_token
GROUP BY wallet, condition_id_ctf;
`;

  return await executeSQL(sql, 'Step 6: Create Condition-Level P&L View');
}

async function step7_createWalletLevelPnLView(): Promise<boolean> {
  const sql = `
CREATE OR REPLACE VIEW wallet_realized_pnl AS
SELECT wallet,
       round(sum(pnl_gross),2) AS pnl_gross,
       round(sum(pnl_net),2)   AS pnl_net
FROM wallet_condition_pnl
GROUP BY wallet;
`;

  return await executeSQL(sql, 'Step 7: Create Wallet-Level P&L View');
}

async function validation1_bridgeUniqueness(): Promise<boolean> {
  console.log(`\n🔍 Validation 1: Bridge Uniqueness Check`);

  const result = await clickhouse.query({
    query: `
      SELECT
        count() AS total_ctf_ids,
        count(DISTINCT condition_id_market) AS unique_markets,
        unique_markets * 100.0 / total_ctf_ids AS pct_unique
      FROM ctf_to_market_bridge_mat
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ total_ctf_ids: string; unique_markets: string; pct_unique: string }>();
  const data = rows[0];

  const pctUnique = parseFloat(data.pct_unique);
  const passed = pctUnique >= 95.0; // Allow 5% variance for edge cases

  console.log(`  Total CTF IDs: ${parseInt(data.total_ctf_ids).toLocaleString()}`);
  console.log(`  Unique Markets: ${parseInt(data.unique_markets).toLocaleString()}`);
  console.log(`  Uniqueness: ${pctUnique.toFixed(2)}%`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (Expected ≥95%)`);

  results.push({
    step: 'Validation 1: Bridge Uniqueness',
    status: passed ? '✅' : '❌',
    details: `${pctUnique.toFixed(2)}% unique (expected ≥95%)`,
    metric: pctUnique,
  });

  return passed;
}

async function validation2_decodeIntegrity(): Promise<boolean> {
  console.log(`\n🔍 Validation 2: Decode Integrity Check`);

  const result = await clickhouse.query({
    query: `
      WITH dec AS (
        SELECT
          lower(hex(toUInt256(asset_id))) AS token_hex,
          lower(concat(repeat('0', 64 - length(hex(bitShiftRight(toUInt256(asset_id), 8)))),
                       hex(bitShiftRight(toUInt256(asset_id), 8)))) AS ctf_hex,
          lower(lpad(hex(bitAnd(toUInt256(asset_id),255)), 2, '0')) AS mask_hex
        FROM clob_fills WHERE asset_id NOT IN ('asset','') LIMIT 10000
      )
      SELECT count() n, countIf(token_hex = concat(ctf_hex, mask_hex)) ok, ok*100.0/n pct_ok FROM dec
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ n: string; ok: string; pct_ok: string }>();
  const data = rows[0];

  const pctOk = parseFloat(data.pct_ok);
  const passed = pctOk >= 99.0;

  console.log(`  Samples tested: ${parseInt(data.n).toLocaleString()}`);
  console.log(`  Correct decodes: ${parseInt(data.ok).toLocaleString()}`);
  console.log(`  Success rate: ${pctOk.toFixed(2)}%`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (Expected ≥99%)`);

  results.push({
    step: 'Validation 2: Decode Integrity',
    status: passed ? '✅' : '❌',
    details: `${pctOk.toFixed(2)}% correct (expected ≥99%)`,
    metric: pctOk,
  });

  return passed;
}

async function validation3_noNaNs(): Promise<boolean> {
  console.log(`\n🔍 Validation 3: No NaNs Check`);

  const result = await clickhouse.query({
    query: `SELECT countIf(isNaN(pnl_net)) AS nan_count FROM wallet_condition_pnl`,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ nan_count: string }>();
  const nanCount = parseInt(rows[0].nan_count);
  const passed = nanCount === 0;

  console.log(`  NaN values found: ${nanCount}`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (Expected 0)`);

  results.push({
    step: 'Validation 3: No NaNs',
    status: passed ? '✅' : '❌',
    details: `${nanCount} NaN values (expected 0)`,
    metric: nanCount,
  });

  return passed;
}

async function validation4_coverage(): Promise<boolean> {
  console.log(`\n🔍 Validation 4: Coverage Check (Target Wallet)`);

  const result = await clickhouse.query({
    query: `
      SELECT
        count() AS total_tokens,
        countIf(t.condition_id_ctf IS NULL) AS tokens_without_resolution,
        tokens_without_resolution * 100.0 / total_tokens AS pct_missing
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t USING (condition_id_ctf)
      WHERE lower(f.wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ total_tokens: string; tokens_without_resolution: string; pct_missing: string }>();
  const data = rows[0];

  const pctMissing = parseFloat(data.pct_missing);
  const passed = pctMissing <= 5.0; // Allow up to 5% missing (unresolved markets)

  console.log(`  Total tokens: ${parseInt(data.total_tokens).toLocaleString()}`);
  console.log(`  Missing resolutions: ${parseInt(data.tokens_without_resolution).toLocaleString()}`);
  console.log(`  Missing %: ${pctMissing.toFixed(2)}%`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (Expected ≤5%)`);

  results.push({
    step: 'Validation 4: Coverage',
    status: passed ? '✅' : '❌',
    details: `${pctMissing.toFixed(2)}% missing (expected ≤5%)`,
    metric: pctMissing,
  });

  return passed;
}

async function validation5_targetWallet(): Promise<boolean> {
  console.log(`\n🔍 Validation 5: Target Wallet P&L Check`);

  const result = await clickhouse.query({
    query: `
      SELECT
        pnl_gross,
        pnl_net,
        ${TARGET_PNL} AS dome_target,
        (pnl_net - ${TARGET_PNL}) AS delta,
        (pnl_net - ${TARGET_PNL}) * 100.0 / ${TARGET_PNL} AS variance_pct
      FROM wallet_realized_pnl
      WHERE lower(wallet) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{
    pnl_gross: string;
    pnl_net: string;
    dome_target: string;
    delta: string;
    variance_pct: string;
  }>();

  if (rows.length === 0) {
    console.log(`  ❌ ERROR: Target wallet not found in results!`);
    results.push({
      step: 'Validation 5: Target Wallet P&L',
      status: '❌',
      details: 'Wallet not found in results',
      metric: 0,
    });
    return false;
  }

  const data = rows[0];
  const pnlGross = parseFloat(data.pnl_gross);
  const pnlNet = parseFloat(data.pnl_net);
  const delta = parseFloat(data.delta);
  const variancePct = parseFloat(data.variance_pct);

  const passed = Math.abs(variancePct) <= VARIANCE_THRESHOLD;

  console.log(`  Target P&L (DOME baseline): $${TARGET_PNL.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`  Calculated P&L (gross): $${pnlGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`  Calculated P&L (net): $${pnlNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`  Delta: $${delta.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
  console.log(`  Variance: ${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(2)}%`);
  console.log(`  Status: ${passed ? '✅ PASS' : '❌ FAIL'} (Expected ±${VARIANCE_THRESHOLD}%)`);

  results.push({
    step: 'Validation 5: Target Wallet P&L',
    status: passed ? '✅' : '❌',
    details: `$${pnlNet.toLocaleString()} (${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(2)}% variance)`,
    metric: pnlNet,
  });

  return passed;
}

async function printFinalReport(): Promise<void> {
  console.log(`\n`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`                    FINAL IMPLEMENTATION REPORT                 `);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(``);

  console.log(`📊 IMPLEMENTATION STEPS:`);
  console.log(`─────────────────────────────────────────────────────────────`);

  const implementationSteps = results.filter(r => r.step.startsWith('Step'));
  implementationSteps.forEach(r => {
    console.log(`${r.status} ${r.step}`);
    if (r.metric) {
      console.log(`   ${r.metric.toLocaleString()} rows`);
    }
  });

  console.log(``);
  console.log(`🔍 VALIDATION RESULTS:`);
  console.log(`─────────────────────────────────────────────────────────────`);

  const validationSteps = results.filter(r => r.step.startsWith('Validation'));
  validationSteps.forEach(r => {
    console.log(`${r.status} ${r.step}`);
    console.log(`   ${r.details}`);
  });

  const allPassed = results.every(r => r.status === '✅');
  const implementationPassed = implementationSteps.every(r => r.status === '✅');
  const validationPassed = validationSteps.every(r => r.status === '✅');

  console.log(``);
  console.log(`═══════════════════════════════════════════════════════════════`);
  if (allPassed) {
    console.log(`                    ✅ OVERALL: SUCCESS                         `);
    console.log(`                                                               `);
    console.log(`  All implementation steps completed successfully.             `);
    console.log(`  All validation checks passed.                                `);
    console.log(`  P&L gap has been closed to within ±${VARIANCE_THRESHOLD}% of target.         `);
  } else {
    console.log(`                    ❌ OVERALL: FAILURE                         `);
    console.log(`                                                               `);
    if (!implementationPassed) {
      console.log(`  ⚠️  Some implementation steps failed.                       `);
    }
    if (!validationPassed) {
      console.log(`  ⚠️  Some validation checks failed.                          `);
    }
  }
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(``);

  // Find target wallet result
  const targetWalletResult = validationSteps.find(r => r.step === 'Validation 5: Target Wallet P&L');
  if (targetWalletResult && targetWalletResult.metric) {
    const improvement = targetWalletResult.metric - 14262;
    const improvementPct = (improvement / 14262) * 100;

    console.log(`💰 P&L IMPROVEMENT SUMMARY:`);
    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(`  Previous P&L:        $14,262.00`);
    console.log(`  New P&L:             $${targetWalletResult.metric.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`  Target P&L:          $${TARGET_PNL.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    console.log(`  Improvement:         $${improvement.toLocaleString(undefined, { minimumFractionDigits: 2 })} (+${improvementPct.toFixed(1)}%)`);
    console.log(`─────────────────────────────────────────────────────────────`);
    console.log(``);
  }
}

async function main() {
  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`║       P&L CALCULATION SYSTEM - COMPLETE IMPLEMENTATION        ║`);
  console.log(`╚═══════════════════════════════════════════════════════════════╝`);
  console.log(``);
  console.log(`🎯 Target: Close $72K P&L gap`);
  console.log(`   From: $14,262 → To: $87,030.51 (±2%)`);
  console.log(``);

  try {
    // Implementation Steps
    console.log(`\n▶️  PHASE 1: IMPLEMENTATION`);
    console.log(`════════════════════════════════════════════════════════════════`);

    await step1_createBridgeTable();
    await step2_createWinnersView();
    await step3_createPerSharePayoutView();
    await step4_createWalletTokenFlowsView();
    await step5_createTokenLevelPnLView();
    await step6_createConditionLevelPnLView();
    await step7_createWalletLevelPnLView();

    // Validation Steps
    console.log(`\n▶️  PHASE 2: VALIDATION`);
    console.log(`════════════════════════════════════════════════════════════════`);

    await validation1_bridgeUniqueness();
    await validation2_decodeIntegrity();
    await validation3_noNaNs();
    await validation4_coverage();
    await validation5_targetWallet();

    // Final Report
    await printFinalReport();

    // Exit with appropriate code
    const allPassed = results.every(r => r.status === '✅');
    process.exit(allPassed ? 0 : 1);

  } catch (error: any) {
    console.error(`\n❌ CRITICAL ERROR: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await clickhouse.close();
  }
}

main();
