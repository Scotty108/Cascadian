import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";

async function main() {
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
  ws.fills as covered_fills,
  ws.markets as covered_markets,
  round(ws.notional) as covered_notional,
  round(c.max_concentration * 100, 1) as concentration_pct,
  round(WM / W, 2) AS mean_bps,
  round((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1), 4) AS sharpe,
  round(((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)), 2) AS t_stat
FROM wallet_stats ws
JOIN concentration c ON ws.wallet = c.wallet
WHERE ws.fills >= 30 
  AND ws.markets >= 8 
  AND ws.notional >= 1000
  AND c.max_concentration <= 0.3
ORDER BY t_stat DESC
LIMIT 30
`;

  console.log("=== TOP 30 WALLETS (GPT's tighter 30% concentration gate) ===\n");

  const rankings = await clickhouse.query({ query, format: "JSONEachRow" });
  const rows = await rankings.json() as any[];

  console.log("wallet                                     | fills | mkts | notional | conc% | mean_bps | sharpe | t-stat");
  console.log("-------------------------------------------|-------|------|----------|-------|----------|--------|-------");
  for (const r of rows) {
    const line = [
      r.wallet,
      String(r.covered_fills).padStart(5),
      String(r.covered_markets).padStart(4),
      String(r.covered_notional).padStart(8),
      String(r.concentration_pct).padStart(5) + "%",
      String(r.mean_bps).padStart(8),
      String(r.sharpe).padStart(6),
      String(r.t_stat).padStart(6)
    ].join(" | ");
    console.log(line);
  }

  const countQuery = `
WITH wallet_stats AS (
  SELECT wallet,
    sumMerge(sum_w) AS W, sumMerge(sum_w2) AS W2,
    sumMerge(sum_wm) AS WM, sumMerge(sum_wm2) AS WM2,
    countMerge(fills) AS fills, uniqMerge(markets) AS markets,
    sumMerge(total_notional) AS notional
  FROM markout_14d_wallet_cat_agg GROUP BY wallet
),
concentration AS (
  SELECT wallet, max(token_fills) / sum(token_fills) as max_conc
  FROM (SELECT wallet, token_id, count() as token_fills FROM markout_14d_fills GROUP BY wallet, token_id)
  GROUP BY wallet
),
combined AS (
  SELECT 
    ws.*,
    c.max_conc,
    (WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1) AS sharpe,
    ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) AS t_stat
  FROM wallet_stats ws
  JOIN concentration c ON ws.wallet = c.wallet
)
SELECT 
  count() as total_wallets,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000) as pass_basic,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3) as pass_conc30,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.4) as pass_conc40,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND sharpe > 0) as positive_sharpe,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND t_stat > 3) as strong_edge,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND t_stat > 10) as exceptional
FROM combined
`;

  console.log("\n=== GATE FUNNEL ===");
  const counts = await clickhouse.query({ query: countQuery, format: "JSONEachRow" });
  const countRows = await counts.json() as any[];
  const c = countRows[0];
  console.log("Total wallets with markout data:", c.total_wallets);
  console.log("Pass basic (30+ fills, 8+ mkts, $1k+):", c.pass_basic);
  console.log("Pass concentration <= 40%:", c.pass_conc40);
  console.log("Pass concentration <= 30%:", c.pass_conc30);
  console.log("Positive sharpe (30% conc gate):", c.positive_sharpe);
  console.log("Strong edge (t > 3):", c.strong_edge);
  console.log("Exceptional edge (t > 10):", c.exceptional);
}

main().catch(console.error);
