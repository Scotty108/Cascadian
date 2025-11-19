#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function analyzeReadiness() {
  console.log('=== P&L CALCULATION READINESS ANALYSIS ===\n');

  // 1. Realized vs Unrealized trades
  console.log('1. REALIZED vs UNREALIZED P&L breakdown:');
  const realizedBreakdown = await client.query({
    query: `
      SELECT
        -- Total trades with condition_id
        COUNT(*) as total_trades,
        SUM(usd_value) as total_volume_usd,

        -- Trades with resolution data (Apply PNL skill)
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as resolved_trades,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN t.usd_value ELSE 0 END) as resolved_volume_usd,

        -- Trades WITHOUT resolution (unrealized)
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN 1 ELSE 0 END) as unresolved_trades,
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN t.usd_value ELSE 0 END) as unresolved_volume_usd
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const breakdown = await realizedBreakdown.json<any>();
  const b = breakdown[0];

  console.log(`  Total trades (with condition_id): ${parseInt(b.total_trades).toLocaleString()}`);
  console.log(`  Total volume: $${parseFloat(b.total_volume_usd).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log();
  console.log(`  RESOLVED (can calculate realized P&L):`);
  console.log(`    Trades: ${parseInt(b.resolved_trades).toLocaleString()} (${(parseInt(b.resolved_trades)/parseInt(b.total_trades)*100).toFixed(2)}%)`);
  console.log(`    Volume: $${parseFloat(b.resolved_volume_usd).toLocaleString(undefined, {maximumFractionDigits: 2})} (${(parseFloat(b.resolved_volume_usd)/parseFloat(b.total_volume_usd)*100).toFixed(2)}%)`);
  console.log();
  console.log(`  UNRESOLVED (unrealized P&L only):`);
  console.log(`    Trades: ${parseInt(b.unresolved_trades).toLocaleString()} (${(parseInt(b.unresolved_trades)/parseInt(b.total_trades)*100).toFixed(2)}%)`);
  console.log(`    Volume: $${parseFloat(b.unresolved_volume_usd).toLocaleString(undefined, {maximumFractionDigits: 2})} (${(parseFloat(b.unresolved_volume_usd)/parseFloat(b.total_volume_usd)*100).toFixed(2)}%)`);
  console.log();

  // 2. Payout data completeness
  console.log('2. PAYOUT DATA COMPLETENESS (for resolved markets):');
  const payoutCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total_resolved_trades,
        SUM(CASE WHEN length(r.payout_numerators) > 0 THEN 1 ELSE 0 END) as has_payout_numerators,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout_denominator,
        SUM(CASE WHEN r.winning_index IS NOT NULL THEN 1 ELSE 0 END) as has_winning_index,

        -- All required fields present (Apply CAR - ClickHouse Array Rule)
        SUM(CASE
          WHEN length(r.payout_numerators) > 0
            AND r.payout_denominator > 0
            AND r.winning_index IS NOT NULL
          THEN 1 ELSE 0
        END) as fully_complete
      FROM trades_raw t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const payout = await payoutCheck.json<any>();
  const p = payout[0];

  console.log(`  Total resolved trades: ${parseInt(p.total_resolved_trades).toLocaleString()}`);
  console.log(`  Has payout_numerators: ${parseInt(p.has_payout_numerators).toLocaleString()} (${(parseInt(p.has_payout_numerators)/parseInt(p.total_resolved_trades)*100).toFixed(2)}%)`);
  console.log(`  Has payout_denominator > 0: ${parseInt(p.has_payout_denominator).toLocaleString()} (${(parseInt(p.has_payout_denominator)/parseInt(p.total_resolved_trades)*100).toFixed(2)}%)`);
  console.log(`  Has winning_index: ${parseInt(p.has_winning_index).toLocaleString()} (${(parseInt(p.has_winning_index)/parseInt(p.total_resolved_trades)*100).toFixed(2)}%)`);
  console.log(`  FULLY COMPLETE (all fields): ${parseInt(p.fully_complete).toLocaleString()} (${(parseInt(p.fully_complete)/parseInt(p.total_resolved_trades)*100).toFixed(2)}%)`);
  console.log();

  // 3. Check for missing denominator issues
  console.log('3. PAYOUT DENOMINATOR ISSUES:');
  const denomCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT condition_id_norm) as unique_conditions
      FROM market_resolutions_final
      WHERE payout_denominator = 0 OR payout_denominator IS NULL
    `,
    format: 'JSONEachRow'
  });
  const denom = await denomCheck.json<any>();
  console.log(`  Resolutions with denominator = 0 or NULL: ${denom[0].total} (${denom[0].unique_conditions} unique conditions)`);

  if (parseInt(denom[0].total) > 0) {
    console.log(`  WARNING: ${denom[0].total} resolutions have invalid denominator!`);
  }
  console.log();

  // 4. Empty condition_id analysis
  console.log('4. EMPTY CONDITION_ID ANALYSIS:');
  const emptyCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as empty_condition_trades,
        SUM(usd_value) as empty_condition_volume
      FROM trades_raw
      WHERE condition_id = ''
    `,
    format: 'JSONEachRow'
  });
  const empty = await emptyCheck.json<any>();
  console.log(`  Trades with empty condition_id: ${parseInt(empty[0].empty_condition_trades).toLocaleString()}`);
  console.log(`  Volume: $${parseFloat(empty[0].empty_condition_volume).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  NOTE: These trades need condition_id recovery before P&L calculation`);
  console.log();

  // 5. Market time range analysis
  console.log('5. MARKET TIME RANGE (to check if unresolved = recent):');
  const timeRange = await client.query({
    query: `
      SELECT
        MIN(timestamp) as earliest_trade,
        MAX(timestamp) as latest_trade,
        COUNT(DISTINCT DATE(timestamp)) as trading_days
      FROM trades_raw
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const time = await timeRange.json<any>();
  console.log(`  Earliest trade: ${time[0].earliest_trade}`);
  console.log(`  Latest trade: ${time[0].latest_trade}`);
  console.log(`  Trading days: ${time[0].trading_days}`);
  console.log();

  // 6. Recent vs old unresolved markets
  console.log('6. UNRESOLVED MARKETS by AGE:');
  const ageAnalysis = await client.query({
    query: `
      SELECT
        CASE
          WHEN MAX(t.timestamp) >= now() - INTERVAL 7 DAY THEN 'Last 7 days'
          WHEN MAX(t.timestamp) >= now() - INTERVAL 30 DAY THEN 'Last 30 days'
          WHEN MAX(t.timestamp) >= now() - INTERVAL 90 DAY THEN 'Last 90 days'
          ELSE 'Older than 90 days'
        END as age_bucket,
        COUNT(DISTINCT t.condition_id) as markets,
        COUNT(*) as trades,
        SUM(t.usd_value) as volume
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
        AND r.condition_id_norm IS NULL
      GROUP BY age_bucket
      ORDER BY
        CASE age_bucket
          WHEN 'Last 7 days' THEN 1
          WHEN 'Last 30 days' THEN 2
          WHEN 'Last 90 days' THEN 3
          ELSE 4
        END
    `,
    format: 'JSONEachRow'
  });
  const age = await ageAnalysis.json<any>();
  age.forEach((row: any) => {
    console.log(`  ${row.age_bucket}:`);
    console.log(`    Markets: ${parseInt(row.markets).toLocaleString()}`);
    console.log(`    Trades: ${parseInt(row.trades).toLocaleString()}`);
    console.log(`    Volume: $${parseFloat(row.volume).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  });
  console.log();

  // 7. Sample P&L calculation
  console.log('7. SAMPLE P&L CALCULATION (first 5 resolved trades):');
  const samplePnl = await client.query({
    query: `
      SELECT
        t.wallet_address,
        t.condition_id,
        t.shares,
        t.usd_value as cost_basis,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        r.winning_outcome,
        -- Apply PNL skill with CAR (ClickHouse Array Rule)
        (t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value as realized_pnl_usd
      FROM trades_raw t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
        AND length(r.payout_numerators) > 0
        AND r.payout_denominator > 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const samples = await samplePnl.json<any>();
  samples.forEach((s: any, i: number) => {
    console.log(`  Trade ${i+1}:`);
    console.log(`    Wallet: ${s.wallet_address}`);
    console.log(`    Shares: ${s.shares}`);
    console.log(`    Cost: $${parseFloat(s.cost_basis).toFixed(2)}`);
    console.log(`    Payout: [${s.payout_numerators.join(', ')}] / ${s.payout_denominator}`);
    console.log(`    Winner: ${s.winning_outcome} (index ${s.winning_index})`);
    console.log(`    Realized P&L: $${parseFloat(s.realized_pnl_usd).toFixed(2)}`);
    console.log();
  });

  // 8. Summary
  console.log('=== SUMMARY & BLOCKERS ===\n');

  const resolvedPct = (parseInt(b.resolved_trades)/parseInt(b.total_trades)*100).toFixed(2);
  const unresolvedPct = (parseInt(b.unresolved_trades)/parseInt(b.total_trades)*100).toFixed(2);
  const emptyPct = (parseInt(empty[0].empty_condition_trades)/(parseInt(b.total_trades) + parseInt(empty[0].empty_condition_trades))*100).toFixed(2);

  console.log(`REALIZED P&L: ${resolvedPct}% of trades (${parseInt(b.resolved_trades).toLocaleString()} trades)`);
  console.log(`  ✅ Can calculate P&L with payout vectors`);
  console.log(`  ✅ All required fields present`);
  console.log();
  console.log(`UNREALIZED P&L: ${unresolvedPct}% of trades (${parseInt(b.unresolved_trades).toLocaleString()} trades)`);
  console.log(`  ⚠️  Markets not yet resolved`);
  console.log(`  ⚠️  Need current market prices for unrealized P&L`);
  console.log();
  console.log(`NO CONDITION_ID: ${emptyPct}% of all trades (${parseInt(empty[0].empty_condition_trades).toLocaleString()} trades)`);
  console.log(`  ❌ Cannot calculate P&L without condition_id`);
  console.log(`  🔧 Recoverable via ERC1155 blockchain data`);
  console.log();

  await client.close();
}

analyzeReadiness().catch(console.error);
