import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("TEST #3: Per-Market Ledger");
  console.log("═".repeat(80));
  console.log();
  console.log("Building complete trade accounting by market...");
  console.log();

  // Build comprehensive per-market ledger
  const query = `
    WITH market_trades AS (
      SELECT
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        cf.side,
        sum(cf.size / 1000000.0) AS total_shares,
        sum(cf.price * cf.size / 1000000.0) AS total_cost
      FROM clob_fills AS cf
      INNER JOIN ctf_token_map AS ctm
        ON cf.asset_id = ctm.token_id
      WHERE cf.condition_id IS NOT NULL
        AND cf.condition_id != ''
        AND cf.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(cf.proxy_wallet) = lower('${wallet}')
      GROUP BY condition_id_norm, outcome_idx, side
    ),
    market_summary AS (
      SELECT
        condition_id_norm,
        outcome_idx,
        sumIf(total_shares, side = 'BUY') AS buy_shares,
        sumIf(total_cost, side = 'BUY') AS buy_cost,
        sumIf(total_shares, side = 'SELL') AS sell_shares,
        sumIf(total_cost, side = 'SELL') AS sell_proceeds,
        (sumIf(total_shares, side = 'BUY') - sumIf(total_shares, side = 'SELL')) AS net_shares,
        (sumIf(total_cost, side = 'SELL') - sumIf(total_cost, side = 'BUY')) AS net_cashflow
      FROM market_trades
      GROUP BY condition_id_norm, outcome_idx
    )
    SELECT
      ms.condition_id_norm,
      ms.outcome_idx,
      ms.buy_shares,
      ms.buy_cost,
      ms.sell_shares,
      ms.sell_proceeds,
      ms.net_shares,
      ms.net_cashflow,
      wi.win_idx,
      wi.resolved_at,
      CASE
        WHEN wi.win_idx IS NOT NULL THEN
          CASE
            WHEN ms.outcome_idx = wi.win_idx THEN
              -- Won: cashflow + remaining shares valued at $1
              ms.net_cashflow + ms.net_shares
            ELSE
              -- Lost: only cashflow (shares worth $0)
              ms.net_cashflow
          END
        ELSE
          -- Unresolved: only cashflow
          ms.net_cashflow
      END AS realized_pnl
    FROM market_summary ms
    LEFT JOIN winning_index wi ON wi.condition_id_norm = ms.condition_id_norm
    WHERE wi.win_idx IS NOT NULL
    ORDER BY realized_pnl DESC
  `;

  const res = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });
  const rows = await res.json();

  // Calculate totals
  const totalPnL = rows.reduce((sum, r) => sum + Number(r.realized_pnl), 0);
  const totalBuyCost = rows.reduce((sum, r) => sum + Number(r.buy_cost), 0);
  const totalSellProceeds = rows.reduce((sum, r) => sum + Number(r.sell_proceeds), 0);
  const totalCashflow = rows.reduce((sum, r) => sum + Number(r.net_cashflow), 0);

  // Group by market (sum all outcomes)
  const marketMap = new Map();
  rows.forEach(r => {
    const existing = marketMap.get(r.condition_id_norm) || {
      buy_cost: 0,
      sell_proceeds: 0,
      net_cashflow: 0,
      realized_pnl: 0,
      outcomes: []
    };

    existing.buy_cost += Number(r.buy_cost);
    existing.sell_proceeds += Number(r.sell_proceeds);
    existing.net_cashflow += Number(r.net_cashflow);
    existing.realized_pnl += Number(r.realized_pnl);
    existing.outcomes.push({
      idx: r.outcome_idx,
      pnl: Number(r.realized_pnl),
      shares: Number(r.net_shares)
    });
    existing.resolved_at = r.resolved_at;
    existing.win_idx = r.win_idx;

    marketMap.set(r.condition_id_norm, existing);
  });

  const markets = Array.from(marketMap.entries()).map(([id, data]) => ({
    condition_id_norm: id,
    ...data
  })).sort((a, b) => b.realized_pnl - a.realized_pnl);

  console.log("═".repeat(80));
  console.log("SUMMARY:");
  console.log(`  Total markets:     ${markets.length}`);
  console.log(`  Total positions:   ${rows.length}`);
  console.log();
  console.log("Trade Volume:");
  console.log(`  Total buy cost:    $${totalBuyCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Total sell proceeds: $${totalSellProceeds.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Net cashflow:      $${totalCashflow.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log();
  console.log("P&L:");
  console.log(`  Realized P&L:      $${totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Expected (Dome):   $87,030.51`);
  console.log(`  Gap:               $${(87030.51 - totalPnL).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  Variance:          ${((totalPnL - 87030.51) / 87030.51 * 100).toFixed(2)}%`);
  console.log("═".repeat(80));
  console.log();

  console.log("Top 10 markets by P&L:");
  console.table(markets.slice(0, 10).map(m => ({
    condition_id: m.condition_id_norm.substring(0, 12) + '...',
    outcomes: m.outcomes.length,
    buy_cost: `$${m.buy_cost.toFixed(2)}`,
    sell_proceeds: `$${m.sell_proceeds.toFixed(2)}`,
    pnl: `$${m.realized_pnl.toFixed(2)}`
  })));

  console.log();
  console.log("Bottom 10 markets by P&L:");
  console.table(markets.slice(-10).reverse().map(m => ({
    condition_id: m.condition_id_norm.substring(0, 12) + '...',
    outcomes: m.outcomes.length,
    buy_cost: `$${m.buy_cost.toFixed(2)}`,
    sell_proceeds: `$${m.sell_proceeds.toFixed(2)}`,
    pnl: `$${m.realized_pnl.toFixed(2)}`
  })));

  // Export to JSON for comparison with Dome
  const exportPath = resolve(process.cwd(), 'tmp/per-market-ledger.json');
  const fs = await import('fs/promises');
  await fs.mkdir(resolve(process.cwd(), 'tmp'), { recursive: true });
  await fs.writeFile(
    exportPath,
    JSON.stringify({
      wallet,
      generated_at: new Date().toISOString(),
      summary: {
        total_markets: markets.length,
        total_positions: rows.length,
        total_buy_cost: totalBuyCost,
        total_sell_proceeds: totalSellProceeds,
        net_cashflow: totalCashflow,
        realized_pnl: totalPnL
      },
      markets: markets.map(m => ({
        condition_id: m.condition_id_norm,
        resolved_at: m.resolved_at,
        win_idx: m.win_idx,
        outcomes: m.outcomes,
        buy_cost: m.buy_cost,
        sell_proceeds: m.sell_proceeds,
        net_cashflow: m.net_cashflow,
        realized_pnl: m.realized_pnl
      }))
    }, null, 2)
  );

  console.log();
  console.log(`✅ Exported to: ${exportPath}`);
  console.log();
  console.log("Next step: Compare this ledger with Dome's per-market breakdown");
  console.log("═".repeat(80));
}

main().catch(console.error);
