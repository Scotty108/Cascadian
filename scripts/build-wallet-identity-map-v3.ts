/**
 * Build wallet_identity_map - V3 (Day-by-day, candidate-only approach)
 *
 * Key insights from failed attempts:
 * - Full table joins hit 10.8GB memory limit
 * - Even extracting all proxy CTF hashes hits memory
 * - Need to process in very small time windows
 *
 * Strategy:
 * 1. Process day by day (not week/month)
 * 2. Use SETTINGS to control memory
 * 3. Focus on candidate wallets only (those with CLOB activity)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];

async function main() {
  console.log('Building wallet_identity_map (V3 - daily batches)...\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Create target table
  console.log('Step 1: Creating/clearing wallet_identity_map table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_identity_map' });

  const createSQL = `
    CREATE TABLE wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      mapping_type String,
      tx_count UInt64,
      first_seen DateTime,
      last_seen DateTime
    )
    ENGINE = SummingMergeTree((tx_count))
    ORDER BY (user_eoa, proxy_wallet, mapping_type)
  `;
  await clickhouse.command({ query: createSQL });
  console.log('✅ Table created\n');

  // Step 2: Process day by day, going back 180 days
  console.log('Step 2: Processing day by day...');
  const totalDays = 180;
  let totalMappingsAdded = 0;
  let successfulDays = 0;
  let failedDays = 0;

  for (let daysAgo = 0; daysAgo < totalDays; daysAgo++) {
    const dayStart = daysAgo + 1;
    const dayEnd = daysAgo;

    // Use a CTE to limit the scope and add memory settings
    const insertSQL = `
      INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, first_seen, last_seen)
      SELECT
        lower(t.trader_wallet) as user_eoa,
        lower(c.user_address) as proxy_wallet,
        'tx_hash_join' as mapping_type,
        count() as tx_count,
        min(c.event_timestamp) as first_seen,
        max(c.event_timestamp) as last_seen
      FROM pm_ctf_events c
      INNER JOIN pm_trader_events_v2 t
        ON c.tx_hash = lower(concat('0x', hex(t.transaction_hash)))
      WHERE c.event_timestamp >= now() - INTERVAL ${dayStart} DAY
        AND c.event_timestamp < now() - INTERVAL ${dayEnd} DAY
        AND lower(c.user_address) IN (${proxyList})
        AND c.is_deleted = 0
        AND t.is_deleted = 0
        AND lower(t.trader_wallet) NOT IN (${proxyList})
      GROUP BY lower(t.trader_wallet), lower(c.user_address)
      SETTINGS max_memory_usage = 8000000000, join_algorithm = 'partial_merge'
    `;

    try {
      await clickhouse.command({ query: insertSQL });
      successfulDays++;

      if (daysAgo % 10 === 0) {
        // Report progress every 10 days
        const countQ = 'SELECT count() as cnt, countDistinct(user_eoa) as users FROM wallet_identity_map';
        const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
        const counts = (await countR.json() as any[])[0];
        console.log(`  Day ${daysAgo}: ${counts.users.toLocaleString()} unique users, ${counts.cnt.toLocaleString()} total mappings`);
      }
    } catch (err: any) {
      failedDays++;
      if (daysAgo % 30 === 0) {
        console.log(`  Day ${daysAgo}: Failed (${err.message?.slice(0, 50)}...)`);
      }
    }
  }

  console.log(`\n✅ Processed ${successfulDays} days successfully, ${failedDays} days failed\n`);

  // Step 3: Optimize the table
  console.log('Step 3: Optimizing table...');
  await clickhouse.command({ query: 'OPTIMIZE TABLE wallet_identity_map FINAL' });
  console.log('✅ Table optimized\n');

  // Step 4: Final stats
  console.log('Step 4: Final statistics...');
  const statsQ = `
    SELECT
      countDistinct(user_eoa) as unique_users,
      countDistinct(proxy_wallet) as unique_proxies,
      count() as total_mappings,
      sum(tx_count) as total_confirming_txs
    FROM wallet_identity_map
  `;
  const statsR = await clickhouse.query({ query: statsQ, format: 'JSONEachRow' });
  const stats = (await statsR.json() as any[])[0];

  console.log('='.repeat(60));
  console.log('WALLET IDENTITY MAP STATISTICS');
  console.log('='.repeat(60));
  console.log(`Unique user wallets: ${Number(stats.unique_users).toLocaleString()}`);
  console.log(`Unique proxy contracts: ${Number(stats.unique_proxies).toLocaleString()}`);
  console.log(`Total mappings: ${Number(stats.total_mappings).toLocaleString()}`);
  console.log(`Total confirming txs: ${Number(stats.total_confirming_txs).toLocaleString()}`);

  // Step 5: Check test wallets
  console.log('\n\nStep 5: Checking test wallets...');
  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052' },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61' },
  ];

  for (const w of testWallets) {
    const q = `
      SELECT proxy_wallet, tx_count, first_seen, last_seen
      FROM wallet_identity_map
      WHERE lower(user_eoa) = lower('${w.addr}')
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const mappings = await r.json() as any[];

    console.log(`\n${w.name}:`);
    if (mappings.length === 0) {
      console.log('  No proxy mappings found');
    } else {
      for (const m of mappings) {
        console.log(`  Proxy: ${m.proxy_wallet}`);
        console.log(`    Txs: ${m.tx_count}, Period: ${m.first_seen} to ${m.last_seen}`);
      }
    }
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
