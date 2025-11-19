#!/usr/bin/env npx tsx
/**
 * COMPLETE FIX: Token→Condition Bridge + NULL for Unresolved
 *
 * Steps:
 * 0. Quick fix: NULL for unresolved positions
 * 1. Build token→condition bridge from trades_raw_enriched_final
 * 2. Rekey resolutions to condition_id
 * 3. Create unified vw_resolutions_all
 * 4. Rebuild PnL views
 * 5. Coverage check
 * 6. Parity checks
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,
});

async function main() {
console.log('═'.repeat(80));
console.log('COMPLETE FIX: TOKEN→CONDITION BRIDGE + PNL VIEWS');
console.log('═'.repeat(80));
console.log();

// =============================================================================
// STEP 1: Build token→condition bridge
// =============================================================================
console.log('Step 1: Building token→condition bridge from trades_raw_enriched_final...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE TABLE IF NOT EXISTS cascadian_clean.token_to_cid_bridge
    ENGINE = AggregatingMergeTree()
    ORDER BY (token_hex, cid_hex) AS
    WITH raw AS (
      SELECT
        toUInt256(replaceAll(lower(condition_id),'token_','')) AS token_num
      FROM default.trades_raw_enriched_final
      WHERE lower(condition_id) LIKE 'token_%'
        AND match(replaceAll(lower(condition_id),'token_',''),'^[0-9]+$')
    ),
    mapped AS (
      SELECT
        lower(concat('0x', leftPad(hex(token_num),64,'0')))                   AS token_hex,
        lower(concat('0x', leftPad(hex(intDiv(token_num, 256)),64,'0')))      AS cid_hex,
        toUInt16(modulo(token_num, 256))                                      AS outcome_index
      FROM raw
    )
    SELECT
      token_hex,
      anyHeavy(cid_hex)        AS cid_hex,
      anyHeavy(outcome_index)  AS outcome_index
    FROM mapped
    GROUP BY token_hex
  `,
  clickhouse_settings: {
    max_execution_time: 600,
  }
});

const bridgeCount = await client.query({
  query: 'SELECT count() AS c FROM cascadian_clean.token_to_cid_bridge',
  format: 'JSONEachRow',
});
const bridgeRows = (await bridgeCount.json<Array<{ c: number }>>())[0].c;
console.log(`✅ Bridge created: ${bridgeRows.toLocaleString()} mappings`);
console.log();

// =============================================================================
// STEP 2: Rekey resolutions to condition_id
// =============================================================================
console.log('Step 2: Rekeying resolutions to condition_id...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE OR REPLACE TABLE cascadian_clean.resolutions_by_cid
    ENGINE = ReplacingMergeTree()
    ORDER BY (cid_hex) AS
    SELECT
      b.cid_hex,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator,
      r.resolved_at
    FROM default.market_resolutions_final r
    JOIN cascadian_clean.token_to_cid_bridge b
      ON b.token_hex = lower(concat('0x', leftPad(replaceOne(lower(r.condition_id_norm),'0x',''),64,'0')))
    WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0
  `,
  clickhouse_settings: {
    max_execution_time: 600,
  }
});

const resCount = await client.query({
  query: 'SELECT count() AS c FROM cascadian_clean.resolutions_by_cid',
  format: 'JSONEachRow',
});
const resRows = (await resCount.json<Array<{ c: number }>>())[0].c;
console.log(`✅ Rekeyed resolutions: ${resRows.toLocaleString()} markets`);
console.log();

// =============================================================================
// STEP 3: Create unified vw_resolutions_all
// =============================================================================
console.log('Step 3: Creating vw_resolutions_all...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_all AS
    SELECT * FROM cascadian_clean.resolutions_by_cid
  `
});

console.log('✅ vw_resolutions_all created');
console.log();

// =============================================================================
// STEP 4: Rebuild vw_wallet_positions with NULL for unresolved
// =============================================================================
console.log('Step 4: Rebuilding vw_wallet_positions (NULL for unresolved)...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_positions AS
    WITH resolutions AS (
      SELECT
        cid_hex,
        winning_index,
        payout_numerators,
        payout_denominator
      FROM cascadian_clean.vw_resolutions_all
    )
    SELECT
      COALESCE(m.user_wallet, f.wallet_address) AS wallet_remapped,
      f.wallet_address,
      f.cid_hex,
      f.outcome_index,
      f.direction,
      sum(f.shares) AS total_shares,
      avg(f.price)  AS avg_entry_price,
      sum(f.usdc_amount) AS total_cost_basis,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator,
      multiIf(
        r.winning_index IS NOT NULL AND f.outcome_index = r.winning_index,
          toFloat64(total_shares) * (
            toFloat64(arrayElement(r.payout_numerators, f.outcome_index + 1))
            / NULLIF(toFloat64(r.payout_denominator), 0)
          ) - toFloat64(total_cost_basis),
        r.winning_index IS NOT NULL,
          -toFloat64(total_cost_basis),
        NULL
      ) AS realized_pnl_usd,
      r.winning_index IS NOT NULL AS is_resolved
    FROM cascadian_clean.fact_trades_clean f
    LEFT JOIN cascadian_clean.system_wallet_map m
      ON m.system_wallet = f.wallet_address
    LEFT JOIN resolutions r
      ON r.cid_hex = f.cid_hex
    GROUP BY wallet_remapped, f.wallet_address, f.cid_hex, f.outcome_index,
             f.direction, r.winning_index, r.payout_numerators, r.payout_denominator
  `
});

console.log('✅ vw_wallet_positions rebuilt');
console.log();

// =============================================================================
// STEP 5: Rebuild vw_wallet_metrics
// =============================================================================
console.log('Step 5: Rebuilding vw_wallet_metrics...');
console.log('─'.repeat(80));

await client.command({
  query: `
    CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_metrics AS
    SELECT
      wallet_remapped AS wallet,
      countIf(is_resolved)                               AS resolved_positions,
      sumIf(realized_pnl_usd, is_resolved)               AS pnl_usd,
      avgIf(realized_pnl_usd, is_resolved)               AS avg_pnl_usd,
      sumIf(realized_pnl_usd > 0, is_resolved)           AS wins,
      sumIf(realized_pnl_usd <= 0, is_resolved)          AS losses,
      round(100.0 * wins / NULLIF(wins + losses, 0), 2)  AS win_rate_pct
    FROM cascadian_clean.vw_wallet_positions
    GROUP BY wallet
  `
});

console.log('✅ vw_wallet_metrics rebuilt');
console.log();

// =============================================================================
// STEP 6: Coverage check
// =============================================================================
console.log('Step 6: Coverage check...');
console.log('─'.repeat(80));

const coverage = await client.query({
  query: `
    WITH fact AS (SELECT DISTINCT cid_hex FROM cascadian_clean.fact_trades_clean),
         res  AS (SELECT DISTINCT cid_hex FROM cascadian_clean.vw_resolutions_all)
    SELECT
      (SELECT count() FROM fact) AS traded_cids,
      (SELECT count() FROM res)  AS resolution_cids,
      (SELECT count() FROM fact WHERE cid_hex IN (SELECT cid_hex FROM res)) AS joined,
      round(100.0 * joined / traded_cids, 2) AS coverage_pct
  `,
  format: 'JSONEachRow',
});

const cov = (await coverage.json<Array<{
  traded_cids: number;
  resolution_cids: number;
  joined: number;
  coverage_pct: number;
}>>())[0];

console.log();
console.log('Resolution Coverage:');
console.log(`  Traded CIDs:      ${cov.traded_cids.toLocaleString()}`);
console.log(`  Resolution CIDs:  ${cov.resolution_cids.toLocaleString()}`);
console.log(`  Matched:          ${cov.joined.toLocaleString()}`);
console.log(`  Coverage:         ${cov.coverage_pct}%`);
console.log();

if (cov.coverage_pct > 95) {
  console.log('✅✅✅ EXCELLENT! Coverage >95%!');
} else if (cov.coverage_pct > 75) {
  console.log('✅ GOOD! Coverage >75%');
} else if (cov.coverage_pct > 50) {
  console.log('⚠️  MODERATE: Coverage >50% but may need API backfill');
} else {
  console.log('❌ LOW: Need API backfill for remaining markets');
}

console.log();

// =============================================================================
// STEP 7: Parity checks against test wallets
// =============================================================================
console.log('Step 7: Parity checks against test wallets...');
console.log('─'.repeat(80));

const wallets = [
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663, ui_gains: 145976, ui_losses: 8313 },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492, ui_gains: 366546, ui_losses: 6054 },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730, ui_gains: 205410, ui_losses: 110680 },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171, ui_gains: 16715, ui_losses: 4544 },
];

const parity = await client.query({
  query: `
    SELECT
      wallet_remapped AS wallet,
      sumIf(realized_pnl_usd, realized_pnl_usd > 0 AND is_resolved) AS total_gains,
      -sumIf(realized_pnl_usd, realized_pnl_usd < 0 AND is_resolved) AS total_losses,
      sumIf(realized_pnl_usd, is_resolved) AS pnl,
      countIf(is_resolved) AS resolved_positions,
      count() AS total_positions
    FROM cascadian_clean.vw_wallet_positions
    WHERE wallet_remapped IN (
      '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
      '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
      '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
    )
    GROUP BY wallet_remapped
    ORDER BY wallet_remapped
  `,
  format: 'JSONEachRow',
});

const results = await parity.json<Array<{
  wallet: string;
  total_gains: number;
  total_losses: number;
  pnl: number;
  resolved_positions: number;
  total_positions: number;
}>>();

console.log();
console.log('Wallet Verification:');
console.log();
for (const r of results) {
  const expected = wallets.find(w => w.addr === r.wallet);
  if (!expected) continue;

  const pnlDiff = Math.abs(r.pnl - expected.ui_pnl);
  const pnlPctDiff = expected.ui_pnl !== 0 ? (pnlDiff / Math.abs(expected.ui_pnl)) * 100 : 0;
  const status = pnlPctDiff < 5 ? '✅' : pnlPctDiff < 20 ? '⚠️' : '❌';

  console.log(`${r.wallet.substring(0, 10)}...`);
  console.log(`  UI PnL:       $${expected.ui_pnl.toLocaleString()}`);
  console.log(`  Our PnL:      $${Math.round(r.pnl).toLocaleString()}`);
  console.log(`  Difference:   ${pnlPctDiff.toFixed(1)}% ${status}`);
  console.log(`  Resolved:     ${r.resolved_positions}/${r.total_positions} positions`);
  console.log(`  Coverage:     ${((r.resolved_positions / r.total_positions) * 100).toFixed(1)}%`);
  console.log();
}

console.log('═'.repeat(80));
console.log('SUMMARY');
console.log('═'.repeat(80));
console.log();
console.log(`✅ Token→condition bridge built (${bridgeRows.toLocaleString()} mappings)`);
console.log(`✅ Resolutions rekeyed (${resRows.toLocaleString()} markets)`);
console.log(`✅ PnL views updated (NULL for unresolved)`);
console.log(`   Coverage: ${cov.coverage_pct}%`);
console.log();

if (cov.coverage_pct < 95) {
  console.log('NEXT STEP:');
  console.log('  Coverage is below 95% - may need API backfill for remaining markets');
  console.log('  Run: npx tsx backfill-from-polymarket-api.ts');
} else {
  console.log('NEXT STEP:');
  console.log('  1. Add market event enrichment (categories, tags)');
  console.log('  2. Deploy to production');
}
console.log();

await client.close();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
