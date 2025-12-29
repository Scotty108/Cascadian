import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== WALLET MATRIX EXPORT (Per-Category Scores) ===\n");

  // Get all wallet-category data with taker ratio filter
  const query = `
WITH
-- Filter to taker-dominant wallets with positive cash flow
wallet_health AS (
  SELECT
    lower(trader_wallet) as wallet,
    countIf(role = 'taker') * 100.0 / count() as taker_pct,
    (sumIf(usdc_amount, side = 'sell') - sumIf(usdc_amount, side = 'buy')) / 1e6 as net_cash_flow_usd
  FROM pm_trader_events_v2
  WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 90 DAY
  GROUP BY lower(trader_wallet)
  HAVING taker_pct >= 30  -- At least 30% taker (not pure market maker)
    AND net_cash_flow_usd > -50000  -- Not massively underwater
),
recent_stats AS (
  SELECT
    wallet,
    category,
    count() as fills_recent,
    uniq(token_id) as markets_recent,
    sum(notional) as notional_recent,
    avg(markout_bps) as mean_recent,
    stddevPop(markout_bps) as std_recent,
    median(notional) as median_trade,
    countIf(markout_bps > 0) * 100.0 / count() as win_rate
  FROM markout_14d_fills
  WHERE trade_date >= today() - 30 AND length(category) > 0
  GROUP BY wallet, category
),
full_stats AS (
  SELECT
    wallet,
    category,
    count() as fills_full,
    uniq(token_id) as markets_full,
    sum(notional) as notional_full,
    avg(markout_bps) as mean_full,
    stddevPop(markout_bps) as std_full
  FROM markout_14d_fills
  WHERE length(category) > 0
  GROUP BY wallet, category
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
  round(f.notional_full, 0) as notional,
  round(r.median_trade, 2) as median_trade,
  round(a.fills_per_day, 1) as fills_per_day,
  round(r.mean_recent, 2) as edge_bps,
  round(r.win_rate, 1) as win_rate,
  round((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 2) as t_recent,
  round((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 2) as t_full,
  round(least(
    (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent),
    (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full)
  ), 2) as score,
  round(wh.taker_pct, 1) as taker_pct,
  round(wh.net_cash_flow_usd, 0) as net_cash_flow
FROM full_stats f
JOIN recent_stats r ON f.wallet = r.wallet AND f.category = r.category
JOIN activity a ON f.wallet = a.wallet AND f.category = a.category
JOIN wallet_health wh ON f.wallet = wh.wallet
WHERE a.fills_per_day <= 200
  AND r.median_trade >= 10
  AND r.fills_recent >= 15
  AND f.fills_full >= 30
  AND r.markets_recent >= 3
  AND f.markets_full >= 5
ORDER BY wallet, category
`;

  console.log("Fetching per-category metrics...");
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await result.json() as any[];
  console.log(`Found ${rows.length} wallet-category combinations\n`);

  // Pivot: group by wallet, create columns for each category
  const categories = ["Crypto", "Politics", "Sports", "Tech", "Finance", "Economy", "Culture", "World", "Other"];

  const walletMap: Record<string, any> = {};

  for (const row of rows) {
    if (!walletMap[row.wallet]) {
      walletMap[row.wallet] = {
        wallet: row.wallet,
        url: `https://polymarket.com/profile/${row.wallet}`,
        taker_pct: row.taker_pct,
        net_cash_flow: row.net_cash_flow,
        // Will fill in category-specific fields
      };
    }

    const cat = row.category;
    const w = walletMap[row.wallet];

    // Store per-category metrics
    w[`${cat}_score`] = row.score;
    w[`${cat}_t_recent`] = row.t_recent;
    w[`${cat}_t_full`] = row.t_full;
    w[`${cat}_edge_bps`] = row.edge_bps;
    w[`${cat}_win_rate`] = row.win_rate;
    w[`${cat}_fills`] = row.fills_full;
    w[`${cat}_notional`] = row.notional;
    w[`${cat}_median_trade`] = row.median_trade;
    w[`${cat}_fills_per_day`] = row.fills_per_day;
  }

  // Convert to array and compute aggregates
  const wallets = Object.values(walletMap).map((w: any) => {
    // Count active categories (where they have a score)
    const activeCategories = categories.filter(c => w[`${c}_score`] !== undefined);
    w.active_categories = activeCategories.length;
    w.categories_list = activeCategories.join(", ");

    // Best category
    let bestCat = "";
    let bestScore = -999;
    for (const cat of categories) {
      const score = w[`${cat}_score`] || 0;
      if (score > bestScore) {
        bestScore = score;
        bestCat = cat;
      }
    }
    w.best_category = bestCat;
    w.best_score = bestScore;

    // Tier based on best score
    if (bestScore >= 20) w.tier = "S";
    else if (bestScore >= 15) w.tier = "A";
    else if (bestScore >= 10) w.tier = "B";
    else if (bestScore >= 5) w.tier = "C";
    else w.tier = "D";

    // Total metrics across all categories
    w.total_fills = categories.reduce((sum, c) => sum + (w[`${c}_fills`] || 0), 0);
    w.total_notional = categories.reduce((sum, c) => sum + (w[`${c}_notional`] || 0), 0);

    // Average metrics where they have data
    const scores = categories.map(c => w[`${c}_score`]).filter(s => s !== undefined);
    w.avg_score = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 100) / 100 : 0;

    // Trader type based on behavior
    const totalFillsPerDay = categories.reduce((sum, c) => sum + (w[`${c}_fills_per_day`] || 0), 0);
    const avgMedianTrade = categories.filter(c => w[`${c}_median_trade`]).length > 0
      ? categories.reduce((sum, c) => sum + (w[`${c}_median_trade`] || 0), 0) / categories.filter(c => w[`${c}_median_trade`]).length
      : 0;

    if (activeCategories.length === 1) w.trader_type = "Specialist";
    else if (totalFillsPerDay <= 20 && avgMedianTrade >= 50) w.trader_type = "Sniper";
    else if (totalFillsPerDay >= 100) w.trader_type = "Grinder";
    else if (avgMedianTrade >= 80) w.trader_type = "Whale";
    else w.trader_type = "Balanced";

    return w;
  });

  // Sort by best score
  wallets.sort((a, b) => b.best_score - a.best_score);

  // Filter to wallets with at least score >= 3 in their best category
  const qualified = wallets.filter(w => w.best_score >= 3);

  console.log(`Qualified wallets (best score >= 3): ${qualified.length}`);

  // Build CSV headers
  const baseHeaders = [
    "wallet", "url", "tier", "trader_type", "best_category", "best_score", "avg_score",
    "active_categories", "categories_list", "total_fills", "total_notional",
    "taker_pct", "net_cash_flow"
  ];

  const categoryHeaders: string[] = [];
  for (const cat of categories) {
    categoryHeaders.push(
      `${cat}_score`, `${cat}_t_recent`, `${cat}_t_full`,
      `${cat}_edge_bps`, `${cat}_win_rate`, `${cat}_fills`,
      `${cat}_notional`, `${cat}_median_trade`, `${cat}_fills_per_day`
    );
  }

  const allHeaders = [...baseHeaders, ...categoryHeaders];

  // Export CSV
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const csvRows = [
    allHeaders.join(","),
    ...qualified.map(w =>
      allHeaders.map(h => {
        const val = w[h];
        if (val === undefined || val === null) return "";
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",")
    )
  ];

  const csvPath = exportDir + "/wallet_category_matrix.csv";
  fs.writeFileSync(csvPath, csvRows.join("\n"));
  console.log(`\nSaved CSV to: ${csvPath}`);

  // Export JSON
  const jsonPath = exportDir + "/wallet_category_matrix.json";
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_wallets: qualified.length,
    categories,
    methodology: {
      scoring: "min(t_recent, t_full) per category",
      qualification: "best_score >= 3 in at least one category",
      tiers: { S: "≥20", A: "≥15", B: "≥10", C: "≥5", D: "<5" },
      health_filters: {
        taker_pct: ">= 30% (exclude pure market makers)",
        net_cash_flow: "> -$50k (exclude massively underwater wallets)"
      },
      note: "Markout measures TAKER entry timing. Wallets with negative UI PnL may have good taker timing but losses from maker activity or unresolved positions."
    },
    tier_distribution: {
      S: qualified.filter(w => w.tier === "S").length,
      A: qualified.filter(w => w.tier === "A").length,
      B: qualified.filter(w => w.tier === "B").length,
      C: qualified.filter(w => w.tier === "C").length,
      D: qualified.filter(w => w.tier === "D").length
    },
    wallets: qualified
  }, null, 2));
  console.log(`Saved JSON to: ${jsonPath}`);

  // Print summary
  console.log("\n=== TIER DISTRIBUTION ===");
  for (const t of ["S", "A", "B", "C", "D"]) {
    console.log(`Tier ${t}: ${qualified.filter(w => w.tier === t).length}`);
  }

  console.log("\n=== TOP 15 WALLETS ===");
  console.log("Tier | Wallet       | Best Cat  | Score | Taker% | Cash Flow | Type");
  console.log("-----|--------------|-----------|-------|--------|-----------|----------");
  for (const w of qualified.slice(0, 15)) {
    console.log([
      w.tier.padEnd(4),
      w.wallet.slice(0, 12),
      w.best_category.padEnd(9),
      String(w.best_score).padStart(5),
      String(w.taker_pct + "%").padStart(6),
      ("$" + (w.net_cash_flow >= 0 ? "" : "") + w.net_cash_flow).padStart(9),
      w.trader_type
    ].join(" | "));
  }

  // Show a sample wallet with all their category scores
  console.log("\n=== SAMPLE WALLET BREAKDOWN ===");
  const sample = qualified[0];
  console.log(`Wallet: ${sample.wallet}`);
  console.log(`URL: ${sample.url}`);
  console.log(`Tier: ${sample.tier} | Type: ${sample.trader_type}`);
  console.log("\nPer-Category Scores:");
  for (const cat of categories) {
    const score = sample[`${cat}_score`];
    if (score !== undefined) {
      console.log(`  ${cat.padEnd(10)}: score=${score}, t_rec=${sample[`${cat}_t_recent`]}, t_full=${sample[`${cat}_t_full`]}, win=${sample[`${cat}_win_rate`]}%`);
    }
  }
}

main().catch(console.error);
