/**
 * Query Dual-Horizon T-Stat from Complete V2 Table
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
const MIN_LIFETIME_TSTAT = 2.0;
const MIN_30D_TSTAT = 2.0;

async function main() {
  console.log('=== DUAL-HORIZON T-STAT (FULL ALL-TIME) ===\n');

  const stateResult = await clickhouse.query({
    query: `
      SELECT
        count() as rows,
        countDistinct(wallet) as wallets,
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        sum(fills) as total_fills
      FROM wallet_daily_stats_v2
    `,
    format: 'JSONEachRow'
  });
  const state = (await stateResult.json() as any[])[0];
  console.log(`Data: ${Number(state.rows).toLocaleString()} rows, ${Number(state.wallets).toLocaleString()} wallets`);
  console.log(`Date range: ${state.min_date} to ${state.max_date}`);
  console.log(`Total fills: ${Number(state.total_fills).toLocaleString()}\n`);

  console.log('Querying dual-horizon t-stats (30d vs all-time)...');

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
      round(lt.volume, 0) as volume,
      round(100.0 * lt.maker_fills / lt.fills, 1) as maker_pct,

      round(lt.sum_wx / lt.sum_w, 2) as lt_mean_bps,
      round(sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)), 2) as lt_std_bps,
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
      ) as d30_tstat,

      round(
        ((d30.sum_wx / d30.sum_w) /
         (sqrt(greatest((d30.sum_wx2 / d30.sum_w) - pow(d30.sum_wx / d30.sum_w, 2), 0)) + 1) *
         sqrt(d30.fills)) /
        nullIf(
          (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills),
          0
        ),
        2
      ) as improvement

    FROM lifetime lt
    JOIN d30 ON lt.wallet = d30.wallet

    WHERE
      lt.sum_wx / lt.sum_w > 0
      AND (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills) >= ${MIN_LIFETIME_TSTAT}
      AND (d30.sum_wx / d30.sum_w) /
          (sqrt(greatest((d30.sum_wx2 / d30.sum_w) - pow(d30.sum_wx / d30.sum_w, 2), 0)) + 1) *
          sqrt(d30.fills) >= ${MIN_30D_TSTAT}
      AND (d30.sum_wx / d30.sum_w) /
          (sqrt(greatest((d30.sum_wx2 / d30.sum_w) - pow(d30.sum_wx / d30.sum_w, 2), 0)) + 1) *
          sqrt(d30.fills) >
          (lt.sum_wx / lt.sum_w) /
          (sqrt(greatest((lt.sum_wx2 / lt.sum_w) - pow(lt.sum_wx / lt.sum_w, 2), 0)) + 1) *
          sqrt(lt.fills)

    ORDER BY d30_tstat DESC
    LIMIT 100
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const wallets = await result.json() as any[];
  console.log(`Found ${wallets.length} improving high-skill wallets\n`);

  console.log('=== TOP IMPROVING WALLETS (30d > lifetime) ===');
  console.log('Filter: lifetime t >= 2, 30d t >= 2, 30d > lifetime\n');
  console.log('Wallet                                     | LT t    | 30d t   | Improve | Maker% | LT Fills | 30d Fills');
  console.log('-------------------------------------------|---------|---------|---------|--------|----------|----------');

  for (const w of wallets.slice(0, 30)) {
    const verdict = w.d30_tstat > 10 && w.lt_tstat > 5 ? '✅' :
                    w.d30_tstat > 5 && w.lt_tstat > 3 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lt_tstat).padStart(7)} | ${String(w.d30_tstat).padStart(7)} | ${String(w.improvement).padStart(6)}x | ${String(w.maker_pct).padStart(5)}% | ${String(w.lifetime_fills).padStart(8)} | ${String(w.d30_fills).padStart(9)} ${verdict}`
    );
  }

  console.log('\n=== TOP 10 FOR VALIDATION ===\n');
  for (let i = 0; i < Math.min(10, wallets.length); i++) {
    const w = wallets[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lt_tstat} (${w.lifetime_fills} fills, ${w.lt_mean_bps} bps mean)`);
    console.log(`   30-day:   t=${w.d30_tstat} (${w.d30_fills} fills, ${w.d30_mean_bps} bps mean)`);
    console.log(`   Maker %:  ${w.maker_pct}% | Volume: $${Number(w.volume).toLocaleString()}`);
    console.log('');
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    data_range: { min: state.min_date, max: state.max_date },
    filters: { MIN_LIFETIME_FILLS, MIN_30D_FILLS, MIN_LIFETIME_TSTAT, MIN_30D_TSTAT },
    total_wallets: wallets.length,
    wallets: wallets.map((w: any) => ({
      wallet: w.wallet,
      url: `https://polymarket.com/profile/${w.wallet}`,
      lt_tstat: w.lt_tstat,
      d30_tstat: w.d30_tstat,
      improvement: w.improvement,
      lt_fills: w.lifetime_fills,
      d30_fills: w.d30_fills,
      maker_pct: w.maker_pct,
      volume: w.volume,
    })),
  };

  fs.writeFileSync(path.join(exportDir, 'dual_horizon_alltime.json'), JSON.stringify(output, null, 2));
  console.log(`Exported to: ${exportDir}/dual_horizon_alltime.json`);
}

main().catch(console.error);
