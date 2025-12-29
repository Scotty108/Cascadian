import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  // Full rankings query with all metadata
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
  round(WM / W, 4) AS mean_bps,
  round(sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)), 4) AS std_bps,
  round((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1), 4) AS sharpe,
  round(if(W2 > 0, (W*W)/W2, 0), 2) AS n_eff,
  round(((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)), 4) AS t_stat,
  CASE
    WHEN ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) >= 10 THEN 'exceptional'
    WHEN ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) >= 3 THEN 'strong'
    WHEN (WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1) > 0 THEN 'positive'
    ELSE 'negative'
  END AS edge_tier
FROM wallet_stats ws
JOIN concentration c ON ws.wallet = c.wallet
WHERE ws.fills >= 30
  AND ws.markets >= 8
  AND ws.notional >= 1000
  AND c.max_concentration <= 0.3
ORDER BY t_stat DESC
LIMIT 500
`;

  console.log("Fetching top 500 wallets...");
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const wallets = await result.json() as any[];

  // Save to JSON
  const jsonOutput = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: "14-day markout sharpe ranking",
      markout_definition: "direction * (price_14d - entry_price)",
      sharpe_definition: "weighted_mean / weighted_std",
      t_stat_definition: "sharpe * sqrt(n_eff)",
      weight_formula: "min(sqrt(notional), 1000)",
      gates: {
        min_fills: 30,
        min_markets: 8,
        min_notional: 1000,
        max_concentration: "30%"
      }
    },
    summary: {
      total_wallets: wallets.length,
      exceptional_edge: wallets.filter((w: any) => w.edge_tier === 'exceptional').length,
      strong_edge: wallets.filter((w: any) => w.edge_tier === 'strong').length,
      positive_sharpe: wallets.filter((w: any) => w.edge_tier === 'positive').length
    },
    wallets
  };

  const jsonPath = exportDir + "/markout_14d_rankings_v1.json";
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log("Saved JSON to: " + jsonPath);

  // Save to CSV
  const csvHeader = "wallet,fills,markets,notional,concentration_pct,mean_bps,std_bps,sharpe,n_eff,t_stat,edge_tier";
  const csvRows = wallets.map((w: any) =>
    [w.wallet, w.fills, w.markets, w.notional, w.concentration_pct, w.mean_bps, w.std_bps, w.sharpe, w.n_eff, w.t_stat, w.edge_tier].join(",")
  );
  const csvContent = [csvHeader, ...csvRows].join("\n");

  const csvPath = exportDir + "/markout_14d_rankings_v1.csv";
  fs.writeFileSync(csvPath, csvContent);
  console.log("Saved CSV to: " + csvPath);

  // Per-category rankings (top 500)
  const catQuery = `
SELECT
  wallet,
  category,
  countMerge(fills) AS fills,
  uniqMerge(markets) AS markets,
  round(sumMerge(total_notional), 2) AS notional,
  round(sumMerge(sum_wm) / sumMerge(sum_w), 4) AS mean_bps,
  round((sumMerge(sum_wm) / sumMerge(sum_w)) /
    (sqrt(greatest((sumMerge(sum_wm2) / sumMerge(sum_w)) - pow(sumMerge(sum_wm) / sumMerge(sum_w), 2), 0)) + 1), 4) AS sharpe,
  round(((sumMerge(sum_wm) / sumMerge(sum_w)) /
    (sqrt(greatest((sumMerge(sum_wm2) / sumMerge(sum_w)) - pow(sumMerge(sum_wm) / sumMerge(sum_w), 2), 0)) + 1)) *
    sqrt(if(sumMerge(sum_w2) > 0, pow(sumMerge(sum_w), 2) / sumMerge(sum_w2), 0)), 4) AS t_stat
FROM markout_14d_wallet_cat_agg
GROUP BY wallet, category
HAVING fills >= 15 AND markets >= 5 AND notional >= 500
ORDER BY t_stat DESC
LIMIT 500
`;

  console.log("Fetching per-category rankings...");
  const catResult = await clickhouse.query({ query: catQuery, format: "JSONEachRow" });
  const catWallets = await catResult.json() as any[];

  const catJsonPath = exportDir + "/markout_14d_by_category_v1.json";
  fs.writeFileSync(catJsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    description: "Per-category markout rankings",
    gates: { min_fills: 15, min_markets: 5, min_notional: 500 },
    total_entries: catWallets.length,
    entries: catWallets
  }, null, 2));
  console.log("Saved category JSON to: " + catJsonPath);

  // Print summary
  console.log("\n=== EXPORT SUMMARY ===");
  console.log("Global rankings: " + wallets.length + " wallets");
  console.log("  - Exceptional (t>10): " + wallets.filter((w: any) => w.edge_tier === 'exceptional').length);
  console.log("  - Strong (t>3): " + wallets.filter((w: any) => w.edge_tier === 'strong').length);
  console.log("  - Positive sharpe: " + wallets.filter((w: any) => w.edge_tier === 'positive').length);
  console.log("Category rankings: " + catWallets.length + " wallet×category combos");

  // Top 10 summary
  console.log("\n=== TOP 10 BY T-STAT ===");
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log((i+1) + ". " + w.wallet.slice(0,10) + "... t=" + w.t_stat + ", sharpe=" + w.sharpe + ", fills=" + w.fills + ", mkts=" + w.markets);
  }
}

main().catch(console.error);
