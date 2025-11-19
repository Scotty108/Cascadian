import { config } from 'dotenv';
import { getClickHouseClient } from './lib/clickhouse/client';

// Load environment variables
config({ path: '.env.local' });

const client = getClickHouseClient();

async function main() {
  console.log('\n=== DATA CORRUPTION SCOPE ANALYSIS ===\n');

  // 1. Global corruption stats
  console.log('1. GLOBAL STATS');
  console.log('-'.repeat(80));
  const globalStats = await client.query({
    query: `
      SELECT
        count(*) AS total_rows,
        uniq(wallet_address) AS unique_wallets,
        uniq(transaction_hash) AS unique_transactions,
        round(total_rows / unique_transactions, 2) AS avg_duplication_factor
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
    `,
    format: 'JSONEachRow',
  });
  const global = await globalStats.json();
  console.log(JSON.stringify(global[0], null, 2));

  // 2. Top 50 wallets by trade count with duplication analysis
  console.log('\n2. TOP 50 WALLETS BY VOLUME (duplication analysis)');
  console.log('-'.repeat(80));
  const top50Query = await client.query({
    query: `
      SELECT
        wallet_address,
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        round(total_rows / unique_txs, 2) AS duplication_factor
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet_address
      ORDER BY total_rows DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });
  const top50 = await top50Query.json();

  // Categorize
  const categories = {
    clean: [] as any[],
    minor: [] as any[],
    moderate: [] as any[],
    severe: [] as any[],
    catastrophic: [] as any[],
  };

  top50.forEach((w: any) => {
    const factor = parseFloat(w.duplication_factor);
    if (factor <= 2) categories.clean.push(w);
    else if (factor <= 10) categories.minor.push(w);
    else if (factor <= 100) categories.moderate.push(w);
    else if (factor <= 1000) categories.severe.push(w);
    else categories.catastrophic.push(w);
  });

  console.log('\nCATEGORIZATION (Top 50 Wallets):');
  console.log(`  Clean (1x-2x):         ${categories.clean.length} wallets`);
  console.log(`  Minor (2x-10x):        ${categories.minor.length} wallets`);
  console.log(`  Moderate (10x-100x):   ${categories.moderate.length} wallets`);
  console.log(`  Severe (100x-1000x):   ${categories.severe.length} wallets`);
  console.log(`  Catastrophic (>1000x): ${categories.catastrophic.length} wallets`);

  // 3. Show top 10 most corrupted
  console.log('\n3. TOP 10 MOST CORRUPTED WALLETS');
  console.log('-'.repeat(80));
  const top10Corrupted = top50.slice(0, 10);
  top10Corrupted.forEach((w: any, i: number) => {
    console.log(`${i + 1}. ${w.wallet_address}`);
    console.log(`   Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
  });

  // 4. Find cleanest wallets (duplication factor closest to 1)
  console.log('\n4. CLEANEST WALLETS (minimal duplication)');
  console.log('-'.repeat(80));
  const cleanestQuery = await client.query({
    query: `
      SELECT
        wallet_address,
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        round(total_rows / unique_txs, 2) AS duplication_factor
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet_address
      HAVING unique_txs >= 10  -- At least 10 trades for meaningful sample
      ORDER BY duplication_factor ASC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const cleanest = await cleanestQuery.json();
  cleanest.forEach((w: any, i: number) => {
    console.log(`${i + 1}. ${w.wallet_address}`);
    console.log(`   Rows: ${w.total_rows.toLocaleString()}, Unique TXs: ${w.unique_txs.toLocaleString()}, Factor: ${w.duplication_factor}x`);
  });

  // 5. Temporal pattern analysis
  console.log('\n5. TEMPORAL PATTERN ANALYSIS (by month)');
  console.log('-'.repeat(80));
  const temporalQuery = await client.query({
    query: `
      SELECT
        toStartOfMonth(timestamp) AS month,
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        round(total_rows / unique_txs, 2) AS duplication_factor
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 != ''
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow',
  });
  const temporal = await temporalQuery.json();
  temporal.forEach((m: any) => {
    console.log(`${m.month}: ${m.total_rows.toLocaleString()} rows, ${m.unique_txs.toLocaleString()} txs, ${m.duplication_factor}x`);
  });

  // 6. Distribution analysis across ALL wallets
  console.log('\n6. WALLET DISTRIBUTION ANALYSIS (all wallets)');
  console.log('-'.repeat(80));
  const distributionQuery = await client.query({
    query: `
      WITH wallet_duplication AS (
        SELECT
          wallet_address,
          count() AS total_rows,
          uniq(transaction_hash) AS unique_txs,
          total_rows / unique_txs AS duplication_factor
        FROM pm_trades_canonical_v3
        WHERE condition_id_norm_v3 != ''
        GROUP BY wallet_address
      )
      SELECT
        countIf(duplication_factor <= 2) AS clean_wallets,
        countIf(duplication_factor > 2 AND duplication_factor <= 10) AS minor_wallets,
        countIf(duplication_factor > 10 AND duplication_factor <= 100) AS moderate_wallets,
        countIf(duplication_factor > 100 AND duplication_factor <= 1000) AS severe_wallets,
        countIf(duplication_factor > 1000) AS catastrophic_wallets,
        count() AS total_wallets
      FROM wallet_duplication
    `,
    format: 'JSONEachRow',
  });
  const distribution = await distributionQuery.json();
  const dist = distribution[0] as any;
  console.log(`Total Wallets: ${dist.total_wallets.toLocaleString()}`);
  console.log(`  Clean (1x-2x):         ${dist.clean_wallets.toLocaleString()} (${(100 * dist.clean_wallets / dist.total_wallets).toFixed(1)}%)`);
  console.log(`  Minor (2x-10x):        ${dist.minor_wallets.toLocaleString()} (${(100 * dist.minor_wallets / dist.total_wallets).toFixed(1)}%)`);
  console.log(`  Moderate (10x-100x):   ${dist.moderate_wallets.toLocaleString()} (${(100 * dist.moderate_wallets / dist.total_wallets).toFixed(1)}%)`);
  console.log(`  Severe (100x-1000x):   ${dist.severe_wallets.toLocaleString()} (${(100 * dist.severe_wallets / dist.total_wallets).toFixed(1)}%)`);
  console.log(`  Catastrophic (>1000x): ${dist.catastrophic_wallets.toLocaleString()} (${(100 * dist.catastrophic_wallets / dist.total_wallets).toFixed(1)}%)`);

  // 7. Check for Safe wallet correlation
  console.log('\n7. WALLET TYPE CORRELATION (Safe vs EOA)');
  console.log('-'.repeat(80));
  const safeWalletsQuery = await client.query({
    query: `
      WITH wallet_duplication AS (
        SELECT
          wallet_address,
          count() AS total_rows,
          uniq(transaction_hash) AS unique_txs,
          total_rows / unique_txs AS duplication_factor,
          -- Simple heuristic: Safe wallets often have specific patterns
          multiIf(
            total_rows > 1000, 'high_volume',
            total_rows > 100, 'medium_volume',
            'low_volume'
          ) AS volume_category
        FROM pm_trades_canonical_v3
        WHERE condition_id_norm_v3 != ''
        GROUP BY wallet_address
      )
      SELECT
        volume_category,
        count() AS wallet_count,
        round(avg(duplication_factor), 2) AS avg_duplication,
        round(median(duplication_factor), 2) AS median_duplication,
        max(duplication_factor) AS max_duplication
      FROM wallet_duplication
      GROUP BY volume_category
      ORDER BY avg_duplication DESC
    `,
    format: 'JSONEachRow',
  });
  const safeWallets = await safeWalletsQuery.json();
  safeWallets.forEach((cat: any) => {
    console.log(`${cat.volume_category}:`);
    console.log(`  Wallets: ${cat.wallet_count.toLocaleString()}, Avg: ${cat.avg_duplication}x, Median: ${cat.median_duplication}x, Max: ${cat.max_duplication}x`);
  });

  // 8. Severity assessment
  console.log('\n8. SEVERITY ASSESSMENT');
  console.log('-'.repeat(80));
  const severityQuery = await client.query({
    query: `
      WITH wallet_duplication AS (
        SELECT
          wallet_address,
          count() AS total_rows,
          uniq(transaction_hash) AS unique_txs
        FROM pm_trades_canonical_v3
        WHERE condition_id_norm_v3 != ''
        GROUP BY wallet_address
      )
      SELECT
        sum(total_rows) AS total_rows_all_wallets,
        sum(unique_txs) AS unique_txs_all_wallets,
        sum(total_rows) - sum(unique_txs) AS duplicate_rows,
        round(100 * (sum(total_rows) - sum(unique_txs)) / sum(total_rows), 2) AS pct_duplicate
      FROM wallet_duplication
    `,
    format: 'JSONEachRow',
  });
  const severity = await severityQuery.json();
  const sev = severity[0] as any;
  console.log(`Total Rows: ${sev.total_rows_all_wallets.toLocaleString()}`);
  console.log(`Unique Transactions: ${sev.unique_txs_all_wallets.toLocaleString()}`);
  console.log(`Duplicate Rows: ${sev.duplicate_rows.toLocaleString()}`);
  console.log(`% of Data Duplicated: ${sev.pct_duplicate}%`);

  await client.close();
}

main().catch(console.error);
