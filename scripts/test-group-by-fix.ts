import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("TESTING: Fixed GROUP BY (removing cf.total_cashflow)");
  console.log("═".repeat(80));
  console.log();

  // Test the CORRECTED query without cf.total_cashflow in GROUP BY
  const fixedQuery = `
    WITH cashflows_agg AS (
      SELECT
        wallet,
        condition_id_norm,
        outcome_idx,
        sum(cashflow_usdc) AS total_cashflow
      FROM trade_cashflows_v3
      GROUP BY wallet, condition_id_norm, outcome_idx
    )
    SELECT
      p.wallet,
      p.condition_id_norm,
      wi.resolved_at,
      sum(COALESCE(cf.total_cashflow, 0.0)) + sumIf(p.net_shares, p.outcome_idx = wi.win_idx) AS realized_pnl_usd
    FROM outcome_positions_v2 AS p
    LEFT JOIN winning_index AS wi
      ON wi.condition_id_norm = p.condition_id_norm
    LEFT JOIN cashflows_agg AS cf
      ON cf.wallet = p.wallet
      AND cf.condition_id_norm = p.condition_id_norm
      AND cf.outcome_idx = p.outcome_idx
    WHERE wi.win_idx IS NOT NULL
      AND p.wallet = lower('${wallet}')
    GROUP BY p.wallet, p.condition_id_norm, wi.resolved_at
    ORDER BY realized_pnl_usd DESC
  `;

  const res = await clickhouse.query({
    query: fixedQuery,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  console.log(`Total markets: ${rows.length}`);
  console.log();

  const total = rows.reduce((sum, r) => sum + Number(r.realized_pnl_usd), 0);

  console.log("Top 10 markets by P&L:");
  if (rows.length > 0) {
    console.table(rows.slice(0, 10).map(r => ({
      condition_id: (r.condition_id_norm || '').substring(0, 12) + '...',
      pnl: `$${Number(r.realized_pnl_usd).toLocaleString()}`
    })));
  } else {
    console.log("No rows returned!");
    return;
  }

  console.log();
  console.log("═".repeat(80));
  console.log("RESULTS:");
  console.log(`  Current (wrong GROUP BY):  $${(34990.56).toLocaleString()}`);
  console.log(`  Fixed (correct GROUP BY):  $${total.toLocaleString()}`);
  console.log(`  Expected (Dome):           $87,030.51`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Difference:                $${(total - 34990.56).toLocaleString()}`);
  console.log(`  Gap from Dome:             $${(87030.51 - total).toLocaleString()}`);
  console.log(`  Variance:                  ${((total - 87030.51) / 87030.51 * 100).toFixed(2)}%`);

  if (Math.abs((total - 87030.51) / 87030.51 * 100) < 2) {
    console.log(`  ✅ <2% VARIANCE - BUG FIXED!`);
  } else if (Math.abs((total - 87030.51) / 87030.51 * 100) < 10) {
    console.log(`  ⚠️  <10% variance - Significant improvement`);
  } else {
    console.log(`  ❌ >10% variance - Other issues remain`);
  }
  console.log("═".repeat(80));
}

main().catch(console.error);
