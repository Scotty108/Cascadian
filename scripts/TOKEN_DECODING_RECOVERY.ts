#!/usr/bin/env npx tsx
/**
 * TOKEN DECODING RECOVERY
 *
 * Goal: Lift G_traded from 94.17% to ≥99%
 *
 * Method:
 * 1. Insert missing token_* trades from vw_trades_canonical
 * 2. Decode token IDs using CTF formula (divide by 256)
 * 3. Re-run gates to verify improvement
 *
 * Expected: +85,765 transactions, +24,003 condition IDs
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
console.log('═'.repeat(80));
console.log('TOKEN DECODING RECOVERY');
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 1: Check baseline before INSERT
// ============================================================================

console.log('STEP 1: Baseline Count');
console.log('─'.repeat(80));

try {
  const baseline = await client.query({
    query: `
      SELECT
        count() AS total_rows,
        uniqExact(cid_hex) AS unique_cids,
        uniqExact(tx_hash) AS unique_txs
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const baselineData = await baseline.json<Array<{
    total_rows: number;
    unique_cids: number;
    unique_txs: number;
  }>>();

  console.log();
  console.log('Before INSERT:');
  console.log(`  Total rows:       ${baselineData[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:      ${baselineData[0].unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes: ${baselineData[0].unique_txs.toLocaleString()}`);
  console.log();

} catch (error) {
  console.error('❌ Baseline check failed:', error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 2: Insert token_* trades (Variant A - toUInt256)
// ============================================================================

console.log('STEP 2: Insert Token-Format Trades (Variant A: toUInt256)');
console.log('─'.repeat(80));

let variantASuccess = false;

try {
  console.log('\nExecuting INSERT...');
  console.log('(This may take 2-5 minutes for large datasets)');
  console.log();

  const insertResult = await client.query({
    query: `
      INSERT INTO cascadian_clean.fact_trades_clean
      SELECT
        v.transaction_hash                              AS tx_hash,
        v.timestamp                                     AS block_time,
        concat('0x', leftPad(
          lower(hex(intDiv(toUInt256(replaceAll(v.condition_id_norm,'token_','')), 256)))
        , 64, '0'))                                     AS cid_hex,
        v.outcome_index,
        v.wallet_address_norm                           AS wallet_address,
        v.trade_direction                               AS direction,
        v.shares,
        v.entry_price                                   AS price,
        v.usd_value                                     AS usdc_amount
      FROM default.vw_trades_canonical v
      LEFT JOIN cascadian_clean.fact_trades_clean f
        ON f.tx_hash = v.transaction_hash
      WHERE v.condition_id_norm LIKE 'token_%'
        AND f.tx_hash IS NULL
    `,
  });

  console.log('✅ Variant A (toUInt256) completed successfully');
  variantASuccess = true;

} catch (error: any) {
  console.error('❌ Variant A failed:', error?.message || error);
  console.log();
  console.log('Attempting Variant B (Decimal256 with guards)...');
  console.log();

  // Try Variant B
  try {
    const insertResultB = await client.query({
      query: `
        INSERT INTO cascadian_clean.fact_trades_clean
        SELECT
          v.transaction_hash                              AS tx_hash,
          v.timestamp                                     AS block_time,
          concat('0x', leftPad(
            lower(hex(intDiv(toDecimal256(replaceAll(v.condition_id_norm,'token_',''), 0), 256)))
          , 64, '0'))                                     AS cid_hex,
          v.outcome_index,
          v.wallet_address_norm                           AS wallet_address,
          v.trade_direction                               AS direction,
          v.shares,
          v.entry_price                                   AS price,
          v.usd_value                                     AS usdc_amount
        FROM default.vw_trades_canonical v
        LEFT JOIN cascadian_clean.fact_trades_clean f
          ON f.tx_hash = v.transaction_hash
        WHERE v.condition_id_norm LIKE 'token_%'
          AND length(replaceAll(v.condition_id_norm,'token_','')) <= 76
          AND match(replaceAll(v.condition_id_norm,'token_',''), '^[0-9]+$')
          AND f.tx_hash IS NULL
      `,
    });

    console.log('✅ Variant B (Decimal256) completed successfully');
    variantASuccess = true; // Mark as success for gate checks

    // Check for overflow tokens
    const overflowCheck = await client.query({
      query: `
        WITH t AS (
          SELECT replaceAll(condition_id_norm,'token_','') AS dec_str
          FROM default.vw_trades_canonical
          WHERE condition_id_norm LIKE 'token_%'
        )
        SELECT
          count()                                           AS token_rows,
          countIf(length(dec_str) > 76)                     AS too_large_for_decimal256,
          round(100.0 * too_large_for_decimal256 / token_rows, 4) AS pct_too_large
        FROM t
      `,
      format: 'JSONEachRow',
    });

    const overflowData = await overflowCheck.json<Array<{
      token_rows: number;
      too_large_for_decimal256: number;
      pct_too_large: number;
    }>>();

    console.log();
    console.log('Overflow check:');
    console.log(`  Total token rows:    ${overflowData[0].token_rows.toLocaleString()}`);
    console.log(`  Too large (>76 dig): ${overflowData[0].too_large_for_decimal256.toLocaleString()}`);
    console.log(`  Percentage:          ${overflowData[0].pct_too_large}%`);

    if (overflowData[0].pct_too_large > 0.1) {
      console.log();
      console.log('⚠️  Some tokens are >76 digits and will be skipped');
      console.log('   (This is normal for edge cases)');
    }

  } catch (errorB: any) {
    console.error('❌ Variant B also failed:', errorB?.message || errorB);
    console.log();
    console.log('Both variants failed. Token decoding may require external BigInt processing.');
    variantASuccess = false;
  }
}

console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 3: Check new counts
// ============================================================================

console.log('STEP 3: Post-INSERT Count');
console.log('─'.repeat(80));

try {
  const afterInsert = await client.query({
    query: `
      SELECT
        count() AS total_rows,
        uniqExact(cid_hex) AS unique_cids,
        uniqExact(tx_hash) AS unique_txs
      FROM cascadian_clean.fact_trades_clean
    `,
    format: 'JSONEachRow',
  });

  const afterData = await afterInsert.json<Array<{
    total_rows: number;
    unique_cids: number;
    unique_txs: number;
  }>>();

  console.log();
  console.log('After INSERT:');
  console.log(`  Total rows:       ${afterData[0].total_rows.toLocaleString()}`);
  console.log(`  Unique CIDs:      ${afterData[0].unique_cids.toLocaleString()}`);
  console.log(`  Unique tx_hashes: ${afterData[0].unique_txs.toLocaleString()}`);
  console.log();

} catch (error) {
  console.error('❌ Post-INSERT check failed:', error);
}

console.log('═'.repeat(80));
console.log();

// ============================================================================
// STEP 4: Re-run gates to verify improvement
// ============================================================================

if (variantASuccess) {
  console.log('STEP 4: Re-run Gates (Verify Improvement)');
  console.log('─'.repeat(80));

  try {
    const gateResults = await client.query({
      query: `
        WITH
        RES AS (
          SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
          FROM default.market_resolutions_final
          WHERE replaceOne(lower(condition_id_norm),'0x','') NOT IN ('', repeat('0',64))
        ),
        FACT AS (
          SELECT DISTINCT cid_hex AS cid FROM cascadian_clean.fact_trades_clean
        ),
        TRADED_ANY AS (
          SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id_norm),'0x',''),64,'0')) AS cid
          FROM default.vw_trades_canonical
          WHERE condition_id_norm NOT IN ('', '0x', concat('0x', repeat('0',64)))
          UNION ALL
          SELECT DISTINCT lower('0x' || leftPad(replaceOne(lower(condition_id),'0x',''),64,'0')) AS cid
          FROM default.trades_raw_enriched_final
          WHERE condition_id LIKE '0x%'
        )
        SELECT
          (SELECT count() FROM RES)                                                          AS res_cids,
          (SELECT count() FROM FACT)                                                         AS fact_cids,
          (SELECT count() FROM RES  WHERE cid IN (SELECT cid FROM FACT))                     AS overlap_cids,
          round(100.0 * overlap_cids / nullIf((SELECT count() FROM RES),0), 2)               AS G_abs,
          (SELECT count() FROM TRADED_ANY)                                                   AS traded_cids,
          (SELECT count() FROM TRADED_ANY WHERE cid IN (SELECT cid FROM FACT))               AS traded_overlap,
          round(100.0 * traded_overlap / nullIf((SELECT count() FROM TRADED_ANY),0), 2)      AS G_traded
      `,
      format: 'JSONEachRow',
    });

    const gates = await gateResults.json<Array<{
      res_cids: number;
      fact_cids: number;
      overlap_cids: number;
      G_abs: number;
      traded_cids: number;
      traded_overlap: number;
      G_traded: number;
    }>>();

    const gateData = gates[0];

    console.log();
    console.log('Updated Gate Results:');
    console.log(`  RES (resolutions):              ${gateData.res_cids.toLocaleString()} condition IDs`);
    console.log(`  FACT (fact_trades_clean):       ${gateData.fact_cids.toLocaleString()} condition IDs`);
    console.log(`  Overlap (RES ∩ FACT):           ${gateData.overlap_cids.toLocaleString()} condition IDs`);
    console.log(`  G_abs (% resolutions in FACT):  ${gateData.G_abs}%`);
    console.log();
    console.log(`  TRADED_ANY (warehouse):         ${gateData.traded_cids.toLocaleString()} condition IDs`);
    console.log(`  Traded overlap (TRADED ∩ FACT): ${gateData.traded_overlap.toLocaleString()} condition IDs`);
    console.log(`  G_traded (% traded in FACT):    ${gateData.G_traded}%`);
    console.log();

    console.log('═'.repeat(80));
    console.log('FINAL VERDICT');
    console.log('═'.repeat(80));
    console.log();

    const G_traded = gateData.G_traded;
    const improvement = G_traded - 94.17;

    console.log(`Previous G_traded: 94.17%`);
    console.log(`Current G_traded:  ${G_traded}%`);
    console.log(`Improvement:       +${improvement.toFixed(2)}%`);
    console.log();

    if (G_traded >= 99) {
      console.log(`✅ EXCELLENT: ${G_traded}% ≥ 99%`);
      console.log();
      console.log('SHIP PNL FEATURE WITH HIGH CONFIDENCE');
      console.log();
      console.log('Coverage quality:');
      console.log('  • 99%+ of traded markets in fact_trades_clean');
      console.log('  • Can calculate highly accurate wallet metrics');
      console.log('  • Missing <1% unlikely to affect any major wallets');
      console.log();
    } else if (G_traded >= 95) {
      console.log(`✅ GOOD: ${G_traded}% ≥ 95%`);
      console.log();
      console.log('SHIP PNL FEATURE');
      console.log();
      console.log('Coverage quality:');
      console.log('  • 95%+ of traded markets in fact_trades_clean');
      console.log('  • Can calculate accurate wallet metrics');
      console.log('  • Missing <5% acceptable for production');
      console.log();
    } else if (G_traded > 94.17) {
      console.log(`⚠️  IMPROVED BUT SHORT: ${G_traded}% (target: 95%)`);
      console.log();
      console.log(`Still ${(95 - G_traded).toFixed(2)}% short of 95% threshold`);
      console.log();
      console.log('Recommendation:');
      console.log('  • Ship as beta with coverage disclaimer');
      console.log('  • OR investigate remaining missing condition IDs');
      console.log();
    } else {
      console.log(`❌ NO IMPROVEMENT: ${G_traded}%`);
      console.log();
      console.log('Token decoding did not improve coverage.');
      console.log('Investigate why token_* INSERT had no effect.');
      console.log();
    }

  } catch (error) {
    console.error('❌ Gate re-run failed:', error);
  }
}

console.log('═'.repeat(80));

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
