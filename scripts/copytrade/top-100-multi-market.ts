/**
 * Top 100 wallets by t-stat - MULTI-MARKET filter
 * Excludes one-market wonders by requiring trades across multiple condition_ids
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const MIN_MARKETS = 5;  // Must have traded in at least 5 different markets
const MIN_FILLS = 50;
const MIN_30D_FILLS = 10;

async function main() {
  console.log('=== TOP 100 BY T-STAT (MULTI-MARKET FILTER) ===');
  console.log(`Filters: >= ${MIN_MARKETS} unique markets, >= ${MIN_FILLS} lifetime fills, >= ${MIN_30D_FILLS} 30d fills\n`);

  // First get wallets with enough unique markets
  const query = `
    WITH
    max_date AS (SELECT max(trade_date) as d FROM wallet_daily_stats_v2),

    -- Map tokens to condition_ids
    token_to_market AS (
      SELECT
        arrayElement(token_ids, 1) as token_id,
        condition_id
      FROM pm_market_metadata
      UNION ALL
      SELECT
        arrayElement(token_ids, 2) as token_id,
        condition_id
      FROM pm_market_metadata
    ),

    -- Count unique markets per wallet from source data
    market_diversity AS (
      SELECT
        t.trader_wallet as wallet,
        count(DISTINCT tm.condition_id) as unique_markets
      FROM pm_trader_events_dedup_v2_tbl t
      JOIN token_to_market tm ON t.token_id = tm.token_id
      WHERE (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) > 0.10
        AND (t.usdc_amount / 1e6) / nullIf(t.token_amount / 1e6, 0) < 0.90
      GROUP BY t.trader_wallet
      HAVING unique_markets >= ${MIN_MARKETS}
    ),

    lifetime AS (
      SELECT
        wallet,
        sum(fills) as fills,
        sum(maker_fills) as maker_fills,
        sum(sum_w) as sum_w,
        sum(sum_wx) as sum_wx,
        sum(sum_wx2) as sum_wx2,
        sum(total_notional) as volume
      FROM wallet_daily_stats_v2
      WHERE wallet IN (SELECT wallet FROM market_diversity)
      GROUP BY wallet
      HAVING fills >= ${MIN_FILLS}
    ),

    d30 AS (
      SELECT
        wallet,
        sum(fills) as fills,
        sum(sum_w) as sum_w,
        sum(sum_wx) as sum_wx,
        sum(sum_wx2) as sum_wx2
      FROM wallet_daily_stats_v2
      WHERE trade_date >= (SELECT d - 30 FROM max_date)
        AND wallet IN (SELECT wallet FROM market_diversity)
      GROUP BY wallet
      HAVING fills >= ${MIN_30D_FILLS}
    ),

    combined AS (
      SELECT
        lt.wallet,
        md.unique_markets,
        lt.fills as lt_fills,
        round(lt.volume, 2) as volume,
        round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,
        round(lt.sum_wx / lt.sum_w, 2) as lt_mean_bps,
        round(
          (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills),
          2
        ) as lt_tstat,
        d30.fills as d30_fills,
        round(d30.sum_wx / d30.sum_w, 2) as d30_mean_bps,
        round(
          (d30.sum_wx / d30.sum_w) /
          (sqrt(greatest((d30.sum_wx2 / d30.sum_w) - pow(d30.sum_wx / d30.sum_w, 2), 0)) + 1) *
          sqrt(d30.fills),
          2
        ) as d30_tstat
      FROM lifetime lt
      JOIN d30 ON lt.wallet = d30.wallet
      JOIN market_diversity md ON lt.wallet = md.wallet
      WHERE lt.sum_wx / lt.sum_w > 0
        AND d30.sum_wx / d30.sum_w > 0
    )

    SELECT
      *,
      least(lt_tstat, d30_tstat) as min_tstat
    FROM combined
    WHERE lt_tstat >= 2 AND d30_tstat >= 2
    ORDER BY least(lt_tstat, d30_tstat) DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];

  console.log('Wallet                                     | Markets | LT t  | 30d t | Min t | Volume');
  console.log('-------------------------------------------|---------|-------|-------|-------|--------');

  for (const w of wallets) {
    console.log(
      `${w.wallet} | ${String(w.unique_markets).padStart(7)} | ${String(w.lt_tstat).padStart(5)} | ${String(w.d30_tstat).padStart(5)} | ${String(w.min_tstat).padStart(5)} | $${Number(w.volume).toLocaleString()}`
    );
  }

  // Export to CSV
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  const headers = ['wallet', 'polymarket_url', 'unique_markets', 'lifetime_tstat', 'd30_tstat', 'min_tstat', 'lifetime_fills', 'd30_fills', 'maker_pct', 'volume_usd'];
  const rows = wallets.map((w: any) => [
    w.wallet,
    `https://polymarket.com/profile/${w.wallet}`,
    w.unique_markets,
    w.lt_tstat,
    w.d30_tstat,
    w.min_tstat,
    w.lt_fills,
    w.d30_fills,
    w.maker_pct,
    w.volume
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(path.join(exportDir, 'top_100_multi_market.csv'), csv);

  console.log(`\n✅ Exported ${wallets.length} wallets to exports/copytrade/top_100_multi_market.csv`);
}

main().catch(console.error);
