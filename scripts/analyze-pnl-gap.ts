import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("=== P&L GAP ANALYSIS ===\n");

  // 1. Total unique markets
  const totalMarkets = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as total
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const totalRows = await totalMarkets.json();
  console.log(`Total markets with positions: ${totalRows[0].total}`);

  // 2. Resolved markets
  const resolvedMarkets = await clickhouse.query({
    query: `
      SELECT count(DISTINCT condition_id_norm) as resolved
      FROM realized_pnl_by_market_final
      WHERE wallet = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const resolvedRows = await resolvedMarkets.json();
  console.log(`Resolved markets: ${resolvedRows[0].resolved}`);

  // 3. Unrealized P&L
  try {
    const unrealized = await clickhouse.query({
      query: `
        SELECT unrealized_pnl_usd
        FROM wallet_unrealized_pnl_v2
        WHERE wallet = lower('${wallet}')
      `,
      format: 'JSONEachRow'
    });
    const unrealizedRows = await unrealized.json();
    if (unrealizedRows.length > 0) {
      console.log(`Unrealized P&L: $${unrealizedRows[0].unrealized_pnl_usd}`);
    }
  } catch (e) {
    console.log("Unrealized P&L: N/A (table not found)");
  }

  // 4. Total P&L
  const summary = await clickhouse.query({
    query: `
      SELECT realized_pnl_usd, unrealized_pnl_usd, total_pnl_usd
      FROM wallet_pnl_summary_final
      WHERE wallet = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const summaryRows = await summary.json();
  if (summaryRows.length > 0) {
    const s = summaryRows[0];
    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Realized:   $${s.realized_pnl_usd.toLocaleString()}`);
    console.log(`Unrealized: $${s.unrealized_pnl_usd.toLocaleString()}`);
    console.log(`Total:      $${s.total_pnl_usd.toLocaleString()}`);
    console.log(`\nExpected (Dome): $87,030.51`);
    console.log(`Gap: $${(87030.51 - s.realized_pnl_usd).toLocaleString()}`);
    console.log(`Variance: ${((s.realized_pnl_usd - 87030.51) / 87030.51 * 100).toFixed(2)}%`);
  }
}

main().catch(console.error);
