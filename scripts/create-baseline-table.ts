import { clickhouse } from '../lib/clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const BENCHMARK_WALLETS = [
  '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
  '0x662244931c392df70bd064fa91f838eea0bfd7a9',
  '0x2e0b70d482e6b389e81dea528be57d825dd48070',
  '0x3b6fd06a595d71c70afb3f44414be1c11304340b',
  '0xd748c701ad93cfec32a3420e10f3b08e68612125',
  '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397',
  '0xd06f0f7719df1b3b75b607923536b3250825d4a6',
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x7f3c8979d0afa00007bae4747d5347122af05613',
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
];

async function main() {
  console.log('Creating tmp.leaderboard_baseline table...\n');

  // Create the table with detailed fill data for benchmark wallets
  const walletList = BENCHMARK_WALLETS.map(w => `'${w}'`).join(',');

  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS default.leaderboard_baseline
      ENGINE = MergeTree()
      ORDER BY (wallet, timestamp)
      AS SELECT
        proxy_wallet as wallet,
        condition_id,
        side,
        price,
        size,
        timestamp,
        fill_id,
        market_slug,
        outcome
      FROM clob_fills
      WHERE proxy_wallet IN (${walletList})
    `
  });

  // Verify the table
  const counts = await clickhouse.query({
    query: `
      SELECT
        count() as total_fills,
        uniq(wallet) as unique_wallets,
        uniq(condition_id) as unique_markets,
        min(timestamp) as earliest_fill,
        max(timestamp) as latest_fill
      FROM default.leaderboard_baseline
    `,
    format: 'JSONEachRow'
  });

  const result = await counts.json();
  const stats = result[0];

  console.log('✅ Table created successfully!\n');
  console.log('Table: default.leaderboard_baseline');
  console.log('================================================================================');
  console.log('Total fills:', stats.total_fills);
  console.log('Unique wallets:', stats.unique_wallets);
  console.log('Unique markets:', stats.unique_markets);
  console.log('Date range:', stats.earliest_fill, 'to', stats.latest_fill);
  console.log('================================================================================\n');

  // Show sample data per wallet
  const perWallet = await clickhouse.query({
    query: `
      SELECT
        wallet,
        count() as fills,
        uniq(condition_id) as markets,
        sum(price * size) as volume_usd
      FROM default.leaderboard_baseline
      GROUP BY wallet
      ORDER BY volume_usd DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const walletStats = await perWallet.json();
  console.log('Top 5 wallets by volume:');
  walletStats.forEach((w: any) => {
    console.log(`  ${w.wallet}: ${w.fills} fills, ${w.markets} markets, $${w.volume_usd} volume`);
  });

  console.log('\n✅ P&L validation baseline ready!');
  console.log('   - CSV: tmp/omega-baseline-2025-11-11.csv (summary stats)');
  console.log('   - Table: default.leaderboard_baseline (detailed fills)');
}

main().catch(console.error);
