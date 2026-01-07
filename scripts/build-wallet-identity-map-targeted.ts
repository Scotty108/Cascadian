/**
 * Build wallet_identity_map using a targeted wallet-by-wallet approach
 *
 * Strategy: For each wallet in our leaderboard universe, find their proxy relationships
 * by matching CLOB tx_hashes to CTF events executed by proxy contracts.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Known Polymarket proxy contracts
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Exchange Proxy
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296', // CTF Exchange
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
];

interface ProxyMapping {
  user_eoa: string;
  proxy_wallet: string;
  tx_count: number;
  event_types: string[];
}

async function findProxiesForWallet(wallet: string): Promise<ProxyMapping[]> {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Get CLOB tx_hashes for this wallet and find matching CTF events from proxies
  const query = `
    WITH clob_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT
      user_address as proxy_wallet,
      count() as tx_count,
      groupArray(DISTINCT event_type) as event_types
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM clob_txs)
      AND lower(user_address) IN (${proxyList})
      AND is_deleted = 0
    GROUP BY user_address
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  return rows.map(r => ({
    user_eoa: wallet.toLowerCase(),
    proxy_wallet: r.proxy_wallet.toLowerCase(),
    tx_count: Number(r.tx_count),
    event_types: r.event_types,
  }));
}

async function main() {
  console.log('Building wallet_identity_map (targeted approach)...\n');

  // Step 1: Create table
  console.log('Step 1: Creating table...');
  const createSQL = `
    CREATE TABLE IF NOT EXISTS wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      mapping_type String,
      tx_count UInt64,
      event_types Array(String),
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY (user_eoa, proxy_wallet)
  `;
  await clickhouse.command({ query: createSQL });
  console.log('✅ Table ready\n');

  // Step 2: Get list of active wallets to process
  console.log('Step 2: Getting active wallets...');
  const walletsQuery = `
    SELECT DISTINCT lower(trader_wallet) as wallet
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= now() - INTERVAL 90 DAY
    GROUP BY lower(trader_wallet)
    HAVING count() >= 10  -- At least 10 trades
    LIMIT 10000  -- Process top 10k wallets
  `;
  const walletsResult = await clickhouse.query({ query: walletsQuery, format: 'JSONEachRow' });
  const wallets = (await walletsResult.json() as any[]).map(r => r.wallet);
  console.log(`Found ${wallets.length} active wallets to process\n`);

  // Step 3: Process in batches
  console.log('Step 3: Finding proxy mappings...');
  const BATCH_SIZE = 100;
  let totalMappings = 0;
  let processedWallets = 0;

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    // Process batch - find all proxies for these wallets in one query
    const walletList = batch.map(w => `'${w}'`).join(',');
    const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

    const batchQuery = `
      WITH clob_txs AS (
        SELECT
          lower(trader_wallet) as wallet,
          lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) IN (${walletList})
          AND is_deleted = 0
      )
      SELECT
        c.wallet as user_eoa,
        ctf.user_address as proxy_wallet,
        count() as tx_count,
        groupArray(DISTINCT ctf.event_type) as event_types
      FROM clob_txs c
      JOIN pm_ctf_events ctf ON c.tx_hash = ctf.tx_hash
      WHERE lower(ctf.user_address) IN (${proxyList})
        AND ctf.is_deleted = 0
      GROUP BY c.wallet, ctf.user_address
    `;

    try {
      const batchResult = await clickhouse.query({ query: batchQuery, format: 'JSONEachRow' });
      const mappings = await batchResult.json() as any[];

      if (mappings.length > 0) {
        // Insert mappings
        const insertSQL = `
          INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, event_types)
          VALUES ${mappings.map(m =>
            `('${m.user_eoa}', '${m.proxy_wallet}', 'tx_hash_join', ${m.tx_count}, [${m.event_types.map((e: string) => `'${e}'`).join(',')}])`
          ).join(',')}
        `;
        await clickhouse.command({ query: insertSQL });
        totalMappings += mappings.length;
      }
    } catch (err: any) {
      // Skip batch on error
      console.log(`  Warning: batch ${i/BATCH_SIZE + 1} failed, skipping...`);
    }

    processedWallets += batch.length;
    if (processedWallets % 500 === 0) {
      console.log(`  Processed ${processedWallets}/${wallets.length} wallets, ${totalMappings} mappings found`);
    }
  }

  console.log(`\n✅ Processed ${processedWallets} wallets, found ${totalMappings} mappings\n`);

  // Step 4: Stats
  console.log('Step 4: Final statistics...');
  const statsQuery = `
    SELECT
      countDistinct(user_eoa) as unique_users,
      count() as total_mappings,
      sum(tx_count) as total_txs
    FROM wallet_identity_map
  `;
  const stats = (await (await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' })).json() as any[])[0];

  console.log(`Unique users mapped: ${stats.unique_users}`);
  console.log(`Total mappings: ${stats.total_mappings}`);
  console.log(`Total confirming txs: ${stats.total_txs}`);

  // Step 5: Check test wallets
  console.log('\nStep 5: Checking test wallets...');
  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052' },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61' },
  ];

  for (const w of testWallets) {
    const q = `SELECT proxy_wallet, tx_count, event_types FROM wallet_identity_map WHERE user_eoa = '${w.addr.toLowerCase()}'`;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const mappings = await r.json() as any[];

    console.log(`\n${w.name}:`);
    if (mappings.length === 0) {
      console.log('  No proxy mappings found');
    } else {
      for (const m of mappings) {
        console.log(`  Proxy: ${m.proxy_wallet.slice(0, 20)}...`);
        console.log(`    Txs: ${m.tx_count}, Types: ${m.event_types.join(', ')}`);
      }
    }
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
