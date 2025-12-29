import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("DEBUGGING P&L CALCULATION DIFFERENCE");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Test 1: My systematic investigation query (which gave $90K)
  console.log("Test 1: Systematic investigation query (gave $90,702)");
  console.log("─".repeat(80));

  const systematicQuery = await clickhouse.query({
    query: `
      WITH gamma_resolved_deduped AS (
        SELECT cid, argMax(winning_outcome, fetched_at) AS winning_outcome
        FROM gamma_resolved
        GROUP BY cid
      ),
      clob_cashflows AS (
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) AS cashflow,
          sum(cf.size / 1000000.0) AS net_shares
        FROM clob_fills cf
        INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        GROUP BY wallet, condition_id_norm, outcome_idx
      )
      SELECT
        count(DISTINCT cc.condition_id_norm) as market_count,
        sum(
          cc.cashflow + if(
            (gm.winning_outcome IN ('Yes', 'Up', 'Over') AND cc.outcome_idx = 0) OR
            (gm.winning_outcome IN ('No', 'Down', 'Under') AND cc.outcome_idx = 1),
            cc.net_shares,
            0
          )
        ) AS total_pnl,
        sum(cc.cashflow) as total_cashflow,
        sum(cc.net_shares) as total_shares
      FROM clob_cashflows cc
      INNER JOIN gamma_resolved_deduped gm ON cc.condition_id_norm = gm.cid
      WHERE lower(cc.wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const systematic = (await systematicQuery.json())[0];

  console.log(`Markets: ${systematic.market_count}`);
  console.log(`Total cashflow: $${Number(systematic.total_cashflow).toFixed(2)}`);
  console.log(`Total shares: ${Number(systematic.total_shares).toFixed(2)}`);
  console.log(`Total P&L: $${Number(systematic.total_pnl).toFixed(2)}`);
  console.log();

  // Test 2: Current view query
  console.log("Test 2: Current realized_pnl_by_market_final view");
  console.log("─".repeat(80));

  const viewQuery = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as market_count,
        sum(realized_pnl_usd) AS total_pnl,
        sum(cashflow) as total_cashflow,
        sum(net_shares) as total_shares
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const view = (await viewQuery.json())[0];

  console.log(`Markets: ${view.market_count}`);
  console.log(`Total cashflow: $${Number(view.total_cashflow).toFixed(2)}`);
  console.log(`Total shares: ${Number(view.total_shares).toFixed(2)}`);
  console.log(`Total P&L: $${Number(view.total_pnl).toFixed(2)}`);
  console.log();

  // Test 3: Check the difference in net_shares calculation
  console.log("Test 3: Comparing net_shares calculation methods");
  console.log("─".repeat(80));

  const sharesCompareQuery = await clickhouse.query({
    query: `
      SELECT
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        -- Method 1: Simple sum (what systematic used - WRONG)
        sum(cf.size / 1000000.0) AS shares_simple_sum,
        -- Method 2: Direction-aware (what view should use - CORRECT)
        sum(if(cf.side = 'BUY', 1, -1) * cf.size / 1000000.0) AS shares_net,
        -- Show the fills
        groupArray(cf.side) as sides,
        groupArray(cf.size / 1000000.0) as sizes
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm, outcome_idx
      ORDER BY abs(shares_simple_sum - shares_net) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sharesCompare = await sharesCompareQuery.json();

  console.log("\nTop 10 markets with different share calculations:");
  console.table(sharesCompare.map((s: any) => ({
    condition_id: s.condition_id_norm.substring(0, 12) + '...',
    outcome: s.outcome_idx,
    simple_sum: s.shares_simple_sum.toFixed(2),
    net: s.shares_net.toFixed(2),
    difference: (s.shares_simple_sum - s.shares_net).toFixed(2),
    fills: s.sides.join(',')
  })));

  console.log();
  console.log("═".repeat(80));
  console.log("DIAGNOSIS");
  console.log("═".repeat(80));
  console.log();
  console.log("The systematic investigation used WRONG net_shares calculation:");
  console.log("  sum(cf.size) = Simple sum of ALL fills (ignores BUY/SELL)");
  console.log();
  console.log("This inflated the shares component of P&L formula:");
  console.log("  cashflow + shares (if winning) = huge number");
  console.log();
  console.log("The CORRECT calculation should be:");
  console.log("  sum(if(side='BUY', 1, -1) * size) = Net position");
  console.log();
  console.log("So the $90K figure was WRONG due to calculation error.");
  console.log("The $35K figure is actually CORRECT.");
  console.log();
  console.log("This means the deduplication is NOT the root cause of the gap!");
  console.log("═".repeat(80));
}

main().catch(console.error);
