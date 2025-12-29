#!/usr/bin/env npx tsx
/**
 * Fix P&L views by:
 * 1. Using vw_trades_canonical instead of fact_trades_clean (31% vs 19.6% coverage)
 * 2. Applying ID normalization: lowercase + remove 0x prefix
 * 3. UNIONing both resolution sources (market_resolutions_final + resolutions_external_ingest)
 *
 * Expected result: 0% → 50-60% coverage
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIXING P&L VIEWS WITH ID NORMALIZATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Strategy:');
  console.log('  1. Use vw_trades_canonical (31% coverage vs fact_trades_clean 19.6%)');
  console.log('  2. Apply ID normalization: lower(replaceAll(x, "0x", ""))');
  console.log('  3. UNION both resolution sources');
  console.log('');

  // Step 1: Drop existing view
  console.log('Step 1: Dropping existing vw_wallet_pnl_calculated...\n');
  await ch.command({
    query: `DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated`
  });
  console.log('✓ Dropped\n');

  // Step 2: Create new view with proper ID normalization
  console.log('Step 2: Creating new view with ID normalization...\n');

  const viewSQL = `
    CREATE VIEW default.vw_wallet_pnl_calculated AS
    WITH
      -- UNION both resolution sources with normalized IDs
      all_resolutions AS (
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          payout_numerators,
          payout_denominator,
          winning_outcome,
          'market_resolutions_final' as source
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION ALL

        SELECT
          lower(replaceAll(condition_id, '0x', '')) as cid_norm,
          payout_numerators,
          payout_denominator,
          CASE
            WHEN payout_numerators[1] > 0 THEN 'YES'
            WHEN payout_numerators[2] > 0 THEN 'NO'
            ELSE NULL
          END as winning_outcome,
          'resolutions_external_ingest' as source
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      ),

      -- Use vw_trades_canonical with normalized IDs
      trade_positions AS (
        SELECT
          wallet_address_norm as wallet,
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          outcome_index,
          SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
          SUM(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE -usd_value END) as cost_basis,
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade,
          COUNT(*) as num_trades
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
        GROUP BY wallet_address_norm, lower(replaceAll(condition_id_norm, '0x', '')), outcome_index
      )

    SELECT
      t.wallet,
      t.cid_norm as condition_id,
      t.outcome_index,
      t.net_shares,
      t.cost_basis,
      CASE
        WHEN r.payout_denominator > 0 THEN
          (t.net_shares * (r.payout_numerators[t.outcome_index + 1] / r.payout_denominator)) - t.cost_basis
        ELSE NULL
      END as realized_pnl_usd,
      t.first_trade,
      t.last_trade,
      t.num_trades,
      r.payout_numerators,
      r.payout_denominator,
      r.winning_outcome,
      r.source as resolution_source
    FROM trade_positions t
    LEFT JOIN all_resolutions r
      ON t.cid_norm = r.cid_norm
  `;

  await ch.command({ query: viewSQL });
  console.log('✓ Created view\n');

  // Step 3: Test coverage
  console.log('Step 3: Testing coverage...\n');

  const coverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        round(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });
  const coverageData = await coverage.json<any[]>();

  console.log('Results:');
  console.log(`  Total positions:     ${parseInt(coverageData[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved positions:  ${parseInt(coverageData[0].resolved_positions).toLocaleString()}`);
  console.log(`  Coverage:            ${coverageData[0].coverage_pct}%\n`);

  // Step 4: Test with wallet 0x9155e8cf
  console.log('Step 4: Testing with wallet 0x9155e8cf...\n');

  const walletPnl = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('0x9155e8cf81a3fb557639d23d43f1528675bcfcad')
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletPnl.json<any[]>();

  console.log('Wallet 0x9155e8cf results:');
  console.log(`  Total positions:     ${parseInt(walletData[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved positions:  ${parseInt(walletData[0].resolved_positions).toLocaleString()}`);
  console.log(`  Total P&L:           $${parseFloat(walletData[0].total_pnl || 0).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  Expected P&L:        $110,440.13\n`);

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));

  const expectedCoverage = parseFloat(coverageData[0].coverage_pct);
  if (expectedCoverage > 40) {
    console.log(`\n✅ SUCCESS! Coverage improved from 0% to ${expectedCoverage}%`);
  } else if (expectedCoverage > 20) {
    console.log(`\n⚠️  PARTIAL SUCCESS: Coverage is ${expectedCoverage}%`);
    console.log('   Expected 50-60% - may need additional resolution backfill');
  } else {
    console.log(`\n❌ FAILED: Coverage is only ${expectedCoverage}%`);
    console.log('   Need to investigate further');
  }

  console.log('');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
