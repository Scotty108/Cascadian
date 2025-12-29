#!/usr/bin/env tsx
/**
 * P&L Verification Against Polymarket
 *
 * Goal: Verify our P&L calculations match Polymarket's official numbers
 * Expected: ~2,800 trades (not 30) and ~$333K P&L for test wallet
 *
 * This uses our 132,757 resolved markets with complete payout data.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

// Test wallet: High-activity trader (786K trades, $14.4M volume, 17K markets)
const TEST_WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('💰 P&L VERIFICATION AGAINST POLYMARKET');
  console.log(`   Test wallet: ${TEST_WALLET}`);
  console.log('   Using 132,757 resolved markets');
  console.log('═'.repeat(80));

  // Step 1: Calculate P&L using our data
  console.log('\n📊 Step 1: Calculating P&L from our data...\n');

  const ourPnL = await ch.query({
    query: `
      WITH resolved_markets AS (
        -- Get all resolved markets with valid payouts
        SELECT DISTINCT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index
        FROM (
          SELECT
            condition_id_norm,
            payout_numerators,
            payout_denominator,
            winning_index
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0

          UNION ALL

          SELECT
            condition_id,
            payout_numerators,
            payout_denominator,
            winning_index
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      ),
      wallet_trades AS (
        -- Get all trades for this wallet
        SELECT
          lower(replaceAll(t.cid, '0x', '')) as condition_id,
          t.wallet_address,
          t.direction,
          t.outcome_index,
          t.price,
          t.shares,
          t.usdc_amount,
          t.block_time,
          t.tx_hash
        FROM default.fact_trades_clean t
        WHERE lower(t.wallet_address) = lower('${TEST_WALLET}')
      ),
      position_pnl AS (
        -- Calculate P&L per position
        SELECT
          wt.condition_id,
          wt.outcome_index,
          COUNT(*) as trade_count,
          SUM(wt.shares) as net_shares,
          SUM(wt.usdc_amount) as cost_basis,
          rm.payout_numerators,
          rm.payout_denominator,
          rm.winning_index,
          -- Calculate payout value
          CASE
            WHEN rm.winning_index IS NOT NULL AND rm.payout_denominator > 0 THEN
              SUM(wt.shares) * (arrayElement(rm.payout_numerators, wt.outcome_index + 1) / rm.payout_denominator)
            ELSE 0
          END as payout_value,
          -- Calculate P&L
          CASE
            WHEN rm.winning_index IS NOT NULL AND rm.payout_denominator > 0 THEN
              (SUM(wt.shares) * (arrayElement(rm.payout_numerators, wt.outcome_index + 1) / rm.payout_denominator)) - SUM(wt.usdc_amount)
            ELSE 0
          END as pnl
        FROM wallet_trades wt
        LEFT JOIN resolved_markets rm ON wt.condition_id = rm.condition_id_norm
        GROUP BY wt.condition_id, wt.outcome_index, rm.payout_numerators, rm.payout_denominator, rm.winning_index
      )
      SELECT
        SUM(trade_count) as total_trades,
        COUNT(DISTINCT condition_id) as markets_traded,
        SUM(CASE WHEN payout_denominator > 0 THEN 1 ELSE 0 END) as resolved_markets,
        SUM(cost_basis) as total_cost_basis,
        SUM(payout_value) as total_payout_value,
        SUM(pnl) as total_pnl,
        SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as total_wins,
        SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END) as total_losses,
        COUNT(DISTINCT CASE WHEN pnl > 0 THEN condition_id END) as winning_markets,
        COUNT(DISTINCT CASE WHEN pnl < 0 THEN condition_id END) as losing_markets
      FROM position_pnl
    `,
    format: 'JSONEachRow',
  });

  const results = await ourPnL.json();
  const stats = results[0];

  console.log('  Our Calculated Results:');
  console.log(`    Total trades: ${parseInt(stats.total_trades).toLocaleString()}`);
  console.log(`    Markets traded: ${parseInt(stats.markets_traded).toLocaleString()}`);
  console.log(`    Resolved markets: ${parseInt(stats.resolved_markets).toLocaleString()}`);
  console.log(`    Cost basis: $${parseFloat(stats.total_cost_basis).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Payout value: $${parseFloat(stats.total_payout_value).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Total P&L: $${parseFloat(stats.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Winning markets: ${parseInt(stats.winning_markets).toLocaleString()}`);
  console.log(`    Losing markets: ${parseInt(stats.losing_markets).toLocaleString()}`);

  // Step 2: Show top winning and losing positions
  console.log('\n📊 Step 2: Top 10 Winning Positions...\n');

  const topWinners = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index
        FROM (
          SELECT
            condition_id_norm,
            payout_numerators,
            payout_denominator,
            winning_index
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0

          UNION ALL

          SELECT
            condition_id,
            payout_numerators,
            payout_denominator,
            winning_index
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      ),
      wallet_trades AS (
        SELECT
          lower(replaceAll(t.cid, '0x', '')) as condition_id,
          t.wallet_address,
          t.direction,
          t.outcome_index,
          t.price,
          t.shares,
          t.usdc_amount,
          t.block_time,
          t.tx_hash
        FROM default.fact_trades_clean t
        WHERE lower(t.wallet_address) = lower('${TEST_WALLET}')
      ),
      position_pnl AS (
        SELECT
          wt.condition_id,
          wt.outcome_index,
          COUNT(*) as trade_count,
          SUM(wt.shares) as net_shares,
          SUM(wt.usdc_amount) as cost_basis,
          rm.payout_numerators,
          rm.payout_denominator,
          rm.winning_index,
          CASE
            WHEN rm.winning_index IS NOT NULL AND rm.payout_denominator > 0 THEN
              (SUM(wt.shares) * (arrayElement(rm.payout_numerators, wt.outcome_index + 1) / rm.payout_denominator)) - SUM(wt.usdc_amount)
            ELSE 0
          END as pnl,
          ams.question,
          ams.outcomes
        FROM wallet_trades wt
        LEFT JOIN resolved_markets rm ON wt.condition_id = rm.condition_id_norm
        LEFT JOIN default.api_markets_staging ams ON wt.condition_id = lower(replaceAll(ams.condition_id, '0x', ''))
        GROUP BY wt.condition_id, wt.outcome_index, rm.payout_numerators, rm.payout_denominator, rm.winning_index, ams.question, ams.outcomes
      )
      SELECT
        condition_id,
        question,
        outcomes,
        outcome_index,
        trade_count,
        net_shares,
        cost_basis,
        pnl
      FROM position_pnl
      WHERE pnl > 0
      ORDER BY pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const winners = await topWinners.json();
  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    const cid = w.condition_id.substring(0, 12) + '...';
    const question = w.question ? w.question.substring(0, 60) + '...' : 'N/A';
    const pnl = parseFloat(w.pnl).toLocaleString(undefined, {maximumFractionDigits: 2});
    const trades = w.trade_count;

    console.log(`  ${i+1}. P&L: $${pnl} (${trades} trades)`);
    console.log(`     ${question}`);
    console.log(`     CID: ${cid}`);
    console.log();
  }

  // Step 3: Show coverage breakdown
  console.log('\n📊 Step 3: Coverage Breakdown...\n');

  const coverage = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT condition_id_norm
        FROM (
          SELECT condition_id_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0

          UNION ALL

          SELECT condition_id
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      ),
      wallet_trades AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TEST_WALLET}')
      )
      SELECT
        COUNT(*) as total_markets_traded,
        SUM(CASE WHEN rm.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as has_resolution,
        SUM(CASE WHEN rm.condition_id_norm IS NULL THEN 1 ELSE 0 END) as missing_resolution
      FROM wallet_trades wt
      LEFT JOIN resolved_markets rm ON wt.condition_id = rm.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const cov = await coverage.json();
  const totalMarkets = parseInt(cov[0].total_markets_traded);
  const hasRes = parseInt(cov[0].has_resolution);
  const missingRes = parseInt(cov[0].missing_resolution);
  const coveragePct = (hasRes / totalMarkets * 100).toFixed(1);

  console.log(`  Total markets traded by wallet: ${totalMarkets.toLocaleString()}`);
  console.log(`  Markets with resolutions: ${hasRes.toLocaleString()} (${coveragePct}%)`);
  console.log(`  Markets still open/missing: ${missingRes.toLocaleString()} (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);

  // Step 4: Compare to expected values
  console.log('\n📊 Step 4: Comparison to Expected Values...\n');

  const totalTrades = parseInt(stats.total_trades);
  const totalPnL = parseFloat(stats.total_pnl);

  console.log('  Expected vs Actual:');
  console.log(`    Trade count:`);
  console.log(`      Expected: ~2,800 trades`);
  console.log(`      Actual: ${totalTrades.toLocaleString()} trades`);
  console.log(`      Match: ${totalTrades >= 2000 ? '✅' : '❌'} ${totalTrades >= 2000 ? '(Within range)' : '(Below expected)'}`);
  console.log();
  console.log(`    Total P&L:`);
  console.log(`      Expected: ~$333,000`);
  console.log(`      Actual: $${totalPnL.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`      Difference: $${(totalPnL - 333000).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`      Match: ${Math.abs(totalPnL - 333000) < 50000 ? '✅' : '⚠️'} ${Math.abs(totalPnL - 333000) < 50000 ? '(Within 15%)' : '(Review needed)'}`);

  // Step 5: Unrealized P&L for open positions
  console.log('\n📊 Step 5: Unrealized P&L (Open Positions)...\n');

  const unrealized = await ch.query({
    query: `
      WITH resolved_markets AS (
        SELECT DISTINCT condition_id_norm
        FROM (
          SELECT condition_id_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0

          UNION ALL

          SELECT condition_id
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      ),
      wallet_trades AS (
        SELECT
          lower(replaceAll(t.cid, '0x', '')) as condition_id,
          t.outcome_index,
          SUM(t.size) as net_shares,
          SUM(t.usdc_amount) as cost_basis
        FROM default.fact_trades_clean t
        WHERE lower(t.wallet_address) = lower('${TEST_WALLET}')
        GROUP BY condition_id, outcome_index
      )
      SELECT
        COUNT(DISTINCT wt.condition_id) as open_markets,
        SUM(wt.cost_basis) as open_cost_basis,
        SUM(ABS(wt.net_shares)) as total_open_shares
      FROM wallet_trades wt
      LEFT JOIN resolved_markets rm ON wt.condition_id = rm.condition_id_norm
      WHERE rm.condition_id_norm IS NULL
        AND ABS(wt.net_shares) > 0.01
    `,
    format: 'JSONEachRow',
  });

  const unreal = await unrealized.json();
  const openMarkets = parseInt(unreal[0].open_markets);
  const openCost = parseFloat(unreal[0].open_cost_basis);
  const openShares = parseFloat(unreal[0].total_open_shares);

  console.log(`  Open positions (unresolved markets):`);
  console.log(`    Markets: ${openMarkets.toLocaleString()}`);
  console.log(`    Cost basis: $${openCost.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Total shares: ${openShares.toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Note: Unrealized P&L requires current market prices`);

  console.log('\n' + '═'.repeat(80));
  console.log('💰 VERIFICATION COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
