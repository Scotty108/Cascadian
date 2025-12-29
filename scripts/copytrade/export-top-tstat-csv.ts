/**
 * Export top t-stat wallets to CSV
 * Includes lifetime t-stat, 30d t-stat, fills, volume
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const MIN_LIFETIME_FILLS = 50;
const MIN_30D_FILLS = 10;

async function main() {
  console.log('=== EXPORT TOP T-STAT WALLETS TO CSV ===\n');

  // Query wallets with both lifetime and 30d stats
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
      HAVING fills >= ${MIN_LIFETIME_FILLS}
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
      HAVING fills >= ${MIN_30D_FILLS}
    )

    SELECT
      lt.wallet,
      lt.fills as lifetime_fills,
      round(lt.volume, 2) as volume,
      round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,

      round(lt.sum_wx / lt.sum_w, 2) as lt_mean_bps,
      round(
        (lt.sum_wx / lt.sum_w) /
        (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
        sqrt(lt.fills),
        2
      ) as lt_tstat,

      coalesce(d30.fills, 0) as d30_fills,
      coalesce(round(d30.sum_wx / nullIf(d30.sum_w, 0), 2), 0) as d30_mean_bps,
      coalesce(round(
        (d30.sum_wx / nullIf(d30.sum_w, 0)) /
        (sqrt(greatest((d30.sum_wx2 / nullIf(d30.sum_w, 0)) - pow(d30.sum_wx / nullIf(d30.sum_w, 0), 2), 0)) + 1) *
        sqrt(d30.fills),
        2
      ), 0) as d30_tstat

    FROM lifetime lt
    LEFT JOIN d30 ON lt.wallet = d30.wallet

    WHERE lt.sum_wx / lt.sum_w > 0  -- Positive lifetime mean

    ORDER BY
      -- Prioritize wallets with both strong lifetime AND 30d performance
      CASE
        WHEN (lt.sum_wx / lt.sum_w) /
             (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
             sqrt(lt.fills) >= 2.0
             AND coalesce(
               (d30.sum_wx / nullIf(d30.sum_w, 0)) /
               (sqrt(greatest((d30.sum_wx2 / nullIf(d30.sum_w, 0)) - pow(d30.sum_wx / nullIf(d30.sum_w, 0), 2), 0)) + 1) *
               sqrt(d30.fills), 0
             ) >= 2.0
        THEN 0
        ELSE 1
      END,
      -- Then by lifetime t-stat
      (lt.sum_wx / lt.sum_w) /
      (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
      sqrt(lt.fills) DESC

    LIMIT 500
  `;

  console.log('Querying top t-stat wallets...');
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];
  console.log(`Found ${wallets.length} wallets\n`);

  // Create CSV
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const headers = [
    'wallet',
    'polymarket_url',
    'lifetime_tstat',
    'lifetime_mean_bps',
    'lifetime_fills',
    'd30_tstat',
    'd30_mean_bps',
    'd30_fills',
    'maker_pct',
    'total_volume_usd'
  ];

  const rows = wallets.map((w: any) => [
    w.wallet,
    `https://polymarket.com/profile/${w.wallet}`,
    w.lt_tstat,
    w.lt_mean_bps,
    w.lifetime_fills,
    w.d30_tstat,
    w.d30_mean_bps,
    w.d30_fills,
    w.maker_pct,
    w.volume
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const csvPath = path.join(exportDir, 'top_tstat_wallets_corrected.csv');
  fs.writeFileSync(csvPath, csv);

  console.log('=== TOP 20 BY LIFETIME T-STAT ===\n');
  console.log('Wallet                                     | LT t    | 30d t   | LT Fills | 30d Fills | Volume');
  console.log('-------------------------------------------|---------|---------|----------|-----------|--------');

  for (const w of wallets.slice(0, 20)) {
    const emoji = w.d30_tstat >= 2 ? '✅' : w.d30_tstat >= 1 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lt_tstat).padStart(7)} | ${String(w.d30_tstat).padStart(7)} | ${String(w.lifetime_fills).padStart(8)} | ${String(w.d30_fills).padStart(9)} | $${Number(w.volume).toLocaleString()} ${emoji}`
    );
  }

  console.log(`\n✅ Exported ${wallets.length} wallets to: ${csvPath}`);

  // Summary stats
  const withBoth = wallets.filter((w: any) => w.lt_tstat >= 2 && w.d30_tstat >= 2);
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total wallets exported: ${wallets.length}`);
  console.log(`With LT t >= 2 AND 30d t >= 2: ${withBoth.length}`);
  console.log(`Avg lifetime t-stat: ${(wallets.reduce((a: number, w: any) => a + w.lt_tstat, 0) / wallets.length).toFixed(2)}`);
}

main().catch(console.error);
