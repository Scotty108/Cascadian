import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";

async function main() {
  // Check our daily price definition
  const priceDefQuery = `
SELECT 
  'Price definition check' as check_name,
  count() as total_prices,
  avg(snapshots) as avg_snapshots_per_day,
  min(snapshots) as min_snapshots,
  max(snapshots) as max_snapshots
FROM _daily_prices_ref
`;

  const priceDef = await clickhouse.query({ query: priceDefQuery, format: "JSONEachRow" });
  const priceRows = await priceDef.json();
  console.log("Daily price table stats:", priceRows[0]);

  // Now add coverage validation query
  const coverageQuery = `
WITH wallet_coverage AS (
  SELECT 
    wallet,
    count() as covered_fills,
    uniq(token_id) as covered_markets,
    sum(notional) as covered_notional
  FROM markout_14d_fills
  GROUP BY wallet
),
wallet_matured AS (
  SELECT 
    wallet,
    count() as matured_fills
  FROM (
    SELECT lower(trader_wallet) as wallet, event_id
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 AND role = 'taker'
      AND trade_time >= now() - INTERVAL 90 DAY
      AND trade_time <= now() - INTERVAL 14 DAY
      AND token_amount > 0
    GROUP BY wallet, event_id
  )
  GROUP BY wallet
),
wallet_stats AS (
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
  m.matured_fills,
  round(ws.fills / m.matured_fills * 100, 1) as coverage_pct,
  ws.markets as covered_markets,
  round(ws.notional) as covered_notional,
  round(c.max_concentration * 100, 1) as concentration_pct,
  round(WM / W, 2) AS mean_bps,
  round((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1), 4) AS sharpe,
  round(((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)), 2) AS t_stat
FROM wallet_stats ws
JOIN concentration c ON ws.wallet = c.wallet
JOIN wallet_matured m ON ws.wallet = m.wallet
WHERE ws.fills >= 30 
  AND ws.markets >= 8 
  AND ws.notional >= 1000
  AND c.max_concentration <= 0.3
  AND ws.fills / m.matured_fills >= 0.8
ORDER BY t_stat DESC
LIMIT 30
`;

  console.log("\n=== TOP 30 WALLETS WITH COVERAGE VALIDATION ===");
  console.log("Gates: fills>=30, markets>=8, notional>=$1k, concentration<=30%, coverage>=80%\n");

  const rankings = await clickhouse.query({ query: coverageQuery, format: "JSONEachRow" });
  const rows: any[] = await rankings.json();

  console.log("wallet                                     | covered | matured | cov% | mkts | notional | conc% | mean_bps | sharpe | t-stat");
  console.log("-------------------------------------------|---------|---------|------|------|----------|-------|----------|--------|-------");
  for (const r of rows) {
    const line = [
      r.wallet,
      String(r.covered_fills).padStart(7),
      String(r.matured_fills).padStart(7),
      String(r.coverage_pct).padStart(4) + "%",
      String(r.covered_markets).padStart(4),
      String(r.covered_notional).padStart(8),
      String(r.concentration_pct).padStart(5) + "%",
      String(r.mean_bps).padStart(8),
      String(r.sharpe).padStart(6),
      String(r.t_stat).padStart(6)
    ].join(" | ");
    console.log(line);
  }

  console.log("\nTotal wallets meeting all gates:", rows.length);

  // Count with different gate combinations
  const countQuery = `
WITH wallet_coverage AS (
  SELECT wallet, count() as covered_fills FROM markout_14d_fills GROUP BY wallet
),
wallet_matured AS (
  SELECT wallet, count() as matured_fills
  FROM (
    SELECT lower(trader_wallet) as wallet, event_id
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 AND role = 'taker'
      AND trade_time >= now() - INTERVAL 90 DAY
      AND trade_time <= now() - INTERVAL 14 DAY
      AND token_amount > 0
    GROUP BY wallet, event_id
  )
  GROUP BY wallet
),
wallet_stats AS (
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
    m.matured_fills,
    ws.fills / m.matured_fills as coverage,
    (WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1) AS sharpe,
    ((WM / W) / (sqrt(greatest((WM2 / W) - pow(WM / W, 2), 0)) + 1)) * sqrt(if(W2 > 0, (W*W)/W2, 0)) AS t_stat
  FROM wallet_stats ws
  JOIN concentration c ON ws.wallet = c.wallet
  JOIN wallet_matured m ON ws.wallet = m.wallet
)
SELECT 
  count() as total_wallets,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000) as pass_basic,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3) as pass_conc30,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND coverage >= 0.8) as pass_cov80,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND coverage >= 0.8 AND sharpe > 0) as positive_sharpe,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND coverage >= 0.8 AND t_stat > 3) as strong_edge,
  countIf(fills >= 30 AND markets >= 8 AND notional >= 1000 AND max_conc <= 0.3 AND coverage >= 0.8 AND t_stat > 10) as exceptional
FROM combined
`;

  console.log("\n=== GATE FUNNEL ===");
  const counts = await clickhouse.query({ query: countQuery, format: "JSONEachRow" });
  const countRows: any[] = await counts.json();
  const c = countRows[0];
  console.log("Total wallets with agg data:", c.total_wallets);
  console.log("Pass basic (30+ fills, 8+ mkts, \$1k+):", c.pass_basic);
  console.log("Pass concentration <= 30%:", c.pass_conc30);
  console.log("Pass coverage >= 80%:", c.pass_cov80);
  console.log("Positive sharpe:", c.positive_sharpe);
  console.log("Strong edge (t > 3):", c.strong_edge);
  console.log("Exceptional edge (t > 10):", c.exceptional);
}

main().catch(console.error);
