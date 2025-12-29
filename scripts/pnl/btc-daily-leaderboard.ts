import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== BTC DAILY STRIKES LEADERBOARD ===\n");
  console.log("Using resolution-based win rate (not markout - markets resolve same day)\n");

  // Step 1: Check resolved markets
  const countQuery = `
    SELECT count() as cnt
    FROM pm_condition_resolutions r
    JOIN pm_market_metadata m ON r.condition_id = m.condition_id
    WHERE m.series_slug = 'bitcoin-multi-strikes-daily'
      AND r.is_deleted = 0
  `;
  const countResult = await clickhouse.query({ query: countQuery, format: "JSONEachRow" });
  const countRows = await countResult.json() as any[];
  console.log(`Found ${countRows[0].cnt} resolved bitcoin-multi-strikes-daily markets\n`);

  // Step 2: Build leaderboard using resolution data
  // payout_numerators format: "[1,0]" = YES won, "[0,1]" = NO won
  const tradesQuery = `
    WITH
    -- Get resolved bitcoin daily markets with YES/NO resolution price
    resolved_markets AS (
      SELECT
        m.condition_id,
        arrayJoin(m.token_ids) as token_id,
        -- Parse payout_numerators to get resolution price for YES token
        -- [1,0] means YES won (price=1), [0,1] means NO won (price=0)
        if(
          JSONExtractInt(r.payout_numerators, 1) = 1,
          1.0,
          0.0
        ) as resolution_price
      FROM pm_market_metadata m
      JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE m.series_slug = 'bitcoin-multi-strikes-daily'
        AND r.is_deleted = 0
    ),
    -- Get token_ids list for filtering
    token_list AS (
      SELECT DISTINCT token_id FROM resolved_markets
    ),
    -- Dedupe trades (filter BEFORE aggregation)
    raw_trades AS (
      SELECT *
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_id IN (SELECT token_id FROM token_list)
    ),
    deduped_trades AS (
      SELECT
        event_id,
        any(lower(trader_wallet)) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as shares
      FROM raw_trades
      GROUP BY event_id
    ),
    -- Calculate per-market position and PnL
    wallet_positions AS (
      SELECT
        t.wallet,
        t.token_id,
        rm.resolution_price,
        -- Net shares: positive = long YES, negative = short YES (long NO)
        sumIf(shares, side = 'buy') - sumIf(shares, side = 'sell') as net_shares,
        -- Cash flow: sell - buy (positive = net received)
        sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow,
        count() as trade_count
      FROM deduped_trades t
      JOIN resolved_markets rm ON t.token_id = rm.token_id
      GROUP BY t.wallet, t.token_id, rm.resolution_price
      HAVING abs(net_shares) > 0.01 OR abs(cash_flow) > 1
    ),
    wallet_pnl AS (
      SELECT
        wallet,
        token_id,
        resolution_price,
        net_shares,
        cash_flow,
        trade_count,
        -- PnL = cash_flow + payout at resolution
        -- If holding YES shares (net_shares > 0) and resolution = 1: payout = net_shares
        -- If holding NO (net_shares < 0) and resolution = 0: payout = -net_shares * 1 = abs(net_shares)
        cash_flow + (net_shares * resolution_price) as realized_pnl,
        -- Win if PnL > 0
        if(cash_flow + (net_shares * resolution_price) > 0, 1, 0) as is_win
      FROM wallet_positions
    )
    SELECT
      wallet,
      count() as markets_traded,
      sum(trade_count) as total_trades,
      sum(is_win) as wins,
      sum(is_win) * 100.0 / count() as win_rate,
      sum(realized_pnl) as total_pnl,
      avg(realized_pnl) as avg_pnl_per_market,
      -- Consistency score: win_rate * sqrt(markets)
      (sum(is_win) * 100.0 / count()) * sqrt(count()) / 10 as consistency_score
    FROM wallet_pnl
    GROUP BY wallet
    HAVING markets_traded >= 10  -- At least 10 markets for statistical significance
    ORDER BY consistency_score DESC
    LIMIT 100
  `;

  console.log("Computing wallet PnL from resolution outcomes...");
  const tradesResult = await clickhouse.query({ query: tradesQuery, format: "JSONEachRow" });
  const walletRows = await tradesResult.json() as any[];
  console.log(`Found ${walletRows.length} wallets with 10+ markets traded\n`);

  if (walletRows.length === 0) {
    console.log("No wallets found. Let me debug...");

    // Debug: check if we have trades at all
    const debugQ = `
      SELECT count() as cnt, uniq(token_id) as tokens
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND token_id IN (
          SELECT arrayJoin(token_ids) FROM pm_market_metadata
          WHERE series_slug = 'bitcoin-multi-strikes-daily'
        )
    `;
    const debugResult = await clickhouse.query({ query: debugQ, format: "JSONEachRow" });
    const debugRows = await debugResult.json() as any[];
    console.log("Debug - trades in bitcoin-multi-strikes-daily:", debugRows[0]);
    return;
  }

  // Display results
  console.log("=== BTC DAILY STRIKES LEADERBOARD (Resolution-Based) ===\n");
  console.log("Rank | Wallet       | Markets | Wins | Win% | Total PnL | Avg/Mkt | Score");
  console.log("-----|--------------|---------|------|------|-----------|---------|------");

  for (let i = 0; i < Math.min(30, walletRows.length); i++) {
    const w = walletRows[i];
    console.log([
      String(i + 1).padStart(4),
      w.wallet.slice(0, 12),
      String(w.markets_traded).padStart(7),
      String(w.wins).padStart(4),
      (w.win_rate.toFixed(1) + "%").padStart(5),
      ("$" + Math.round(w.total_pnl).toLocaleString()).padStart(11),
      ("$" + Math.round(w.avg_pnl_per_market)).padStart(7),
      w.consistency_score.toFixed(2).padStart(6)
    ].join(" | "));
  }

  // Export to files
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    series: "bitcoin-multi-strikes-daily",
    methodology: {
      type: "resolution-based (not markout)",
      reason: "Same-day resolution markets don't work with 14-day markout",
      formula: "PnL = cash_flow + (net_shares * resolution_price)",
      scoring: "consistency_score = win_rate * sqrt(markets_traded) / 10",
      min_markets: 10
    },
    total_wallets: walletRows.length,
    leaderboard: walletRows.map((w: any, i: number) => ({
      rank: i + 1,
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      markets_traded: w.markets_traded,
      wins: w.wins,
      win_rate: Math.round(w.win_rate * 10) / 10,
      total_pnl: Math.round(w.total_pnl),
      avg_pnl_per_market: Math.round(w.avg_pnl_per_market),
      consistency_score: Math.round(w.consistency_score * 100) / 100
    }))
  };

  const jsonPath = exportDir + "/btc_daily_leaderboard.json";
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nExported to: ${jsonPath}`);

  // CSV export
  const csvHeaders = ["rank", "wallet", "url", "markets_traded", "wins", "win_rate", "total_pnl", "avg_pnl_per_market", "consistency_score"];
  const csvRows = [
    csvHeaders.join(","),
    ...output.leaderboard.map((w: any) => [
      w.rank,
      w.wallet,
      w.url,
      w.markets_traded,
      w.wins,
      w.win_rate,
      w.total_pnl,
      w.avg_pnl_per_market,
      w.consistency_score
    ].join(","))
  ];

  const csvPath = exportDir + "/btc_daily_leaderboard.csv";
  fs.writeFileSync(csvPath, csvRows.join("\n"));
  console.log(`Exported CSV to: ${csvPath}`);

  // Show top 5 with Polymarket URLs
  console.log("\n=== TOP 5 BTC DAILY EXPERTS ===\n");
  for (const w of output.leaderboard.slice(0, 5)) {
    console.log(`#${w.rank} ${w.wallet}`);
    console.log(`   Win Rate: ${w.win_rate}% over ${w.markets_traded} markets`);
    console.log(`   Total PnL: $${w.total_pnl.toLocaleString()}`);
    console.log(`   URL: ${w.url}`);
    console.log();
  }
}

main().catch(console.error);
