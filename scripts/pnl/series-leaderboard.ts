import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";
import * as fs from "fs";

async function main() {
  console.log("=== PER-SERIES T-STAT LEADERBOARD ===\n");

  const query = `
WITH
-- Expand token_ids array and join with series_slug
token_series AS (
  SELECT
    arrayJoin(token_ids) as token_id,
    series_slug
  FROM pm_market_metadata
  WHERE length(series_slug) > 0
),
-- Join markout fills with series
fills_with_series AS (
  SELECT
    m.wallet,
    m.token_id,
    m.markout_bps,
    m.notional,
    m.trade_date,
    ts.series_slug
  FROM markout_14d_fills m
  JOIN token_series ts ON m.token_id = ts.token_id
),
-- Recent stats per wallet-series (last 30 days)
recent_stats AS (
  SELECT
    wallet,
    series_slug,
    count() as fills_recent,
    uniq(token_id) as markets_recent,
    avg(markout_bps) as mean_recent,
    stddevPop(markout_bps) as std_recent,
    sum(notional) as notional_recent,
    countIf(markout_bps > 0) * 100.0 / count() as win_rate
  FROM fills_with_series
  WHERE trade_date >= today() - 30
  GROUP BY wallet, series_slug
  HAVING fills_recent >= 15 AND markets_recent >= 5
),
-- Full stats per wallet-series (all time in table)
full_stats AS (
  SELECT
    wallet,
    series_slug,
    count() as fills_full,
    uniq(token_id) as markets_full,
    avg(markout_bps) as mean_full,
    stddevPop(markout_bps) as std_full,
    sum(notional) as notional_full
  FROM fills_with_series
  GROUP BY wallet, series_slug
  HAVING fills_full >= 30 AND markets_full >= 10
)
SELECT
  f.series_slug,
  f.wallet,
  r.fills_recent,
  f.fills_full,
  r.markets_recent,
  f.markets_full,
  round(r.mean_recent, 2) as edge_bps,
  round(r.win_rate, 1) as win_rate,
  round(r.notional_recent, 0) as notional,
  round((r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent), 2) as t_recent,
  round((f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full), 2) as t_full,
  round(least(
    (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent),
    (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full)
  ), 2) as score
FROM full_stats f
JOIN recent_stats r ON f.wallet = r.wallet AND f.series_slug = r.series_slug
WHERE (r.mean_recent / (r.std_recent + 1)) * sqrt(r.fills_recent) >= 2
  AND (f.mean_full / (f.std_full + 1)) * sqrt(f.fills_full) >= 2
ORDER BY f.series_slug, score DESC
`;

  console.log("Running query...");
  const result = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = (await result.json()) as any[];
  console.log(`Found ${rows.length} wallet-series combinations\n`);

  // Group by series and get top per series
  const bySeries: Record<string, any[]> = {};
  for (const row of rows) {
    const series = row.series_slug;
    if (!bySeries[series]) {
      bySeries[series] = [];
    }
    bySeries[series].push(row);
  }

  // Sort series by best expert score
  const seriesList = Object.entries(bySeries)
    .map(([series, wallets]) => ({ series, wallets, topScore: wallets[0]?.score || 0 }))
    .sort((a, b) => b.topScore - a.topScore);

  console.log("=== TOP 30 SERIES BY BEST EXPERT SCORE ===\n");
  console.log("Series                      | #Experts | Top Score | Top Wallet");
  console.log("----------------------------|----------|-----------|------------");

  for (const { series, wallets, topScore } of seriesList.slice(0, 30)) {
    const top = wallets[0];
    console.log(
      [
        series.slice(0, 27).padEnd(27),
        String(wallets.length).padStart(8),
        String(topScore).padStart(9),
        top.wallet.slice(0, 10) + "...",
      ].join(" | ")
    );
  }

  // Export full data
  const exportDir = "exports/copytrade";
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    total_series: Object.keys(bySeries).length,
    total_experts: rows.length,
    methodology: {
      scoring: "min(t_recent, t_full) per series",
      filters: {
        t_recent: ">= 2",
        t_full: ">= 2",
        fills_recent: ">= 15",
        fills_full: ">= 30",
        markets_recent: ">= 5",
        markets_full: ">= 10",
      },
    },
    series: Object.fromEntries(
      seriesList.map(({ series, wallets }) => [
        series,
        {
          expert_count: wallets.length,
          top_5: wallets.slice(0, 5).map((w: any) => ({
            wallet: w.wallet,
            score: w.score,
            t_recent: w.t_recent,
            t_full: w.t_full,
            edge_bps: w.edge_bps,
            win_rate: w.win_rate,
            fills: w.fills_full,
            url: "https://polymarket.com/profile/" + w.wallet,
          })),
        },
      ])
    ),
  };

  fs.writeFileSync(exportDir + "/series_leaderboard_v1.json", JSON.stringify(output, null, 2));
  console.log("\nExported to: exports/copytrade/series_leaderboard_v1.json");

  // Also export CSV with all wallet-series combinations
  const csvHeaders = [
    "series_slug",
    "wallet",
    "url",
    "score",
    "t_recent",
    "t_full",
    "edge_bps",
    "win_rate",
    "fills_recent",
    "fills_full",
    "notional",
  ];
  const csvRows = [
    csvHeaders.join(","),
    ...rows.map((r: any) =>
      [
        r.series_slug,
        r.wallet,
        `https://polymarket.com/profile/${r.wallet}`,
        r.score,
        r.t_recent,
        r.t_full,
        r.edge_bps,
        r.win_rate,
        r.fills_recent,
        r.fills_full,
        r.notional,
      ].join(",")
    ),
  ];
  fs.writeFileSync(exportDir + "/series_leaderboard_v1.csv", csvRows.join("\n"));
  console.log("Exported CSV to: exports/copytrade/series_leaderboard_v1.csv");
}

main().catch(console.error);
