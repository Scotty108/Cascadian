import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function validate() {
  // 1. Top 5 candidates
  console.log('=== TOP 5 CANDIDATES ===');
  const top5 = await clickhouse.query({
    query: `
      SELECT wallet, total_pnl, expectancy, sortino, score, rank, n_positions, hit_rate
      FROM pm_copytrade_candidates_v1
      ORDER BY rank LIMIT 5
    `,
    format: 'JSONEachRow'
  }).then(r => r.json());
  console.table(top5);

  // 2. Outlier check
  console.log('\n=== OUTLIER CHECK ===');
  const outliers = await clickhouse.query({
    query: `
      SELECT
        count(*) as total,
        countIf(expectancy > 10) as crazy_high_expectancy,
        countIf(sortino > 100) as crazy_high_sortino,
        countIf(profit_factor > 50) as crazy_high_pf,
        countIf(hit_rate > 0.95) as suspiciously_high_hitrate
      FROM pm_copytrade_candidates_v1
    `,
    format: 'JSONEachRow'
  }).then(r => r.json());
  console.table(outliers);

  // 3. Distribution
  console.log('\n=== DISTRIBUTION (PERCENTILES) ===');
  const dist = await clickhouse.query({
    query: `
      SELECT
        round(quantile(0.25)(expectancy), 4) as p25_exp,
        round(quantile(0.50)(expectancy), 4) as p50_exp,
        round(quantile(0.75)(expectancy), 4) as p75_exp,
        round(quantile(0.25)(sortino), 4) as p25_sortino,
        round(quantile(0.50)(sortino), 4) as p50_sortino,
        round(quantile(0.75)(sortino), 4) as p75_sortino,
        round(quantile(0.25)(score), 4) as p25_score,
        round(quantile(0.50)(score), 4) as p50_score,
        round(quantile(0.75)(score), 4) as p75_score
      FROM pm_copytrade_candidates_v1
    `,
    format: 'JSONEachRow'
  }).then(r => r.json());
  console.table(dist);

  // 4. Score distribution buckets
  console.log('\n=== SCORE BUCKETS ===');
  const buckets = await clickhouse.query({
    query: `
      SELECT
        multiIf(
          score < 0.1, '0-0.1',
          score < 0.5, '0.1-0.5',
          score < 1, '0.5-1',
          score < 2, '1-2',
          score < 5, '2-5',
          '5+'
        ) as bucket,
        count(*) as cnt
      FROM pm_copytrade_candidates_v1
      GROUP BY bucket
      ORDER BY bucket
    `,
    format: 'JSONEachRow'
  }).then(r => r.json());
  console.table(buckets);

  // 5. Top wallet details for manual verification
  console.log('\n=== TOP WALLET FOR MANUAL CHECK ===');
  const topWallet = (top5 as any[])[0]?.wallet;
  if (topWallet) {
    console.log(`\nTop wallet: ${topWallet}`);
    console.log(`Check on Polymarket: https://polymarket.com/profile/${topWallet}`);
    console.log(`Check on Analytics: https://polymarketanalytics.com/wallet/${topWallet}`);
  }
}

validate().catch(console.error);
