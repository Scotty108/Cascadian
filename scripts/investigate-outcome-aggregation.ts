import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("INVESTIGATING: Are we counting BOTH outcomes per market?");
  console.log("═".repeat(80));
  console.log();

  // Check how many outcomes per market this wallet has
  const query = `
    SELECT
      p.condition_id_norm,
      groupArray(p.outcome_idx) as outcomes,
      groupArray(p.net_shares) as shares,
      count(*) as outcome_count
    FROM outcome_positions_v2 p
    WHERE p.wallet = lower('${wallet}')
    GROUP BY p.condition_id_norm
    HAVING outcome_count > 1
    ORDER BY outcome_count DESC
  `;

  const res = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  console.log(`Markets with MULTIPLE outcomes: ${rows.length}`);
  if (rows.length > 0) {
    console.log("\nSample markets with both YES and NO positions:");
    console.table(rows.slice(0, 10).map(r => ({
      condition_id: r.condition_id_norm.substring(0, 12) + '...',
      outcomes: r.outcomes.join(', '),
      shares: r.shares.map(s => Number(s).toFixed(2)).join(', '),
      count: r.outcome_count
    })));
  }

  // Now check current P&L by market (summing all outcomes)
  const pnlQuery = `
    SELECT
      condition_id_norm,
      groupArray(outcome_idx) as outcomes,
      groupArray(realized_pnl_usd) as pnls_by_outcome,
      sum(realized_pnl_usd) as total_market_pnl
    FROM realized_pnl_by_market_final
    WHERE wallet = lower('${wallet}')
    GROUP BY condition_id_norm
    ORDER BY total_market_pnl DESC
    LIMIT 10
  `;

  const pnlRes = await clickhouse.query({
    query: pnlQuery,
    format: 'JSONEachRow'
  });
  const pnlRows = await pnlRes.json();

  console.log("\nTop 10 markets by P&L (summing all outcomes):");
  console.table(pnlRows.map(r => ({
    condition_id: r.condition_id_norm.substring(0, 12) + '...',
    outcomes: r.outcomes.join(', '),
    pnls: r.pnls_by_outcome.map(p => `$${Number(p).toFixed(2)}`).join(' + '),
    total: `$${Number(r.total_market_pnl).toFixed(2)}`
  })));

  // Compare total when summing by market vs by outcome
  const byOutcome = await clickhouse.query({
    query: `SELECT sum(realized_pnl_usd) as total FROM realized_pnl_by_market_final WHERE wallet = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const byOutcomeTotal = (await byOutcome.json())[0].total;

  const byMarket = await clickhouse.query({
    query: `
      SELECT sum(total_market_pnl) as total
      FROM (
        SELECT condition_id_norm, sum(realized_pnl_usd) as total_market_pnl
        FROM realized_pnl_by_market_final
        WHERE wallet = lower('${wallet}')
        GROUP BY condition_id_norm
      )
    `,
    format: 'JSONEachRow'
  });
  const byMarketTotal = (await byMarket.json())[0].total;

  console.log("\n" + "═".repeat(80));
  console.log("TOTALS:");
  console.log(`  By outcome (current view): $${Number(byOutcomeTotal).toLocaleString()}`);
  console.log(`  By market (summed):        $${Number(byMarketTotal).toLocaleString()}`);
  console.log(`  Difference:                $${(byMarketTotal - byOutcomeTotal).toLocaleString()}`);
  console.log("═".repeat(80));
}

main().catch(console.error);
