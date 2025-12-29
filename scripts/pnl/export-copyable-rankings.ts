import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  const exportDir = "exports/copytrade";

  // Add filters to exclude market makers:
  // - max 500 fills/day average (human-scale)
  // - min avg notional $10 per fill (not dust trading)
  const query = `
WITH wallet_stats AS (
  SELECT
    wallet,
    sumMerge(sum_w) AS W,
    sumMerge(sum_w2) AS W2,
    sumMerge(sum_wm) AS WM,
    sumMerge(sum_wm2) AS WM2,
    countMerge(fills) AS fills,
    uniqMerge(markets) AS markets,
    sumMerge(total_notional) AS notional
  FROM markout_14d_wallet_cat_agg
  GROUP BY wallet
),
daily_activity AS (
  SELECT
    wallet,
    count() / uniq(trade_date) as avg_fills_per_day,
    avg(notional) as avg_fill_size
  FROM markout_14d_fills
  GROUP BY wallet
),
concentration AS (
  SELECT
    wallet,
    max(token_fills) / sum(token_fills) as max_concentration
  FROM (
    SELECT wallet, token_id, count() as token_fills
    FROM markout_14d_fills
    GROUP BY wallet, token_id
  )
  GROUP BY wallet
)
SELECT
  ws.wallet,
  ws.fills,
  ws.markets,
  round(ws.notional, 2) as notional,
  round(c.max_concentration * 100, 1) as concentration_pct,
  round(d.avg_fills_per_day, 1) as avg_fills_per_day,
  round(d.avg_fill_size, 2) as avg_fill_size,
  round(WM / W, 4) AS mean_bps,
  round((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1), 4) AS sharpe,
  round(((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)), 4) AS t_stat,
  CASE
    WHEN ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) >= 10 THEN 'exceptional'
    WHEN ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) >= 3 THEN 'strong'
    ELSE 'moderate'
  END AS edge_tier
FROM wallet_stats ws
JOIN concentration c ON ws.wallet = c.wallet
JOIN daily_activity d ON ws.wallet = d.wallet
WHERE ws.fills >= 30
  AND ws.markets >= 8
  AND ws.notional >= 1000
  AND c.max_concentration <= 0.3
  AND d.avg_fills_per_day <= 500  -- Exclude HFT/bots
  AND d.avg_fill_size >= 10       -- Exclude dust traders
  AND (WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1) > 0  -- Positive sharpe only
ORDER BY t_stat DESC
LIMIT 200
`;

  console.log("Fetching copyable wallets (excluding market makers)...");
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const wallets = await result.json() as any[];

  // Save to JSON
  const jsonOutput = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: "14-day markout sharpe ranking - copyable wallets only",
      filters: {
        min_fills: 30,
        min_markets: 8,
        min_notional: 1000,
        max_concentration: "30%",
        max_fills_per_day: 500,
        min_avg_fill_size: "$10",
        positive_sharpe: true
      }
    },
    summary: {
      total_wallets: wallets.length,
      exceptional_edge: wallets.filter((w: any) => w.edge_tier === 'exceptional').length,
      strong_edge: wallets.filter((w: any) => w.edge_tier === 'strong').length
    },
    wallets
  };

  const jsonPath = exportDir + "/copyable_wallets_v1.json";
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log("Saved to: " + jsonPath);

  // Print summary
  console.log("\n=== COPYABLE WALLETS SUMMARY ===");
  console.log("Total: " + wallets.length);
  console.log("Exceptional (t>10): " + wallets.filter((w: any) => w.edge_tier === 'exceptional').length);
  console.log("Strong (t>3): " + wallets.filter((w: any) => w.edge_tier === 'strong').length);

  // Top 15
  console.log("\n=== TOP 15 COPYABLE WALLETS ===");
  console.log("wallet                                     | t-stat | sharpe | fills | mkts | fills/day | avg_size");
  console.log("-------------------------------------------|--------|--------|-------|------|-----------|--------");
  for (let i = 0; i < Math.min(15, wallets.length); i++) {
    const w = wallets[i];
    console.log([
      w.wallet,
      String(w.t_stat).padStart(6),
      String(w.sharpe).padStart(6),
      String(w.fills).padStart(5),
      String(w.markets).padStart(4),
      String(w.avg_fills_per_day).padStart(9),
      "$" + String(w.avg_fill_size).padStart(6)
    ].join(" | "));
  }
}

main().catch(console.error);
