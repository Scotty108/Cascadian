#!/usr/bin/env npx tsx
/**
 * PHASE 2: UPDATE P&L VIEWS TO USE LEGACY TOKEN MAPPING
 *
 * Modifies vw_wallet_pnl_calculated to join through legacy_token_condition_map
 *
 * Logic:
 * - For modern era trades: Direct join (existing 11.88% coverage)
 * - For legacy era trades: Map token_id → condition_id via legacy_token_condition_map
 * - COALESCE to try mapped ID first, fall back to direct ID
 *
 * Expected result: 0% → 50-60% coverage for wallet 0x9155e8cf
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

const WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('PHASE 2: UPDATE P&L VIEWS WITH LEGACY TOKEN MAPPING');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Check mapping table status
  console.log('Step 1: Verifying legacy_token_condition_map table...\n');

  const mappingCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_mappings,
        COUNT(DISTINCT token_id) as unique_tokens,
        COUNT(DISTINCT condition_id) as unique_conditions
      FROM default.legacy_token_condition_map
    `,
    format: 'JSONEachRow',
  });
  const mappingStats = await mappingCheck.json<any[]>();

  console.log(`  Total mappings: ${parseInt(mappingStats[0].total_mappings).toLocaleString()}`);
  console.log(`  Unique token IDs: ${parseInt(mappingStats[0].unique_tokens).toLocaleString()}`);
  console.log(`  Unique condition IDs: ${parseInt(mappingStats[0].unique_conditions).toLocaleString()}\n`);

  if (parseInt(mappingStats[0].total_mappings) === 0) {
    console.log('❌ ERROR: No mappings found in legacy_token_condition_map table');
    console.log('   Run build-legacy-token-mapping.ts first\n');
    await ch.close();
    process.exit(1);
  }

  // Step 2: Check current P&L coverage
  console.log('Step 2: Checking current P&L coverage...\n');

  const currentCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        round(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });
  const current = await currentCoverage.json<any[]>();

  console.log(`  Current global coverage: ${current[0].coverage_pct}%`);
  console.log(`  Resolved: ${parseInt(current[0].resolved_positions).toLocaleString()} / ${parseInt(current[0].total_positions).toLocaleString()}\n`);

  const walletCurrent = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletPnl = await walletCurrent.json<any[]>();

  console.log(`  Wallet ${WALLET.substring(0, 12)}... current P&L:`);
  console.log(`  Positions: ${parseInt(walletPnl[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(walletPnl[0].resolved_positions).toLocaleString()}`);
  console.log(`  P&L: $${parseFloat(walletPnl[0].total_pnl || 0).toLocaleString()}\n`);

  // Step 3: Drop old view
  console.log('Step 3: Dropping old vw_wallet_pnl_calculated view...\n');

  await ch.command({
    query: 'DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated',
  });

  console.log('✓ Old view dropped\n');

  // Step 4: Create new view with mapping layer
  console.log('Step 4: Creating new view with mapping layer...\n');

  const newViewSQL = `
    CREATE VIEW default.vw_wallet_pnl_calculated AS
    WITH
      -- CTE 1: Aggregate trade positions by wallet + normalized condition ID + outcome
      trade_positions AS (
        SELECT
          wallet_address_norm as wallet,
          lower(replaceAll(condition_id_norm, '0x', '')) as token_id,
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
      ),

      -- CTE 2: Join with legacy token mapping to get canonical condition IDs
      positions_with_canonical_ids AS (
        SELECT
          t.wallet,
          t.token_id,
          t.outcome_index,
          t.net_shares,
          t.cost_basis,
          t.first_trade,
          t.last_trade,
          t.num_trades,
          -- Use mapped condition_id if available, otherwise use token_id directly (modern era)
          COALESCE(lower(m.condition_id), t.token_id) as canonical_cid
        FROM trade_positions t
        LEFT JOIN default.legacy_token_condition_map m
          ON t.token_id = lower(m.token_id)
      ),

      -- CTE 3: Union all resolution sources
      all_resolutions AS (
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as cid,
          payout_numerators,
          payout_denominator,
          winning_outcome
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION ALL

        SELECT
          lower(replaceAll(condition_id, '0x', '')) as cid,
          payout_numerators,
          payout_denominator,
          CASE
            WHEN payout_numerators[1] > 0 THEN 'YES'
            WHEN payout_numerators[2] > 0 THEN 'NO'
            ELSE NULL
          END as winning_outcome
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )

    -- Final SELECT: Join positions with resolutions and calculate P&L
    SELECT
      p.wallet,
      p.token_id as condition_id,
      p.canonical_cid,
      p.outcome_index,
      p.net_shares,
      p.cost_basis,
      p.first_trade,
      p.last_trade,
      p.num_trades,
      r.payout_numerators,
      r.payout_denominator,
      r.winning_outcome,
      -- P&L calculation: (net_shares × payout) - cost_basis
      CASE
        WHEN r.payout_denominator > 0 THEN
          (p.net_shares * (r.payout_numerators[p.outcome_index + 1] / r.payout_denominator)) - p.cost_basis
        ELSE NULL
      END as realized_pnl_usd
    FROM positions_with_canonical_ids p
    LEFT JOIN all_resolutions r
      ON p.canonical_cid = r.cid
  `;

  await ch.command({ query: newViewSQL });

  console.log('✓ New view created with mapping layer\n');

  // Step 5: Verify new coverage
  console.log('Step 5: Verifying new coverage...\n');

  const newCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        round(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow',
  });
  const newStats = await newCoverage.json<any[]>();

  console.log(`  New global coverage: ${newStats[0].coverage_pct}%`);
  console.log(`  Resolved: ${parseInt(newStats[0].resolved_positions).toLocaleString()} / ${parseInt(newStats[0].total_positions).toLocaleString()}`);
  console.log(`  Improvement: ${(parseFloat(newStats[0].coverage_pct) - parseFloat(current[0].coverage_pct)).toFixed(2)}%\n`);

  const walletNew = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(realized_pnl_usd) as resolved_positions,
        round(100.0 * COUNT(realized_pnl_usd) / COUNT(*), 2) as coverage_pct,
        SUM(realized_pnl_usd) as total_pnl
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletNewStats = await walletNew.json<any[]>();

  console.log(`  Wallet ${WALLET.substring(0, 12)}... new P&L:`);
  console.log(`  Positions: ${parseInt(walletNewStats[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(walletNewStats[0].resolved_positions).toLocaleString()}`);
  console.log(`  Coverage: ${walletNewStats[0].coverage_pct}%`);
  console.log(`  P&L: $${parseFloat(walletNewStats[0].total_pnl || 0).toLocaleString()}`);
  console.log(`  Expected: $110,440.13\n`);

  // Step 6: Sample resolved positions
  console.log('Step 6: Sample resolved positions...\n');

  const sample = await ch.query({
    query: `
      SELECT
        wallet,
        substring(condition_id, 1, 16) as token_id_short,
        substring(canonical_cid, 1, 16) as canonical_cid_short,
        outcome_index,
        net_shares,
        cost_basis,
        realized_pnl_usd,
        winning_outcome
      FROM default.vw_wallet_pnl_calculated
      WHERE lower(wallet) = lower('${WALLET}')
        AND realized_pnl_usd IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const sampleData = await sample.json<any[]>();

  console.log('Sample resolved positions:');
  sampleData.forEach((row, i) => {
    console.log(`\n${i+1}.`);
    console.log(`   Token ID:      ${row.token_id_short}...`);
    console.log(`   Canonical CID: ${row.canonical_cid_short}...`);
    console.log(`   Outcome:       ${row.outcome_index} (${row.winning_outcome})`);
    console.log(`   Net Shares:    ${parseFloat(row.net_shares).toFixed(2)}`);
    console.log(`   Cost Basis:    $${parseFloat(row.cost_basis).toFixed(2)}`);
    console.log(`   P&L:           $${parseFloat(row.realized_pnl_usd).toFixed(2)}`);
  });

  console.log('\n═'.repeat(80));
  console.log('PHASE 2 COMPLETE');
  console.log('═'.repeat(80));
  console.log(`\n✅ Global coverage: ${current[0].coverage_pct}% → ${newStats[0].coverage_pct}%`);
  console.log(`✅ Wallet coverage: 0% → ${walletNewStats[0].coverage_pct}%`);
  console.log(`✅ Wallet P&L: $0 → $${parseFloat(walletNewStats[0].total_pnl || 0).toLocaleString()}\n`);

  // Success criteria check
  const walletCoveragePct = parseFloat(walletNewStats[0].coverage_pct);
  const walletPnlValue = parseFloat(walletNewStats[0].total_pnl || 0);
  const expectedPnl = 110440.13;
  const pnlAccuracy = Math.abs(walletPnlValue - expectedPnl) / expectedPnl * 100;

  console.log('Success Criteria:');
  if (walletCoveragePct >= 50) {
    console.log(`  ✅ Target coverage: ${walletCoveragePct}% ≥ 50%`);
  } else if (walletCoveragePct >= 40) {
    console.log(`  ⚠️  Minimum coverage: ${walletCoveragePct}% ≥ 40%`);
  } else {
    console.log(`  ❌ Below minimum: ${walletCoveragePct}% < 40%`);
  }

  if (pnlAccuracy <= 10) {
    console.log(`  ✅ Target P&L accuracy: ${pnlAccuracy.toFixed(1)}% error ≤ 10%`);
  } else if (pnlAccuracy <= 20) {
    console.log(`  ⚠️  Minimum P&L accuracy: ${pnlAccuracy.toFixed(1)}% error ≤ 20%`);
  } else {
    console.log(`  ❌ Below minimum: ${pnlAccuracy.toFixed(1)}% error > 20%`);
  }

  console.log('\nNext: Run Phase 3 verification on other wallets\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
