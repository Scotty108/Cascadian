import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function analyzeHighCoverageWallets() {
  console.log('=== HIGH-COVERAGE WALLET ANALYSIS ===\n');

  // Get statistics on high-coverage wallets
  const analysisQuery = `
    WITH wallet_coverage AS (
      SELECT
        wallet_address_norm,
        count() as total_trades,
        countIf(
          condition_id_norm != ''
          AND condition_id_norm != concat('0x', repeat('0',64))
          AND length(replaceAll(condition_id_norm, '0x', '')) = 64
        ) as valid_trades,
        round(valid_trades / total_trades * 100, 2) as coverage_pct
      FROM vw_trades_canonical
      WHERE wallet_address_norm != ''
      GROUP BY wallet_address_norm
      HAVING total_trades > 0
    ),
    high_coverage_wallets AS (
      SELECT * FROM wallet_coverage WHERE coverage_pct >= 80
    )
    SELECT
      -- Volume distribution
      quantile(0.5)(total_trades) as median_trades,
      quantile(0.9)(total_trades) as p90_trades,
      max(total_trades) as max_trades,

      -- Total volume captured
      sum(total_trades) as total_trades_high_coverage,
      sum(valid_trades) as total_valid_trades_high_coverage,

      -- Coverage quality
      avg(coverage_pct) as avg_coverage_pct,
      min(coverage_pct) as min_coverage_pct,

      -- Count
      count() as num_high_coverage_wallets,

      -- What % of TOTAL trade volume do these wallets represent?
      round(sum(total_trades) / (SELECT count() FROM vw_trades_canonical) * 100, 2) as pct_of_total_volume
    FROM high_coverage_wallets
  `;

  const result = await client.query({ query: analysisQuery, format: 'JSONEachRow' });
  const stats = (await result.json())[0];

  console.log('HIGH-COVERAGE WALLETS (≥80% coverage):');
  console.log(`  Count: ${Number(stats.num_high_coverage_wallets).toLocaleString()}`);
  console.log(`  Median trades per wallet: ${Number(stats.median_trades).toLocaleString()}`);
  console.log(`  P90 trades per wallet: ${Number(stats.p90_trades).toLocaleString()}`);
  console.log(`  Max trades per wallet: ${Number(stats.max_trades).toLocaleString()}`);
  console.log(`  Average coverage: ${stats.avg_coverage_pct}%`);
  console.log(`  Total trade volume: ${Number(stats.total_trades_high_coverage).toLocaleString()}`);
  console.log(`  % of total platform volume: ${stats.pct_of_total_volume}%\n`);

  // Get top 10 high-coverage wallets by volume
  const top10Query = `
    WITH wallet_coverage AS (
      SELECT
        wallet_address_norm,
        count() as total_trades,
        countIf(
          condition_id_norm != ''
          AND condition_id_norm != concat('0x', repeat('0',64))
          AND length(replaceAll(condition_id_norm, '0x', '')) = 64
        ) as valid_trades,
        round(valid_trades / total_trades * 100, 2) as coverage_pct
      FROM vw_trades_canonical
      WHERE wallet_address_norm != ''
      GROUP BY wallet_address_norm
      HAVING coverage_pct >= 80
    )
    SELECT
      wallet_address_norm,
      total_trades,
      valid_trades,
      coverage_pct
    FROM wallet_coverage
    ORDER BY total_trades DESC
    LIMIT 10
  `;

  const top10Result = await client.query({ query: top10Query, format: 'JSONEachRow' });
  const top10 = await top10Result.json();

  console.log('TOP 10 HIGH-COVERAGE WALLETS BY VOLUME:');
  top10.forEach((wallet: any, idx: number) => {
    console.log(`  ${idx + 1}. ${wallet.wallet_address_norm}`);
    console.log(`     Trades: ${Number(wallet.total_trades).toLocaleString()}, Valid: ${Number(wallet.valid_trades).toLocaleString()}, Coverage: ${wallet.coverage_pct}%`);
  });

  console.log('\n=== RECOMMENDATION ===\n');

  const volumePct = Number(stats.pct_of_total_volume);

  if (volumePct >= 70) {
    console.log(`✅ HIGH-COVERAGE WALLETS = ${volumePct}% of total volume`);
    console.log('Recommendation: Ship beta for high-coverage wallets only');
    console.log('This captures majority of trading activity while Phase 2 runs in background.');
  } else if (volumePct >= 40) {
    console.log(`⚠️ HIGH-COVERAGE WALLETS = ${volumePct}% of total volume`);
    console.log('Recommendation: Hybrid approach possible but risky');
    console.log('Consider if Phase 2 timeline is acceptable.');
  } else {
    console.log(`❌ HIGH-COVERAGE WALLETS = ${volumePct}% of total volume`);
    console.log('Recommendation: Phase 2 blockchain backfill mandatory');
    console.log('Cannot ship without majority volume coverage.');
  }

  await client.close();
}

analyzeHighCoverageWallets().catch(console.error);
