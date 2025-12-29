import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== PER-CATEGORY COPYABLE LEADERBOARD ===");
  console.log("Dual horizon: t_recent >= 3 AND t_full >= 3");
  console.log("Anti-bot: fills/day <= 200, median trade >= $10\n");

  const query = `
WITH
recent_stats AS (
  SELECT
    wallet,
    category,
    count() as fills_recent,
    uniq(token_id) as markets_recent,
    avg(markout_bps) as mean_recent,
    stddevPop(markout_bps) as std_recent,
    median(notional) as median_trade_recent
  FROM markout_14d_fills
  WHERE trade_date >= today() - 30 AND length(category) > 0
  GROUP BY wallet, category
  HAVING fills_recent >= 20 AND markets_recent >= 5
),
full_stats AS (
  SELECT
    wallet,
    category,
    count() as fills_full,
    uniq(token_id) as markets_full,
    avg(markout_bps) as mean_full,
    stddevPop(markout_bps) as std_full
  FROM markout_14d_fills
  WHERE length(category) > 0
  GROUP BY wallet, category
  HAVING fills_full >= 50 AND markets_full >= 8
),
activity AS (
  SELECT
    wallet,
    category,
    count() / greatest(uniq(trade_date), 1) as fills_per_day
  FROM markout_14d_fills
  WHERE length(category) > 0
  GROUP BY wallet, category
)
SELECT
  f.wallet as wallet,
  f.category as category,
  r.fills_recent as fills_recent,
  f.fills_full as fills_full,
  r.markets_recent as markets_recent,
  f.markets_full as markets_full,
  round(r.median_trade_recent, 2) as median_trade,
  round(a.fills_per_day, 1) as fills_per_day,
  round(r.mean_recent, 2) as mean_recent_bps,
  round(f.mean_full, 2) as mean_full_bps,
  round((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 2) as t_recent,
  round((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 2) as t_full,
  round(least(
    (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent),
    (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full)
  ), 2) as score
FROM full_stats f
JOIN recent_stats r ON f.wallet = r.wallet AND f.category = r.category
JOIN activity a ON f.wallet = a.wallet AND f.category = a.category
WHERE a.fills_per_day <= 200
  AND r.median_trade_recent >= 10
  AND (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent) >= 3
  AND (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full) >= 3
ORDER BY f.category, score DESC
`;

  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await result.json() as any[];

  // Group by category
  const byCategory: Record<string, any[]> = {};
  for (const row of rows) {
    const cat = row.category || "Other";
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(row);
  }

  // Print per-category leaderboards
  for (const [cat, wallets] of Object.entries(byCategory).sort()) {
    console.log(`\n=== ${cat.toUpperCase()} (${wallets.length} experts) ===`);
    console.log("Wallet       | score | t_rec | t_full | fills/d | med$");
    console.log("-------------|-------|-------|--------|---------|------");

    for (const w of wallets.slice(0, 10)) {
      console.log([
        (w.wallet || "unknown").slice(0, 12),
        String(w.score || 0).padStart(5),
        String(w.t_recent || 0).padStart(5),
        String(w.t_full || 0).padStart(6),
        String(w.fills_per_day || 0).padStart(7),
        ("$" + (w.median_trade || 0)).padStart(5)
      ].join(" | "));
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log("Total wallet-category combos:", rows.length);
  for (const [cat, wallets] of Object.entries(byCategory).sort()) {
    console.log(`  ${cat}: ${wallets.length} experts`);
  }

  // Export
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: "Per-category copyable leaderboard",
      scoring: "min(t_recent, t_full) - dual horizon de-risking",
      filters: {
        t_recent: ">= 3",
        t_full: ">= 3",
        fills_recent: ">= 20",
        fills_full: ">= 50",
        markets_recent: ">= 5",
        markets_full: ">= 8",
        concentration: "<= 30%",
        fills_per_day: "<= 200 (anti-bot)",
        median_trade: ">= $10 (anti-dust)"
      }
    },
    categories: Object.fromEntries(
      Object.entries(byCategory).map(([cat, wallets]) => [
        cat,
        {
          expert_count: wallets.length,
          top_10: wallets.slice(0, 10).map((w: any) => ({
            wallet: w.wallet,
            score: w.score,
            t_recent: w.t_recent,
            t_full: w.t_full,
            fills_per_day: w.fills_per_day,
            median_trade: w.median_trade,
            url: `https://polymarket.com/profile/${w.wallet}`
          }))
        }
      ])
    )
  };

  fs.writeFileSync(exportDir + "/category_leaderboard_v1.json", JSON.stringify(output, null, 2));
  console.log("\nExported to: exports/copytrade/category_leaderboard_v1.json");
}

main().catch(console.error);
