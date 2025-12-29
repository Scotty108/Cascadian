import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== DUAL HORIZON T-STAT RANKING ===");
  console.log("Filter: t_stat_14d > 3 AND t_stat_90d > 3");
  console.log("No PnL filter, no sortino, no win% - just consistent edge\n");

  // Use existing markout_14d_fills table - split into recent (14d) vs full (90d)
  const query = `
WITH
-- Recent 14-day window (last 14-30 days of trading)
recent_stats AS (
  SELECT
    wallet,
    count() as fills_recent,
    uniq(token_id) as markets_recent,
    avg(markout_bps) as mean_recent,
    stddevPop(markout_bps) as std_recent
  FROM markout_14d_fills
  WHERE trade_date >= today() - 30  -- Recent month
  GROUP BY wallet
  HAVING fills_recent >= 20 AND markets_recent >= 5
),
-- Full 90-day window (all data in table)
full_stats AS (
  SELECT
    wallet,
    count() as fills_full,
    uniq(token_id) as markets_full,
    avg(markout_bps) as mean_full,
    stddevPop(markout_bps) as std_full
  FROM markout_14d_fills
  GROUP BY wallet
  HAVING fills_full >= 50 AND markets_full >= 10
)
SELECT
  f.wallet,

  -- Recent stats
  r.fills_recent,
  r.markets_recent,
  round(r.mean_recent, 2) as mean_recent_bps,
  round((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 2) as t_stat_recent,

  -- Full 90d stats
  f.fills_full,
  f.markets_full,
  round(f.mean_full, 2) as mean_full_bps,
  round((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 2) as t_stat_full,

  -- Combined score
  round(sqrt(
    greatest((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 0.1) *
    greatest((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 0.1)
  ), 2) as combined_t

FROM full_stats f
JOIN recent_stats r ON f.wallet = r.wallet
WHERE (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent) >= 3  -- recent t >= 3
  AND (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full) >= 3        -- full t >= 3
ORDER BY combined_t DESC
LIMIT 50
`;

  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const wallets = await result.json() as any[];

  console.log("=== TOP 50 CONSISTENT EDGE WALLETS ===");
  console.log("Wallet                                     | t_rec | t_90d | comb  | fills_rec | fills_90d");
  console.log("-------------------------------------------|-------|-------|-------|-----------|----------");

  for (const w of wallets.slice(0, 30)) {
    console.log([
      w.wallet,
      String(w.t_stat_recent).padStart(5),
      String(w.t_stat_full).padStart(5),
      String(w.combined_t).padStart(5),
      String(w.fills_recent).padStart(9),
      String(w.fills_full).padStart(9)
    ].join(" | "));
  }

  console.log("\n=== SUMMARY ===");
  console.log("Total wallets with t_recent >= 3 AND t_90d >= 3:", wallets.length);

  // Export
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: "Dual-horizon t-stat ranking - consistent edge filter",
      filters: {
        t_stat_recent: ">= 3 (last 30 days edge)",
        t_stat_90d: ">= 3 (full 90d edge)",
        min_fills_recent: 20,
        min_fills_90d: 50,
        min_markets_recent: 5,
        min_markets_90d: 10
      },
      rationale: "Filters out: (1) old wallets that slowed down, (2) new wallets on lucky streaks",
      note: "No PnL filter, no sortino, no win% - just consistent edge"
    },
    total_wallets: wallets.length,
    wallets: wallets.map((w: any) => ({
      wallet: w.wallet,
      t_stat_recent: w.t_stat_recent,
      t_stat_90d: w.t_stat_full,
      combined_t: w.combined_t,
      fills_recent: w.fills_recent,
      fills_90d: w.fills_full,
      mean_recent_bps: w.mean_recent_bps,
      mean_90d_bps: w.mean_full_bps,
      url: `https://polymarket.com/profile/${w.wallet}`
    }))
  };

  fs.writeFileSync(exportDir + "/dual_horizon_tstat_v1.json", JSON.stringify(output, null, 2));
  console.log("\nExported to: exports/copytrade/dual_horizon_tstat_v1.json");

  // Top 10 URLs
  console.log("\n=== TOP 10 COPYABLE WALLETS ===");
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log(`${i+1}. https://polymarket.com/profile/${w.wallet}`);
    console.log(`   t_recent: ${w.t_stat_recent} | t_90d: ${w.t_stat_full} | combined: ${w.combined_t}`);
  }
}

main().catch(console.error);
