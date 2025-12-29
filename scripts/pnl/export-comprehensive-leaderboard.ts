import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== COMPREHENSIVE CATEGORY LEADERBOARD EXPORT ===\n");

  const query = `
WITH
-- Recent stats (last 30 days)
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
    avg(notional) as avg_trade,
    countIf(markout_bps > 0) as wins_recent,
    min(markout_bps) as worst_trade_bps,
    max(markout_bps) as best_trade_bps
  FROM markout_14d_fills
  WHERE trade_date >= today() - 30 AND length(category) > 0
  GROUP BY wallet, category
  HAVING fills_recent >= 20 AND markets_recent >= 5
),
-- Full stats (all 90 days)
full_stats AS (
  SELECT
    wallet,
    category,
    count() as fills_full,
    uniq(token_id) as markets_full,
    sum(notional) as notional_full,
    avg(markout_bps) as mean_full,
    stddevPop(markout_bps) as std_full,
    countIf(markout_bps > 0) as wins_full
  FROM markout_14d_fills
  WHERE length(category) > 0
  GROUP BY wallet, category
  HAVING fills_full >= 50 AND markets_full >= 8
),
-- Concentration per wallet-category
concentration_stats AS (
  SELECT
    wallet,
    category,
    max(mkt_fills) / sum(mkt_fills) as concentration
  FROM (
    SELECT wallet, category, token_id, count() as mkt_fills
    FROM markout_14d_fills
    WHERE length(category) > 0
    GROUP BY wallet, category, token_id
  )
  GROUP BY wallet, category
),
-- Activity metrics
activity AS (
  SELECT
    wallet,
    category,
    count() / greatest(uniq(trade_date), 1) as fills_per_day,
    uniq(trade_date) as active_days
  FROM markout_14d_fills
  WHERE length(category) > 0
  GROUP BY wallet, category
),
-- Category share (what % of wallet's trading is in this category)
wallet_totals AS (
  SELECT
    wallet,
    count() as total_fills
  FROM markout_14d_fills
  GROUP BY wallet
)
SELECT
  f.wallet as wallet,
  f.category as category,

  -- Sample sizes
  r.fills_recent as fills_recent,
  f.fills_full as fills_full,
  r.markets_recent as markets_recent,
  f.markets_full as markets_full,

  -- Volume
  round(r.notional_recent, 0) as notional_recent,
  round(f.notional_full, 0) as notional_full,

  -- Trade sizes
  round(r.median_trade, 2) as median_trade,
  round(r.avg_trade, 2) as avg_trade,

  -- Activity
  round(a.fills_per_day, 1) as fills_per_day,
  a.active_days as active_days,

  -- Edge metrics (in bps)
  round(r.mean_recent, 2) as edge_recent_bps,
  round(f.mean_full, 2) as edge_full_bps,

  -- Volatility
  round(r.std_recent, 2) as volatility_recent,
  round(f.std_full, 2) as volatility_full,

  -- Win rates
  round(r.wins_recent * 100.0 / r.fills_recent, 1) as win_rate_recent,
  round(f.wins_full * 100.0 / f.fills_full, 1) as win_rate_full,

  -- Best/worst trades
  round(r.best_trade_bps, 0) as best_trade_bps,
  round(r.worst_trade_bps, 0) as worst_trade_bps,

  -- Concentration
  round(cs.concentration * 100, 1) as concentration_pct,

  -- Category share
  round(f.fills_full * 100.0 / wt.total_fills, 1) as category_share_pct,

  -- T-stats
  round((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 2) as t_recent,
  round((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 2) as t_full,

  -- Sharpe ratios
  round(r.mean_recent / (r.std_recent + 1), 4) as sharpe_recent,
  round(f.mean_full / (f.std_full + 1), 4) as sharpe_full,

  -- Final score
  round(least(
    (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent),
    (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full)
  ), 2) as score,

  -- Consistency ratio (t_recent / t_full, 1.0 = perfectly consistent)
  round(
    (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent) /
    greatest((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 0.1),
    2
  ) as consistency_ratio

FROM full_stats f
JOIN recent_stats r ON f.wallet = r.wallet AND f.category = r.category
JOIN activity a ON f.wallet = a.wallet AND f.category = a.category
JOIN wallet_totals wt ON f.wallet = wt.wallet
JOIN concentration_stats cs ON f.wallet = cs.wallet AND f.category = cs.category
WHERE a.fills_per_day <= 200
  AND r.median_trade >= 10
  AND (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent) >= 3
  AND (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full) >= 3
  AND cs.concentration <= 0.35
ORDER BY f.category, score DESC
`;

  console.log("Fetching comprehensive metrics...");
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await result.json() as any[];
  console.log(`Found ${rows.length} wallet-category experts\n`);

  // Enrich with derived fields
  const enriched = rows.map((r: any) => {
    // Tier based on score
    let tier: string;
    if (r.score >= 20) tier = "S";
    else if (r.score >= 15) tier = "A";
    else if (r.score >= 10) tier = "B";
    else if (r.score >= 5) tier = "C";
    else tier = "D";

    // Trader type based on behavior
    let trader_type: string;
    if (r.fills_per_day <= 15 && r.median_trade >= 50) {
      trader_type = "Sniper";
    } else if (r.fills_per_day >= 80) {
      trader_type = "Grinder";
    } else if (r.median_trade >= 100) {
      trader_type = "Whale";
    } else if (r.category_share_pct >= 50) {
      trader_type = "Specialist";
    } else {
      trader_type = "Balanced";
    }

    // Risk level based on volatility and concentration
    let risk_level: string;
    const vol_score = r.volatility_full / 100; // normalize
    const conc_score = r.concentration_pct / 100;
    const risk_score = (vol_score + conc_score) / 2;

    if (risk_score <= 0.15) risk_level = "Low";
    else if (risk_score <= 0.25) risk_level = "Medium";
    else risk_level = "High";

    // Trend (recent vs full performance)
    let trend: string;
    if (r.consistency_ratio >= 1.2) trend = "Hot";
    else if (r.consistency_ratio >= 0.8) trend = "Steady";
    else trend = "Cooling";

    return {
      // Identity
      wallet: r.wallet,
      url: `https://polymarket.com/profile/${r.wallet}`,
      category: r.category,

      // Grades
      tier,
      trader_type,
      risk_level,
      trend,

      // Core metrics
      score: r.score,
      t_recent: r.t_recent,
      t_full: r.t_full,
      sharpe_recent: r.sharpe_recent,
      sharpe_full: r.sharpe_full,

      // Edge
      edge_recent_bps: r.edge_recent_bps,
      edge_full_bps: r.edge_full_bps,
      win_rate_recent: r.win_rate_recent,
      win_rate_full: r.win_rate_full,

      // Activity
      fills_recent: r.fills_recent,
      fills_full: r.fills_full,
      fills_per_day: r.fills_per_day,
      active_days: r.active_days,

      // Volume
      notional_recent: r.notional_recent,
      notional_full: r.notional_full,
      median_trade: r.median_trade,
      avg_trade: r.avg_trade,

      // Diversification
      markets_recent: r.markets_recent,
      markets_full: r.markets_full,
      concentration_pct: r.concentration_pct,
      category_share_pct: r.category_share_pct,

      // Risk metrics
      volatility_recent: r.volatility_recent,
      volatility_full: r.volatility_full,
      best_trade_bps: r.best_trade_bps,
      worst_trade_bps: r.worst_trade_bps,
      consistency_ratio: r.consistency_ratio
    };
  });

  // Export to CSV
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const headers = Object.keys(enriched[0]);
  const csvRows = [
    headers.join(","),
    ...enriched.map((r: any) =>
      headers.map(h => {
        const val = r[h];
        // Quote strings that might contain commas
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      }).join(",")
    )
  ];

  const csvPath = exportDir + "/category_leaderboard_comprehensive.csv";
  fs.writeFileSync(csvPath, csvRows.join("\n"));
  console.log(`Saved CSV to: ${csvPath}`);

  // Export to JSON
  const jsonPath = exportDir + "/category_leaderboard_comprehensive.json";
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_experts: enriched.length,
    methodology: {
      scoring: "min(t_recent, t_full) - dual horizon de-risking",
      tiers: {
        S: "score >= 20 (exceptional)",
        A: "score >= 15 (excellent)",
        B: "score >= 10 (strong)",
        C: "score >= 5 (moderate)",
        D: "score < 5 (developing)"
      },
      trader_types: {
        Sniper: "Low frequency, high conviction (<15 fills/day, >$50 median)",
        Grinder: "High frequency, consistent (>80 fills/day)",
        Whale: "Large trade sizes (>$100 median)",
        Specialist: "Category focused (>50% of trades in category)",
        Balanced: "Diversified approach"
      },
      risk_levels: {
        Low: "Low volatility + low concentration",
        Medium: "Moderate risk profile",
        High: "High volatility or concentration"
      },
      trends: {
        Hot: "Recent performance > historical (ratio > 1.2)",
        Steady: "Consistent performance (ratio 0.8-1.2)",
        Cooling: "Recent underperformance (ratio < 0.8)"
      }
    },
    by_category: Object.fromEntries(
      [...new Set(enriched.map((e: any) => e.category))].sort().map(cat => [
        cat,
        {
          count: enriched.filter((e: any) => e.category === cat).length,
          top_5: enriched.filter((e: any) => e.category === cat).slice(0, 5).map((e: any) => ({
            wallet: e.wallet,
            tier: e.tier,
            score: e.score,
            trader_type: e.trader_type
          }))
        }
      ])
    ),
    experts: enriched
  }, null, 2));
  console.log(`Saved JSON to: ${jsonPath}`);

  // Print summary by tier
  console.log("\n=== TIER DISTRIBUTION ===");
  const tiers = ["S", "A", "B", "C", "D"];
  for (const t of tiers) {
    const count = enriched.filter((e: any) => e.tier === t).length;
    console.log(`Tier ${t}: ${count} experts`);
  }

  // Print summary by trader type
  console.log("\n=== TRADER TYPE DISTRIBUTION ===");
  const types = ["Sniper", "Grinder", "Whale", "Specialist", "Balanced"];
  for (const t of types) {
    const count = enriched.filter((e: any) => e.trader_type === t).length;
    console.log(`${t}: ${count}`);
  }

  // Top 3 per category
  console.log("\n=== TOP 3 PER CATEGORY ===");
  const categories = [...new Set(enriched.map((e: any) => e.category))].sort();
  for (const cat of categories) {
    const catExperts = enriched.filter((e: any) => e.category === cat);
    console.log(`\n${cat.toUpperCase()}:`);
    for (const e of catExperts.slice(0, 3)) {
      console.log(`  ${e.tier} | ${e.wallet.slice(0,10)}... | score=${e.score} | ${e.trader_type} | ${e.risk_level} risk | ${e.trend}`);
    }
  }
}

main().catch(console.error);
