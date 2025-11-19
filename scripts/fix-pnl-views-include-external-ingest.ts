#!/usr/bin/env npx tsx
/**
 * Fix P&L Views to Include resolutions_external_ingest
 *
 * Root cause: P&L views only query market_resolutions_final
 * Fix: Add UNION ALL to include resolutions_external_ingest
 * Expected: Coverage jumps from 7.4% to 55-65%
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

async function main() {
  console.log('\n🔧 FIXING P&L VIEWS TO INCLUDE EXTERNAL RESOLUTIONS\n');
  console.log('═'.repeat(80));

  // Step 1: Backup current view definition
  console.log('\n1️⃣ Backing up current view definition:\n');

  const currentDef = await ch.query({
    query: `SHOW CREATE TABLE default.vw_wallet_pnl_calculated`,
    format: 'JSONEachRow'
  });
  const currentDefData = await currentDef.json<any>();
  console.log('  ✅ Current definition saved\n');

  // Step 2: Drop existing view
  console.log('2️⃣ Dropping existing view:\n');

  await ch.query({
    query: `DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated`
  });
  console.log('  ✅ View dropped\n');

  // Step 3: Create new view with UNION ALL logic
  console.log('3️⃣ Creating updated view with resolutions_external_ingest:\n');

  const newViewSQL = `
    CREATE VIEW default.vw_wallet_pnl_calculated AS
    WITH
      -- UNION both resolution sources
      all_resolutions AS (
        SELECT
          condition_id_norm as cid,
          payout_numerators,
          payout_denominator,
          winning_outcome
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION ALL

        SELECT
          condition_id as cid,
          payout_numerators,
          payout_denominator,
          -- Compute winning_outcome from payout array
          CASE
            WHEN payout_numerators[1] > 0 THEN 'YES'
            WHEN payout_numerators[2] > 0 THEN 'NO'
            ELSE NULL
          END as winning_outcome
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      ),

      -- Aggregate trades by position
      trade_positions AS (
        SELECT
          wallet_address as wallet,
          cid as condition_id,
          outcome_index,
          SUM(CASE WHEN direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
          SUM(CASE WHEN direction = 'BUY' THEN usdc_amount ELSE -usdc_amount END) as cost_basis,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade,
          COUNT(*) as num_trades
        FROM default.fact_trades_clean
        GROUP BY wallet_address, cid, outcome_index
      )

      -- Join trades with resolutions and calculate P&L
      SELECT
        t.wallet,
        t.condition_id,
        t.outcome_index,
        t.net_shares,
        t.cost_basis,
        -- Calculate realized P&L if resolved
        CASE
          WHEN r.payout_denominator > 0 THEN
            (t.net_shares * (r.payout_numerators[t.outcome_index + 1] / r.payout_denominator)) - t.cost_basis
          ELSE
            NULL
        END as realized_pnl_usd,
        t.first_trade,
        t.last_trade,
        t.num_trades,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_outcome
      FROM trade_positions t
      LEFT JOIN all_resolutions r
        ON lower(t.condition_id) = lower(r.cid)
  `;

  await ch.query({ query: newViewSQL });
  console.log('  ✅ New view created with UNION ALL logic\n');

  // Step 4: Update vw_wallet_pnl_summary
  console.log('4️⃣ Updating vw_wallet_pnl_summary:\n');

  await ch.query({
    query: `DROP VIEW IF EXISTS default.vw_wallet_pnl_summary`
  });

  const summaryViewSQL = `
    CREATE VIEW default.vw_wallet_pnl_summary AS
    SELECT
      wallet,
      COUNT(DISTINCT condition_id) as total_markets,
      COUNT(DISTINCT CASE WHEN payout_denominator > 0 THEN condition_id END) as resolved_markets,
      COUNT(DISTINCT CASE WHEN payout_denominator = 0 OR payout_denominator IS NULL THEN condition_id END) as unresolved_markets,
      SUM(realized_pnl_usd) as total_pnl_usd,
      SUM(CASE WHEN realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) as total_wins_usd,
      SUM(CASE WHEN realized_pnl_usd < 0 THEN realized_pnl_usd ELSE 0 END) as total_losses_usd,
      SUM(ABS(cost_basis)) as total_volume_usd,
      MIN(first_trade) as first_trade_date,
      MAX(last_trade) as last_trade_date,
      SUM(num_trades) as total_trades
    FROM default.vw_wallet_pnl_calculated
    GROUP BY wallet
  `;

  await ch.query({ query: summaryViewSQL });
  console.log('  ✅ Summary view updated\n');

  // Step 5: Test on sample wallets
  console.log('5️⃣ Testing on sample wallets:\n');

  const testQuery = await ch.query({
    query: `
      SELECT
        wallet,
        total_markets,
        resolved_markets,
        ROUND(resolved_markets / total_markets * 100, 1) as coverage_pct,
        ROUND(total_pnl_usd, 2) as pnl
      FROM default.vw_wallet_pnl_summary
      ORDER BY total_markets DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const testData = await testQuery.json<any>();

  console.log('  Top 10 wallets by markets traded:\n');
  console.log('  Wallet                                      | Markets | Resolved | Coverage | P&L');
  console.log('  --------------------------------------------|---------|----------|----------|------------');
  testData.forEach((w: any) => {
    const pnl = w.pnl ? `$${parseFloat(w.pnl).toLocaleString()}` : 'N/A';
    console.log(`  ${w.wallet.substring(0, 42).padEnd(42)} | ${w.total_markets.toString().padStart(7)} | ${w.resolved_markets.toString().padStart(8)} | ${w.coverage_pct.toString().padStart(7)}% | ${pnl.padStart(10)}`);
  });

  // Step 6: Check wallet 0x4ce7 specifically
  console.log('\n6️⃣ Checking wallet 0x4ce7:\n');

  const wallet0x4ce7 = await ch.query({
    query: `
      SELECT
        wallet,
        total_markets,
        resolved_markets,
        ROUND(resolved_markets / total_markets * 100, 1) as coverage_pct,
        ROUND(total_pnl_usd, 2) as pnl
      FROM default.vw_wallet_pnl_summary
      WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
    `,
    format: 'JSONEachRow'
  });

  const wallet0x4ce7Data = await wallet0x4ce7.json<any>();

  if (wallet0x4ce7Data.length > 0) {
    const w = wallet0x4ce7Data[0];
    console.log(`  Wallet: ${w.wallet}`);
    console.log(`  Total markets: ${w.total_markets}`);
    console.log(`  Resolved markets: ${w.resolved_markets}`);
    console.log(`  Coverage: ${w.coverage_pct}%`);
    console.log(`  P&L: $${parseFloat(w.pnl || 0).toLocaleString()}\n`);
  } else {
    console.log('  ⚠️  Wallet not found in summary view\n');
  }

  // Step 7: Overall coverage stats
  console.log('7️⃣ Overall position coverage:\n');

  const overallStats = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved_positions,
        ROUND(resolved_positions / total_positions * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const statsData = await overallStats.json<any>();
  console.log(`  Total positions: ${parseInt(statsData[0].total_positions).toLocaleString()}`);
  console.log(`  Resolved positions: ${parseInt(statsData[0].resolved_positions).toLocaleString()}`);
  console.log(`  Coverage: ${statsData[0].coverage_pct}%\n`);

  console.log('═'.repeat(80));
  console.log('✅ FIX COMPLETE\n');

  const coveragePct = parseFloat(statsData[0].coverage_pct);

  if (coveragePct >= 50) {
    console.log('🎉 SUCCESS! Coverage improved significantly');
    console.log(`   Before: 7.4%`);
    console.log(`   After: ${coveragePct}%`);
    console.log(`   Improvement: +${Math.round(coveragePct - 7.4)}%\n`);
  } else if (coveragePct > 10) {
    console.log('⚠️  Partial improvement');
    console.log(`   Before: 7.4%`);
    console.log(`   After: ${coveragePct}%`);
    console.log('   May need additional investigation\n');
  } else {
    console.log('❌ No significant improvement');
    console.log('   Need to investigate further\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
