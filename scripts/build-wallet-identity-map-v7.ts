/**
 * Build wallet_identity_map - V7 (Ultra-minimal batching)
 *
 * Key insight: We need to avoid countDistinct and DISTINCT operations.
 * Instead, use direct INSERTs with ON CLUSTER / deduplication via engine.
 *
 * Strategy:
 * - Process 1 proxy × 1 day at a time
 * - No DISTINCT - let SummingMergeTree handle dedup
 * - Use direct tx_hash → binary conversion lookup
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const PROXY_CONTRACTS = [
  { name: 'CTF Exchange', addr: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296' },
  { name: 'Exchange Proxy', addr: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e' },
  // Skip Neg Risk Adapter for now - less common
];

async function main() {
  console.log('Building wallet_identity_map (V7 - ultra-minimal)...\n');

  // Create table
  console.log('Creating table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_identity_map' });

  const createSQL = `
    CREATE TABLE wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      tx_count UInt64
    )
    ENGINE = SummingMergeTree((tx_count))
    ORDER BY (user_eoa, proxy_wallet)
  `;
  await clickhouse.command({ query: createSQL });
  console.log('✅ Table created\n');

  // Process each proxy separately
  const totalDays = 90;
  let totalMappings = 0;
  const startTime = Date.now();

  for (const proxy of PROXY_CONTRACTS) {
    console.log(`\nProcessing ${proxy.name}...`);

    for (let day = 0; day < totalDays; day++) {
      const dayStart = day + 1;
      const dayEnd = day;

      // Direct INSERT...SELECT without DISTINCT
      // The SummingMergeTree will aggregate duplicate (user_eoa, proxy_wallet) pairs
      const insertSQL = `
        INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, tx_count)
        SELECT
          lower(t.trader_wallet) as user_eoa,
          '${proxy.addr}' as proxy_wallet,
          1 as tx_count
        FROM pm_ctf_events ctf
        INNER JOIN pm_trader_events_v2 t
          ON t.transaction_hash = unhex(substring(ctf.tx_hash, 3))
        WHERE ctf.event_timestamp >= now() - INTERVAL ${dayStart} DAY
          AND ctf.event_timestamp < now() - INTERVAL ${dayEnd} DAY
          AND lower(ctf.user_address) = '${proxy.addr}'
          AND ctf.is_deleted = 0
          AND t.is_deleted = 0
          AND lower(t.trader_wallet) != '${proxy.addr}'
        SETTINGS max_memory_usage = 6000000000, join_algorithm = 'partial_merge'
      `;

      try {
        await clickhouse.command({ query: insertSQL });

        if (day % 30 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          console.log(`  Day ${day}: OK (${elapsed.toFixed(0)}s elapsed)`);
        }
      } catch (err: any) {
        if (day % 30 === 0 || !err.message?.includes('MEMORY')) {
          console.log(`  Day ${day}: ${err.message?.slice(0, 50)}...`);
        }
      }
    }
  }

  // Optimize
  console.log('\nOptimizing table...');
  await clickhouse.command({ query: 'OPTIMIZE TABLE wallet_identity_map FINAL' });

  // Stats
  console.log('\n' + '='.repeat(60));
  const statsQ = `
    SELECT
      countDistinct(user_eoa) as unique_users,
      count() as total_mappings,
      sum(tx_count) as total_txs
    FROM wallet_identity_map
  `;
  const statsR = await clickhouse.query({ query: statsQ, format: 'JSONEachRow' });
  const stats = (await statsR.json() as any[])[0];

  console.log(`Unique users mapped: ${Number(stats.unique_users).toLocaleString()}`);
  console.log(`Total mappings: ${Number(stats.total_mappings).toLocaleString()}`);
  console.log(`Total confirming txs: ${Number(stats.total_txs).toLocaleString()}`);

  // Test wallets
  console.log('\nTest Wallets:');
  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052' },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61' },
  ];

  for (const w of testWallets) {
    const q = `SELECT proxy_wallet, tx_count FROM wallet_identity_map WHERE user_eoa = '${w.addr.toLowerCase()}'`;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const mappings = await r.json() as any[];
    console.log(`${w.name}: ${mappings.length > 0 ? mappings.map(m => `${m.proxy_wallet.slice(0,10)}...(${m.tx_count})`).join(', ') : 'No mappings'}`);
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
