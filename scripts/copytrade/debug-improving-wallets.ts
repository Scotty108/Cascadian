/**
 * Debug the improving wallets query
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  console.log('=== DEBUG IMPROVING WALLETS ===\n');

  // 1. Check date range
  const dateRange = await clickhouse.query({
    query: `
      SELECT
        min(trade_date) as min_date,
        max(trade_date) as max_date,
        count() as total_rows,
        countDistinct(wallet) as unique_wallets,
        today() as today
      FROM markout_14d_fills
    `,
    format: 'JSONEachRow'
  });
  console.log('1. Date range:', (await dateRange.json())[0]);

  // 2. Check how many wallets have data in "recent" window (relative to max_date)
  const recentCount = await clickhouse.query({
    query: `
      SELECT
        count() as fills,
        countDistinct(wallet) as wallets
      FROM markout_14d_fills
      WHERE trade_date >= (SELECT max(trade_date) - 14 FROM markout_14d_fills)
    `,
    format: 'JSONEachRow'
  });
  console.log('\n2. Recent 14d (relative to max_date):', (await recentCount.json())[0]);

  // 3. Check t-stat distribution (all wallets, lifetime)
  const tstatDist = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,
          count() as fills,
          sum(weight) as tw,
          sum(weight2) as tw2,
          sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
          sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
            - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
        FROM markout_14d_fills
        GROUP BY wallet
        HAVING fills >= 30
      )
      SELECT
        countIf((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) > 0) as positive_tstat,
        countIf((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) > 1) as tstat_gt_1,
        countIf((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) > 1.5) as tstat_gt_1_5,
        countIf((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) > 2) as tstat_gt_2,
        countIf((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)) > 3) as tstat_gt_3,
        count() as total_wallets
      FROM wallet_stats
    `,
    format: 'JSONEachRow'
  });
  console.log('\n3. T-stat distribution (lifetime, min 30 fills):', (await tstatDist.json())[0]);

  // 4. Top 10 by lifetime t-stat (for reference)
  const topLifetime = await clickhouse.query({
    query: `
      WITH wallet_stats AS (
        SELECT
          wallet,
          count() as fills,
          sum(weight) as tw,
          sum(weight2) as tw2,
          sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
          sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
            - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
        FROM markout_14d_fills
        GROUP BY wallet
        HAVING fills >= 30
      )
      SELECT
        wallet,
        fills,
        round(wmean, 2) as mean_bps,
        round((wmean / (sqrt(greatest(wvar, 0)) + 1)) * sqrt(pow(tw, 2) / nullIf(tw2, 0)), 2) as tstat
      FROM wallet_stats
      WHERE wmean > 0
      ORDER BY tstat DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  console.log('\n4. Top 10 by lifetime t-stat:');
  const topRows = await topLifetime.json() as any[];
  topRows.forEach((r: any) => console.log(`  ${r.wallet.slice(0, 20)}... | fills=${r.fills} | mean=${r.mean_bps}bps | t=${r.tstat}`));

  // 5. Test the improving filter with the actual max date
  const improving = await clickhouse.query({
    query: `
      WITH
      max_date AS (SELECT max(trade_date) as d FROM markout_14d_fills),

      lifetime_stats AS (
        SELECT
          wallet,
          count() as fills,
          sum(weight) as tw,
          sum(weight2) as tw2,
          sum(weight * markout_bps) / nullIf(sum(weight), 0) as wmean,
          sum(weight * pow(markout_bps, 2)) / nullIf(sum(weight), 0)
            - pow(sum(weight * markout_bps) / nullIf(sum(weight), 0), 2) as wvar
        FROM markout_14d_fills
        GROUP BY wallet
        HAVING fills >= 30
      ),

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
        WHERE trade_date >= (SELECT d - 14 FROM max_date)
        GROUP BY wallet
        HAVING fills >= 10
      )

      SELECT
        lt.wallet,
        lt.fills as lt_fills,
        round(lt.wmean, 2) as lt_mean,
        round((lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)), 2) as lt_tstat,
        rec.fills as rec_fills,
        round(rec.wmean, 2) as rec_mean,
        round((rec.wmean / (sqrt(greatest(rec.wvar, 0)) + 1)) * sqrt(pow(rec.tw, 2) / nullIf(rec.tw2, 0)), 2) as rec_tstat
      FROM lifetime_stats lt
      JOIN recent_stats rec ON lt.wallet = rec.wallet
      WHERE lt.wmean > 0
        AND (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0)) >= 1.5
        AND (rec.wmean / (sqrt(greatest(rec.wvar, 0)) + 1)) * sqrt(pow(rec.tw, 2) / nullIf(rec.tw2, 0)) >
            (lt.wmean / (sqrt(greatest(lt.wvar, 0)) + 1)) * sqrt(pow(lt.tw, 2) / nullIf(lt.tw2, 0))
      ORDER BY rec_tstat DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  console.log('\n5. Improving wallets (recent > lifetime, using actual max date):');
  const improvingRows = await improving.json() as any[];
  console.log(`Found ${improvingRows.length} wallets`);
  improvingRows.slice(0, 10).forEach((r: any) => console.log(`  ${r.wallet.slice(0, 20)}... | lt=${r.lt_tstat} | rec=${r.rec_tstat} | lt_fills=${r.lt_fills} | rec_fills=${r.rec_fills}`));
}

main().catch(console.error);
