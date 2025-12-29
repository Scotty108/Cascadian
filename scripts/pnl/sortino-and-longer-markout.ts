import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { clickhouse } from "../../lib/clickhouse/client";

async function main() {
  console.log("=== SORTINO RATIO + LONGER MARKOUT ANALYSIS ===\n");

  // First, check our price data coverage for 30d and 60d
  const coverageQuery = `
  SELECT
    'Price Coverage' as metric,
    min(price_date) as earliest,
    max(price_date) as latest,
    count() as total_days,
    uniq(token_id) as unique_tokens
  FROM _daily_prices_ref
  `;
  
  const coverage = await clickhouse.query({ query: coverageQuery, format: "JSONEachRow" });
  const covRows = await coverage.json() as any[];
  console.log("Price data:", covRows[0]);

  // Calculate Sortino (only downside deviation) + compare 14d vs 30d markout
  const sortinoQuery = `
  WITH 
  -- Get fills with 14d and 30d prices
  fills_with_prices AS (
    SELECT
      t.wallet,
      t.token_id as token_id,
      t.trade_date,
      t.side,
      t.fill_price,
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
        AND trade_time <= now() - INTERVAL 30 DAY  -- Need 30d forward for markout
        AND token_amount > 0
        AND usdc_amount > 0
    ) t
    LEFT JOIN _daily_prices_ref p14 ON t.token_id = p14.token_id AND p14.price_date = t.trade_date + 14
    LEFT JOIN _daily_prices_ref p30 ON t.token_id = p30.token_id AND p30.price_date = t.trade_date + 30
    WHERE p14.end_of_day_price > 0.01 AND p14.end_of_day_price < 0.99
      AND p30.end_of_day_price > 0.01 AND p30.end_of_day_price < 0.99
  ),
  -- Calculate Sortino components per wallet
  wallet_stats AS (
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
  )
  SELECT
    wallet,
    fills,
    markets,
    round(total_notional) as notional,
    
    -- 14d Sharpe & Sortino (add epsilon=1 to avoid infinity)
    round(mean_14d, 2) as mean_14d,
    round(mean_14d / (std_14d + 1), 4) as sharpe_14d,
    round(mean_14d / (downside_std_14d + 1), 4) as sortino_14d,
    round(win_rate_14d, 1) as win_rate_14d,

    -- 30d Sharpe & Sortino
    round(mean_30d, 2) as mean_30d,
    round(mean_30d / (std_30d + 1), 4) as sharpe_30d,
    round(mean_30d / (downside_std_30d + 1), 4) as sortino_30d,
    round(win_rate_30d, 1) as win_rate_30d,
    
    -- T-stats
    round((mean_14d / (std_14d + 1)) * sqrt(fills), 2) as t_stat_14d,
    round((mean_30d / (std_30d + 1)) * sqrt(fills), 2) as t_stat_30d
    
  FROM wallet_stats
  WHERE mean_14d > 0 AND mean_30d > 0  -- Positive at both horizons
  ORDER BY sortino_30d DESC
  LIMIT 30
  `;

  console.log("\n=== TOP 30 BY 30-DAY SORTINO (Positive at 14d AND 30d) ===\n");
  
  const result = await clickhouse.query({ query: sortinoQuery, format: "JSONEachRow" });
  const rows = await result.json() as any[];

  console.log("Wallet       | Fills | 14d Sort | 30d Sort | 14d Win% | 30d Win% | t-14d | t-30d");
  console.log("-------------|-------|----------|----------|----------|----------|-------|------");
  
  for (const r of rows.slice(0, 20)) {
    console.log([
      r.wallet.slice(0,12),
      String(r.fills).padStart(5),
      String(r.sortino_14d).padStart(8),
      String(r.sortino_30d).padStart(8),
      String(r.win_rate_14d + "%").padStart(8),
      String(r.win_rate_30d + "%").padStart(8),
      String(r.t_stat_14d).padStart(5),
      String(r.t_stat_30d).padStart(5)
    ].join(" | "));
  }

  // Summary stats
  console.log("\n=== SUMMARY ===");
  console.log("Total wallets positive at BOTH 14d and 30d:", rows.length);
  
  const highSortino = rows.filter((r: any) => r.sortino_30d > 1).length;
  console.log("Sortino 30d > 1.0:", highSortino);
  
  const highTstat = rows.filter((r: any) => r.t_stat_30d > 3).length;
  console.log("T-stat 30d > 3:", highTstat);
}

main().catch(console.error);
