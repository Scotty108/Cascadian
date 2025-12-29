/**
 * Top 100 wallets by combined lifetime + 30d t-stat
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  console.log('=== TOP 100 BY COMBINED LIFETIME + 30D T-STAT ===\n');

  const query = `
    WITH
    max_date AS (SELECT max(trade_date) as d FROM wallet_daily_stats_v2),

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
      GROUP BY wallet
      HAVING fills >= 50
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
      GROUP BY wallet
      HAVING fills >= 10
    ),

    combined AS (
      SELECT
        lt.wallet,
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
      WHERE lt.sum_wx / lt.sum_w > 0
        AND d30.sum_wx / d30.sum_w > 0
    )

    SELECT
      *,
      -- Combined score: minimum of both t-stats (ensures strong in BOTH periods)
      least(lt_tstat, d30_tstat) as min_tstat,
      -- Also compute geometric mean for ranking
      round(sqrt(lt_tstat * d30_tstat), 2) as geo_mean_tstat
    FROM combined
    WHERE lt_tstat >= 2 AND d30_tstat >= 2
    ORDER BY least(lt_tstat, d30_tstat) DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];

  console.log('Wallet                                     | LT t-stat | 30d t-stat | Min t | Volume');
  console.log('-------------------------------------------|-----------|------------|-------|--------');

  for (const w of wallets) {
    console.log(
      `${w.wallet} | ${String(w.lt_tstat).padStart(9)} | ${String(w.d30_tstat).padStart(10)} | ${String(w.min_tstat).padStart(5)} | $${Number(w.volume).toLocaleString()}`
    );
  }

  // Export to CSV
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  const headers = ['wallet', 'polymarket_url', 'lifetime_tstat', 'd30_tstat', 'min_tstat', 'lifetime_fills', 'd30_fills', 'maker_pct', 'volume_usd'];
  const rows = wallets.map((w: any) => [
    w.wallet,
    `https://polymarket.com/profile/${w.wallet}`,
    w.lt_tstat,
    w.d30_tstat,
    w.min_tstat,
    w.lt_fills,
    w.d30_fills,
    w.maker_pct,
    w.volume
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  fs.writeFileSync(path.join(exportDir, 'top_100_dual_tstat.csv'), csv);

  console.log(`\n✅ Exported to exports/copytrade/top_100_dual_tstat.csv`);
}

main().catch(console.error);
