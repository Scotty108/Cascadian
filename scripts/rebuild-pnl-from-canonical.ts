#!/usr/bin/env npx tsx
/**
 * PHASE 1: Rebuild P&L Pipeline from vw_trades_canonical
 *
 * Fixes:
 * 1. Uses vw_trades_canonical (157M trades) instead of fact_trades_clean (63M)
 * 2. Dedupes by trade_key (handles 9% duplicates)
 * 3. Properly aggregates positions
 * 4. Joins with complete resolution data
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000 // 5 min for view creation
});

async function main() {
  console.log('\n🔧 PHASE 1: REBUILDING P&L PIPELINE FROM VW_TRADES_CANONICAL\n');
  console.log('═'.repeat(100));

  try {
    // Step 1: Create deduped trades CTE
    console.log('\n📋 Step 1: Creating vw_wallet_pnl_calculated_v2 (rebuilt from canonical)...\n');

    const createView = `
      CREATE OR REPLACE VIEW default.vw_wallet_pnl_calculated_v2 AS
      WITH
      -- Dedupe vw_trades_canonical by trade_key
      deduped_trades AS (
        SELECT
          trade_key,
          wallet_address_norm,
          condition_id_norm,
          outcome_index,
          shares,
          usd_value,
          entry_price,
          timestamp,
          trade_direction
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY trade_key ORDER BY timestamp DESC) as rn
          FROM default.vw_trades_canonical
        )
        WHERE rn = 1
      ),

      -- Aggregate positions by wallet + condition + outcome
      position_aggregates AS (
        SELECT
          wallet_address_norm as wallet,
          condition_id_norm as condition_id,
          outcome_index,

          -- Net shares (BUY adds, SELL subtracts)
          SUM(CASE
            WHEN trade_direction = 'BUY' THEN toFloat64(shares)
            WHEN trade_direction = 'SELL' THEN -toFloat64(shares)
            ELSE 0
          END) as net_shares,

          -- Cost basis (sum of all USD spent/received)
          SUM(toFloat64(usd_value)) as cost_basis,

          -- Metadata
          MIN(timestamp) as first_trade,
          MAX(timestamp) as last_trade,
          COUNT(DISTINCT trade_key) as num_trades

        FROM deduped_trades
        GROUP BY wallet, condition_id, outcome_index
        HAVING ABS(net_shares) > 0.001  -- Filter dust positions
      ),

      -- Get all resolutions (from both sources)
      all_resolutions AS (
        -- Source 1: market_resolutions_final
        SELECT
          lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm,
          payout_numerators,
          payout_denominator,
          winning_outcome,
          'market_resolutions_final' as resolution_source
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION ALL

        -- Source 2: resolutions_external_ingest (blockchain)
        SELECT
          lower(replaceAll(condition_id, '0x', '')) as cid_norm,
          payout_numerators,
          payout_denominator,
          multiIf(
            payout_numerators[1] > 0, 'YES',
            payout_numerators[2] > 0, 'NO',
            NULL
          ) as winning_outcome,
          'resolutions_external_ingest' as resolution_source
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )

      -- Final join and P&L calculation
      SELECT
        p.wallet,
        p.condition_id,
        p.outcome_index,
        p.net_shares,
        p.cost_basis,

        -- Realized P&L (only for settled positions)
        CASE
          WHEN r.payout_denominator > 0 THEN
            (p.net_shares * (toFloat64(r.payout_numerators[p.outcome_index + 1]) / r.payout_denominator)) - p.cost_basis
          ELSE NULL
        END as realized_pnl_usd,

        -- Metadata
        p.first_trade,
        p.last_trade,
        p.num_trades,

        -- Resolution data
        r.payout_numerators,
        r.payout_denominator,
        r.winning_outcome,
        r.resolution_source

      FROM position_aggregates p
      LEFT JOIN all_resolutions r
        ON lower(replaceAll(p.condition_id, '0x', '')) = r.cid_norm
    `;

    await ch.query({ query: createView });
    console.log('  ✅ Created vw_wallet_pnl_calculated_v2');

    // Step 2: Test the new view
    console.log('\n📊 Step 2: Testing new view with 3 wallets...\n');

    const wallets = [
      { addr: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket: 2816, name: 'Wallet #1' },
      { addr: '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', polymarket: 9577, name: 'Wallet #2' },
      { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', polymarket: 192, name: 'Wallet #3' }
    ];

    console.log('═'.repeat(100));

    for (const wallet of wallets) {
      const result = await ch.query({
        query: `
          SELECT
            COUNT(*) as total_positions,
            COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
            COUNT(CASE WHEN payout_denominator = 0 OR payout_denominator IS NULL THEN 1 END) as unresolved,
            SUM(CASE WHEN payout_denominator > 0 THEN realized_pnl_usd ELSE 0 END) as total_realized_pnl
          FROM default.vw_wallet_pnl_calculated_v2
          WHERE lower(wallet) = lower('${wallet.addr}')
        `,
        format: 'JSONEachRow'
      });

      const data = (await result.json())[0];

      console.log(`\n${wallet.name} (${wallet.addr.substring(0, 10)}...)`);
      console.log(`  Polymarket predictions:  ${wallet.polymarket.toLocaleString()}`);
      console.log(`  Our positions:           ${parseInt(data.total_positions).toLocaleString()}`);
      console.log(`  - Resolved:              ${parseInt(data.resolved).toLocaleString()}`);
      console.log(`  - Unresolved:            ${parseInt(data.unresolved).toLocaleString()}`);
      console.log(`  Realized P&L:            $${parseFloat(data.total_realized_pnl).toLocaleString()}`);

      const coverage = (parseInt(data.total_positions) / wallet.polymarket * 100);
      console.log(`  Coverage:                ${coverage.toFixed(1)}%`);

      if (coverage >= 90) {
        console.log(`  ✅ EXCELLENT - Near complete coverage`);
      } else if (coverage >= 50) {
        console.log(`  ✅ GOOD - Majority of data present`);
      } else if (coverage >= 10) {
        console.log(`  ⚠️  PARTIAL - Significant data present`);
      } else {
        console.log(`  ❌ POOR - Most data still missing`);
      }
    }

    console.log('\n═'.repeat(100));

    // Step 3: Compare old vs new view
    console.log('\n📈 Step 3: Comparing OLD vs NEW view...\n');

    const comparison = await ch.query({
      query: `
        SELECT
          'vw_wallet_pnl_calculated (OLD)' as view_name,
          COUNT(*) as total_positions,
          COUNT(DISTINCT wallet) as unique_wallets,
          COUNT(DISTINCT condition_id) as unique_markets
        FROM default.vw_wallet_pnl_calculated

        UNION ALL

        SELECT
          'vw_wallet_pnl_calculated_v2 (NEW)' as view_name,
          COUNT(*) as total_positions,
          COUNT(DISTINCT wallet) as unique_wallets,
          COUNT(DISTINCT condition_id) as unique_markets
        FROM default.vw_wallet_pnl_calculated_v2
      `,
      format: 'JSONEachRow'
    });

    const compData = await comparison.json();

    console.log('View Comparison:');
    compData.forEach(row => {
      console.log(`\n  ${row.view_name}:`);
      console.log(`    Positions: ${parseInt(row.total_positions).toLocaleString()}`);
      console.log(`    Wallets:   ${parseInt(row.unique_wallets).toLocaleString()}`);
      console.log(`    Markets:   ${parseInt(row.unique_markets).toLocaleString()}`);
    });

    const oldPos = parseInt(compData[0].total_positions);
    const newPos = parseInt(compData[1].total_positions);
    const increase = ((newPos - oldPos) / oldPos * 100).toFixed(2);

    console.log(`\n  Improvement: +${increase}% more positions in new view`);

    // Step 4: Backup old view and promote new one
    console.log('\n🔄 Step 4: Promoting new view...\n');

    // Rename old view to backup
    await ch.query({
      query: `RENAME TABLE default.vw_wallet_pnl_calculated TO default.vw_wallet_pnl_calculated_backup`
    });
    console.log('  ✅ Backed up old view to vw_wallet_pnl_calculated_backup');

    // Rename new view to production
    await ch.query({
      query: `RENAME TABLE default.vw_wallet_pnl_calculated_v2 TO default.vw_wallet_pnl_calculated`
    });
    console.log('  ✅ Promoted vw_wallet_pnl_calculated_v2 to vw_wallet_pnl_calculated');

    console.log('\n═'.repeat(100));
    console.log('\n✅ PHASE 1 COMPLETE\n');
    console.log('New P&L pipeline is live using vw_trades_canonical as source.\n');
    console.log('Next steps:');
    console.log('  1. Run validation tests (npx tsx test-pnl-rebuilt.ts)');
    console.log('  2. (Optional) Backfill Wallet #1 missing data');
    console.log('  3. Add unrealized P&L (Phase 3)\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error('\nFull error:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
