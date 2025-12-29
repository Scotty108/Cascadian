import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  console.log("=== DE-RISKED COPYABLE WALLETS ===");
  console.log("Filters: PnL > $200, Sortino > 0, positive at 14d AND 30d\n");

  // Combined query: markout stats + lifetime PnL
  const query = `
WITH
-- Get fills with 14d and 30d prices (exclude resolved markets)
fills_with_prices AS (
  SELECT
    t.wallet,
    t.token_id as token_id,
    t.trade_date,
    t.notional,
    p14.end_of_day_price as price_14d,
    p30.end_of_day_price as price_30d,
    -- 14d markout
    CASE
      WHEN t.side = 'BUY' THEN (p14.end_of_day_price - t.fill_price) * 10000
      ELSE (t.fill_price - p14.end_of_day_price) * 10000
    END as markout_14d_bps,
    -- 30d markout
    CASE
      WHEN t.side = 'BUY' THEN (p30.end_of_day_price - t.fill_price) * 10000
      ELSE (t.fill_price - p30.end_of_day_price) * 10000
    END as markout_30d_bps
  FROM (
    SELECT
      lower(trader_wallet) as wallet,
      token_id,
      toDate(trade_time) as trade_date,
      side,
      (usdc_amount / 1e6) / nullIf(token_amount / 1e6, 0) as fill_price,
      usdc_amount / 1e6 as notional
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND role = 'taker'
      AND trade_time >= now() - INTERVAL 90 DAY
      AND trade_time <= now() - INTERVAL 30 DAY
      AND token_amount > 0
      AND usdc_amount > 0
  ) t
  LEFT JOIN _daily_prices_ref p14 ON t.token_id = p14.token_id AND p14.price_date = t.trade_date + 14
  LEFT JOIN _daily_prices_ref p30 ON t.token_id = p30.token_id AND p30.price_date = t.trade_date + 30
  WHERE p14.end_of_day_price > 0.01 AND p14.end_of_day_price < 0.99
    AND p30.end_of_day_price > 0.01 AND p30.end_of_day_price < 0.99
),
-- Calculate markout stats per wallet
wallet_markout AS (
  SELECT
    wallet,
    count() as fills,
    uniq(token_id) as markets,
    sum(notional) as total_notional,

    -- 14d metrics
    avg(markout_14d_bps) as mean_14d,
    stddevPop(markout_14d_bps) as std_14d,
    sqrt(avg(CASE WHEN markout_14d_bps < 0 THEN pow(markout_14d_bps, 2) ELSE 0 END)) as downside_std_14d,
    countIf(markout_14d_bps > 0) * 100.0 / count() as win_rate_14d,

    -- 30d metrics
    avg(markout_30d_bps) as mean_30d,
    stddevPop(markout_30d_bps) as std_30d,
    sqrt(avg(CASE WHEN markout_30d_bps < 0 THEN pow(markout_30d_bps, 2) ELSE 0 END)) as downside_std_30d,
    countIf(markout_30d_bps > 0) * 100.0 / count() as win_rate_30d

  FROM fills_with_prices
  GROUP BY wallet
  HAVING fills >= 30 AND markets >= 8 AND total_notional >= 1000
),
-- Get lifetime PnL from pm_wallet_engine_pnl_cache
lifetime_pnl AS (
  SELECT
    wallet,
    realized_pnl as total_pnl
  FROM pm_wallet_engine_pnl_cache
)
SELECT
  wm.wallet,
  wm.fills,
  wm.markets,
  round(wm.total_notional) as notional,
  round(COALESCE(lp.total_pnl, 0), 2) as lifetime_pnl,

  -- 14d metrics
  round(wm.mean_14d, 2) as mean_14d_bps,
  round(wm.mean_14d / (wm.std_14d + 1), 4) as sharpe_14d,
  round(wm.mean_14d / (wm.downside_std_14d + 1), 4) as sortino_14d,
  round(wm.win_rate_14d, 1) as win_rate_14d,

  -- 30d metrics
  round(wm.mean_30d, 2) as mean_30d_bps,
  round(wm.mean_30d / (wm.std_30d + 1), 4) as sharpe_30d,
  round(wm.mean_30d / (wm.downside_std_30d + 1), 4) as sortino_30d,
  round(wm.win_rate_30d, 1) as win_rate_30d,

  -- T-stats
  round((wm.mean_14d / (wm.std_14d + 1)) * sqrt(wm.fills), 2) as t_stat_14d,
  round((wm.mean_30d / (wm.std_30d + 1)) * sqrt(wm.fills), 2) as t_stat_30d,

  -- Tier classification
  CASE
    WHEN (wm.mean_30d / (wm.std_30d + 1)) * sqrt(wm.fills) >= 5 THEN 'exceptional'
    WHEN (wm.mean_30d / (wm.std_30d + 1)) * sqrt(wm.fills) >= 3 THEN 'strong'
    ELSE 'moderate'
  END AS tier

FROM wallet_markout wm
LEFT JOIN lifetime_pnl lp ON wm.wallet = lp.wallet
WHERE wm.mean_14d > 0
  AND wm.mean_30d > 0  -- Positive at both horizons
  AND wm.mean_30d / (wm.downside_std_30d + 1) > 0  -- Positive 30d Sortino
  AND COALESCE(lp.total_pnl, 0) >= 200  -- PnL >= $200
ORDER BY t_stat_30d DESC
LIMIT 100
`;

  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const wallets = await result.json() as any[];

  // Export to JSON
  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: "De-risked copyable wallets - minimal filters for maximum pool",
      filters: {
        pnl_minimum: "$200 lifetime",
        markout_horizons: "positive at BOTH 14d and 30d",
        sortino_30d: "> 0",
        min_fills: 30,
        min_markets: 8,
        min_notional: "$1000"
      }
    },
    summary: {
      total_wallets: wallets.length,
      exceptional_tier: wallets.filter((w: any) => w.tier === 'exceptional').length,
      strong_tier: wallets.filter((w: any) => w.tier === 'strong').length,
      avg_pnl: Math.round(wallets.reduce((sum: number, w: any) => sum + (w.lifetime_pnl || 0), 0) / wallets.length),
      avg_30d_sortino: (wallets.reduce((sum: number, w: any) => sum + (w.sortino_30d || 0), 0) / wallets.length).toFixed(2)
    },
    wallets
  };

  const jsonPath = exportDir + "/derisked_copyable_v1.json";
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log("Saved to: " + jsonPath);

  // Print summary
  console.log("\n=== SUMMARY ===");
  console.log("Total wallets passing all filters:", wallets.length);
  console.log("Exceptional (t30 >= 5):", wallets.filter((w: any) => w.tier === 'exceptional').length);
  console.log("Strong (t30 >= 3):", wallets.filter((w: any) => w.tier === 'strong').length);

  // Print top 20
  console.log("\n=== TOP 20 DE-RISKED WALLETS ===");
  console.log("Wallet                                     | PnL      | Sort14 | Sort30 | t30   | Win30%");
  console.log("-------------------------------------------|----------|--------|--------|-------|-------");

  for (const w of wallets.slice(0, 20)) {
    console.log([
      w.wallet,
      ("$" + w.lifetime_pnl).padStart(8),
      String(w.sortino_14d).padStart(6),
      String(w.sortino_30d).padStart(6),
      String(w.t_stat_30d).padStart(5),
      (w.win_rate_30d + "%").padStart(6)
    ].join(" | "));
  }

  // Generate Polymarket URLs for top 10
  console.log("\n=== TOP 10 POLYMARKET URLS ===");
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log(`${i+1}. https://polymarket.com/profile/${w.wallet}`);
    console.log(`   PnL: $${w.lifetime_pnl} | Sortino30: ${w.sortino_30d} | t30: ${w.t_stat_30d}`);
  }
}

main().catch(console.error);
