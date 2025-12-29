/**
 * Improving Wallets (Fast version using pre-computed markout table)
 *
 * Uses markout_14d_fills which is already:
 * - Resolution-based markout
 * - Taker-only
 * - Pre-calculated weights
 *
 * Since the table only has ~6 weeks of data, we compare:
 * - "Lifetime" = all data in table (~45 days)
 * - "Recent" = last 14 days
 *
 * Filter: recent t-stat > lifetime t-stat (improving wallets)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

const MIN_LIFETIME_FILLS = 30;
const MIN_RECENT_FILLS = 10;
const MIN_LIFETIME_TSTAT = 1.5;
const RECENT_DAYS = 14;

async function main() {
  console.log('=== IMPROVING WALLETS (FAST) ===\n');
  console.log('Using pre-computed markout_14d_fills table (taker-only, resolution-based)');
  console.log(`Compare: All data (~45d) vs Recent ${RECENT_DAYS}d`);
  console.log(`Filter: recent t-stat > lifetime t-stat`);
  console.log('');

  const query = `
    WITH
    -- "Lifetime" stats (all data in table)
    lifetime_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(notional) as volume,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM markout_14d_fills
      GROUP BY wallet
      HAVING fills >= {min_lt_fills:UInt32}
    ),

    -- Get max date in data (since data may be stale)
    max_data_date AS (SELECT max(trade_date) as d FROM markout_14d_fills),

    -- Recent stats (last N days RELATIVE TO MAX DATA DATE)
    recent_stats AS (
      SELECT
        wallet,
        count() as fills,
        sum(weight) as tw,
        sum(weight2) as tw2,
        sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
        sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
          - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
      FROM markout_14d_fills
      WHERE trade_date >= (SELECT d - {recent_days:UInt32} FROM max_data_date)
      GROUP BY wallet
      HAVING fills >= {min_recent_fills:UInt32}
    )

    SELECT
      lt.wallet,

      -- Lifetime
      lt.fills as lifetime_fills,
      round(lt.volume, 0) as lifetime_volume,
      round(lt.wmean, 2) as lifetime_mean_bps,
      round((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 2) as lifetime_tstat,

      -- Recent
      rec.fills as recent_fills,
      round(rec.wmean, 2) as recent_mean_bps,
      round((rec.wmean / (sqrt(greatest(rec.wvar, 0)) + 1)) * sqrt(pow(rec.tw, 2) / nullIf(rec.tw2, 0)), 2) as recent_tstat,

      -- Improvement
      round(
        (rec.wmean / (sqrt(greatest(rec.wvar, 0)) + 1)) * sqrt(pow(rec.tw, 2) / nullIf(rec.tw2, 0)) /
        nullIf((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 0),
        2
      ) as improvement_ratio

    FROM lifetime_stats lt
    JOIN recent_stats rec ON lt.wallet = rec.wallet

    WHERE
      -- Positive lifetime edge
      lt.wmean > 0
      -- Minimum lifetime t-stat
      AND (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)) >= {min_lt_tstat:Float64}
      -- Recent t-stat > lifetime t-stat (improving)
      AND (rec.wmean / (sqrt(greatest(rec.wvar, 0)) + 1)) * sqrt(pow(rec.tw, 2) / nullIf(rec.tw2, 0)) >
          (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0))

    ORDER BY recent_tstat DESC
    LIMIT 100
  `;

  console.log('Running query...');
  const result = await clickhouse.query({
    query,
    query_params: {
      min_lt_fills: MIN_LIFETIME_FILLS,
      min_recent_fills: MIN_RECENT_FILLS,
      min_lt_tstat: MIN_LIFETIME_TSTAT,
      recent_days: RECENT_DAYS,
    },
    format: 'JSONEachRow',
  });

  const wallets = await result.json() as any[];

  console.log(`\nFound ${wallets.length} improving wallets\n`);

  // Display results
  console.log('=== IMPROVING WALLETS (recent t-stat > lifetime t-stat) ===\n');
  console.log('Wallet                                     | LT t-stat | Rec t-stat | Improve | LT Fills | Rec Fills | Volume');
  console.log('-------------------------------------------|-----------|------------|---------|----------|-----------|----------');

  for (const w of wallets.slice(0, 30)) {
    const verdict = w.recent_tstat > 4 && w.lifetime_tstat > 2 ? '✅' :
                    w.recent_tstat > 2 && w.lifetime_tstat > 1.5 ? '👀' : '⚠️';
    console.log(
      `${w.wallet} | ${String(w.lifetime_tstat).padStart(9)} | ${String(w.recent_tstat).padStart(10)} | ${String(w.improvement_ratio).padStart(6)}x | ${String(w.lifetime_fills).padStart(8)} | ${String(w.recent_fills).padStart(9)} | $${String(w.lifetime_volume).padStart(8)} ${verdict}`
    );
  }

  // Top picks with URLs
  console.log('\n=== TOP 10 COPYABLE WALLETS ===\n');
  const topPicks = wallets.filter(w =>
    w.recent_tstat > 2 &&
    w.lifetime_tstat > 1.5 &&
    w.improvement_ratio > 1.0
  ).slice(0, 10);

  for (let i = 0; i < topPicks.length; i++) {
    const w = topPicks[i];
    console.log(`${i + 1}. ${w.wallet}`);
    console.log(`   https://polymarket.com/profile/${w.wallet}`);
    console.log(`   Lifetime: t=${w.lifetime_tstat} (${w.lifetime_fills} fills, ${w.lifetime_mean_bps} bps avg)`);
    console.log(`   Recent:   t=${w.recent_tstat} (${w.recent_fills} fills, ${w.recent_mean_bps} bps avg)`);
    console.log(`   Improvement: ${w.improvement_ratio}x`);
    console.log('');
  }

  // Export
  const exportDir = path.resolve(__dirname, '../../exports/copytrade');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      description: `Improving wallets: ${RECENT_DAYS}d t-stat > lifetime (~45d) t-stat`,
      data_source: 'markout_14d_fills (taker-only, resolution-based markout)',
      filters: {
        min_lifetime_fills: MIN_LIFETIME_FILLS,
        min_recent_fills: MIN_RECENT_FILLS,
        min_lifetime_tstat: MIN_LIFETIME_TSTAT,
        recent_window_days: RECENT_DAYS,
      },
      rationale: 'Wallets where recent skill exceeds historical average - improving traders',
    },
    total_wallets: wallets.length,
    wallets: wallets.map((w: any) => ({
      wallet: w.wallet,
      lifetime_tstat: w.lifetime_tstat,
      recent_tstat: w.recent_tstat,
      improvement_ratio: w.improvement_ratio,
      lifetime_fills: w.lifetime_fills,
      recent_fills: w.recent_fills,
      lifetime_mean_bps: w.lifetime_mean_bps,
      recent_mean_bps: w.recent_mean_bps,
      lifetime_volume: w.lifetime_volume,
      url: `https://polymarket.com/profile/${w.wallet}`,
    })),
  };

  fs.writeFileSync(
    path.join(exportDir, 'improving_wallets_fast.json'),
    JSON.stringify(output, null, 2)
  );
  console.log(`\nExported to: ${exportDir}/improving_wallets_fast.json`);
}

main().catch(console.error);
