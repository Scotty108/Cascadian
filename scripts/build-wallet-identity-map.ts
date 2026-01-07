/**
 * Build wallet_identity_map from transaction hash joins
 *
 * Method: When a user trades via proxy contract, the same transaction contains:
 * - CTF event with user_address = proxy contract
 * - CLOB event with trader_wallet = actual user EOA
 *
 * By joining on tx_hash, we can discover: proxy_contract -> user_eoa mappings
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Known Polymarket proxy contracts (from agent investigation)
const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Exchange Proxy (CLOB + CTF)
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296', // CTF Exchange (CTF only)
  '0xc5d563a36ae78145c45a50134d48a1215220f80a', // Neg Risk Adapter
];

async function buildWalletIdentityMap() {
  console.log('Building wallet_identity_map from tx_hash joins...\n');

  // Step 1: Create the table if it doesn't exist
  console.log('Step 1: Creating wallet_identity_map table...');
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS wallet_identity_map (
      user_eoa String,           -- The actual user wallet (EOA)
      proxy_wallet String,       -- The proxy contract that executes CTF ops
      mapping_type String,       -- How the mapping was derived
      tx_count UInt64,           -- Number of transactions confirming this mapping
      first_seen DateTime,       -- First transaction with this mapping
      last_seen DateTime,        -- Last transaction with this mapping
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY (user_eoa, proxy_wallet)
  `;

  await clickhouse.command({ query: createTableSQL });
  console.log('✅ Table created/verified\n');

  // Step 2: Find user_eoa -> proxy mappings via tx_hash join
  // Using a SAMPLE approach to avoid memory issues with full table join
  console.log('Step 2: Discovering mappings via tx_hash join (sampled approach)...');
  console.log('(Processing in batches to avoid memory limits)\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Strategy: Sample recent CTF events and find corresponding CLOB trades
  // This is more memory-efficient than a full table join
  const discoverSQL = `
    INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, first_seen, last_seen)
    WITH ctf_sample AS (
      -- Get a manageable sample of CTF events from proxy contracts
      SELECT tx_hash, user_address, event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) IN (${proxyList})
        AND is_deleted = 0
        AND event_timestamp >= now() - INTERVAL 90 DAY  -- Last 90 days
      LIMIT 5000000  -- Cap at 5M events
    ),
    clob_hashes AS (
      -- Pre-compute hex hashes for CLOB events
      SELECT
        lower(concat('0x', hex(transaction_hash))) as tx_hash_hex,
        trader_wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 90 DAY
    )
    SELECT
      lower(c.trader_wallet) as user_eoa,
      lower(ctf.user_address) as proxy_wallet,
      'tx_hash_join_90d' as mapping_type,
      count() as tx_count,
      min(ctf.event_timestamp) as first_seen,
      max(ctf.event_timestamp) as last_seen
    FROM ctf_sample ctf
    JOIN clob_hashes c ON ctf.tx_hash = c.tx_hash_hex
    WHERE lower(c.trader_wallet) NOT IN (${proxyList})  -- Exclude proxy-to-proxy
    GROUP BY lower(c.trader_wallet), lower(ctf.user_address)
    HAVING tx_count >= 1
  `;

  try {
    await clickhouse.command({ query: discoverSQL });
    console.log('✅ Mappings discovered\n');
  } catch (err: any) {
    if (err.message?.includes('MEMORY_LIMIT')) {
      console.log('⚠️ Memory limit hit, trying smaller batch...\n');

      // Fallback: even smaller sample
      const smallerSQL = `
        INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, first_seen, last_seen)
        SELECT
          lower(t.trader_wallet) as user_eoa,
          lower(c.user_address) as proxy_wallet,
          'tx_hash_join_30d' as mapping_type,
          count() as tx_count,
          min(c.event_timestamp) as first_seen,
          max(c.event_timestamp) as last_seen
        FROM (
          SELECT tx_hash, user_address, event_timestamp
          FROM pm_ctf_events
          WHERE lower(user_address) IN (${proxyList})
            AND is_deleted = 0
            AND event_timestamp >= now() - INTERVAL 30 DAY
          LIMIT 1000000
        ) c
        JOIN (
          SELECT
            lower(concat('0x', hex(transaction_hash))) as tx_hash_hex,
            trader_wallet
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trade_time >= now() - INTERVAL 30 DAY
          LIMIT 10000000
        ) t ON c.tx_hash = t.tx_hash_hex
        WHERE lower(t.trader_wallet) NOT IN (${proxyList})
        GROUP BY lower(t.trader_wallet), lower(c.user_address)
        HAVING tx_count >= 1
      `;
      await clickhouse.command({ query: smallerSQL });
      console.log('✅ Mappings discovered (30-day sample)\n');
    } else {
      throw err;
    }
  }

  // Step 3: Get stats
  console.log('Step 3: Mapping statistics...');

  const statsQuery = `
    SELECT
      proxy_wallet,
      count() as unique_users,
      sum(tx_count) as total_txs,
      min(first_seen) as earliest,
      max(last_seen) as latest
    FROM wallet_identity_map
    GROUP BY proxy_wallet
    ORDER BY unique_users DESC
  `;

  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = await statsResult.json() as any[];

  console.log('\nProxy Contract Mappings:');
  console.log('-'.repeat(80));
  for (const s of stats) {
    console.log(`${s.proxy_wallet.slice(0, 20)}...`);
    console.log(`  Unique Users: ${s.unique_users.toLocaleString()}`);
    console.log(`  Total Txs: ${s.total_txs.toLocaleString()}`);
    console.log(`  Period: ${s.earliest} to ${s.latest}`);
  }

  // Step 4: Check specific wallets
  console.log('\n\nStep 4: Checking specific wallets...');

  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052' },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61' },
  ];

  for (const w of testWallets) {
    const walletQuery = `
      SELECT proxy_wallet, tx_count, first_seen, last_seen
      FROM wallet_identity_map
      WHERE lower(user_eoa) = lower('${w.addr}')
    `;
    const result = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
    const mappings = await result.json() as any[];

    console.log(`\n${w.name} (${w.addr.slice(0, 10)}...):`);
    if (mappings.length === 0) {
      console.log('  No proxy mappings found (pure CLOB trader)');
    } else {
      for (const m of mappings) {
        console.log(`  Proxy: ${m.proxy_wallet.slice(0, 20)}...`);
        console.log(`  Transactions: ${m.tx_count}`);
        console.log(`  Period: ${m.first_seen} to ${m.last_seen}`);
      }
    }
  }

  // Step 5: Total counts
  const totalQuery = `SELECT count() as total, countDistinct(user_eoa) as unique_users FROM wallet_identity_map`;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totals = (await totalResult.json() as any[])[0];

  console.log('\n' + '='.repeat(80));
  console.log(`Total mappings: ${totals.total.toLocaleString()}`);
  console.log(`Unique user wallets mapped: ${totals.unique_users.toLocaleString()}`);
  console.log('='.repeat(80));
}

buildWalletIdentityMap()
  .then(() => {
    console.log('\n✅ wallet_identity_map build complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
