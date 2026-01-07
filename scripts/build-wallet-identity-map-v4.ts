/**
 * Build wallet_identity_map - V4 (Pre-computed hash index approach)
 *
 * Key insight: The expensive part is `hex(transaction_hash)` conversion.
 * Solution: Create a small index table with pre-computed hashes ONCE,
 * then joining is trivial.
 *
 * This approach:
 * 1. Create clob_tx_hash_index (tx_hash_hex, trader_wallet) - built incrementally
 * 2. Create ctf_proxy_hashes (tx_hash, proxy_wallet) - only proxy events
 * 3. Join these two small tables - instant
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
  console.log('Building wallet_identity_map (V4 - pre-computed index)...\n');
  console.log('This is a two-phase approach:');
  console.log('  Phase 1: Build CLOB tx_hash index (one-time, ~5-10 min)');
  console.log('  Phase 2: Join with CTF proxy events (fast)\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // ===== PHASE 1: Build CLOB tx_hash index =====
  console.log('='.repeat(60));
  console.log('PHASE 1: Building CLOB tx_hash index');
  console.log('='.repeat(60));

  // Check if index already exists and has data
  let indexExists = false;
  try {
    const checkQ = 'SELECT count() as cnt FROM clob_tx_hash_index';
    const checkR = await clickhouse.query({ query: checkQ, format: 'JSONEachRow' });
    const cnt = (await checkR.json() as any[])[0].cnt;
    if (cnt > 1000000) {
      console.log(`\n✅ Index already exists with ${Number(cnt).toLocaleString()} entries`);
      indexExists = true;
    }
  } catch {
    // Table doesn't exist
  }

  if (!indexExists) {
    console.log('\nCreating new index table...');

    // Drop and recreate
    await clickhouse.command({ query: 'DROP TABLE IF EXISTS clob_tx_hash_index' });

    const createIndexSQL = `
      CREATE TABLE clob_tx_hash_index (
        tx_hash_hex String,
        trader_wallet String
      )
      ENGINE = MergeTree()
      ORDER BY tx_hash_hex
      SETTINGS index_granularity = 8192
    `;
    await clickhouse.command({ query: createIndexSQL });
    console.log('✅ Index table created');

    // Build index in weekly batches (52 weeks = 1 year)
    console.log('\nPopulating index (weekly batches)...');
    const totalWeeks = 52;

    for (let week = 0; week < totalWeeks; week++) {
      const weekStart = (week + 1) * 7;
      const weekEnd = week * 7;

      const insertSQL = `
        INSERT INTO clob_tx_hash_index (tx_hash_hex, trader_wallet)
        SELECT DISTINCT
          lower(concat('0x', hex(transaction_hash))) as tx_hash_hex,
          lower(trader_wallet) as trader_wallet
        FROM pm_trader_events_v2
        WHERE trade_time >= now() - INTERVAL ${weekStart} DAY
          AND trade_time < now() - INTERVAL ${weekEnd} DAY
          AND is_deleted = 0
        SETTINGS max_memory_usage = 5000000000
      `;

      try {
        await clickhouse.command({ query: insertSQL });
        if (week % 10 === 0) {
          const cntQ = 'SELECT count() FROM clob_tx_hash_index';
          const cntR = await clickhouse.query({ query: cntQ, format: 'JSONEachRow' });
          const c = (await cntR.json() as any[])[0]['count()'];
          console.log(`  Week ${week}: ${Number(c).toLocaleString()} total hashes indexed`);
        }
      } catch (err: any) {
        console.log(`  Week ${week}: ${err.message?.slice(0, 60)}...`);
      }
    }

    // Final count
    const finalCntQ = 'SELECT count() as cnt, countDistinct(trader_wallet) as wallets FROM clob_tx_hash_index';
    const finalCntR = await clickhouse.query({ query: finalCntQ, format: 'JSONEachRow' });
    const finalCnt = (await finalCntR.json() as any[])[0];
    console.log(`\n✅ Index complete: ${Number(finalCnt.cnt).toLocaleString()} tx_hashes, ${Number(finalCnt.wallets).toLocaleString()} unique wallets`);
  }

  // ===== PHASE 2: Build CTF proxy hash table and join =====
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 2: Building CTF proxy hashes and joining');
  console.log('='.repeat(60));

  // Create CTF proxy hashes table (much smaller - only proxy events)
  console.log('\nCreating CTF proxy hashes table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS ctf_proxy_hashes' });

  // Build in weekly batches too
  const createCtfSQL = `
    CREATE TABLE ctf_proxy_hashes (
      tx_hash String,
      proxy_wallet String,
      event_timestamp DateTime
    )
    ENGINE = MergeTree()
    ORDER BY tx_hash
  `;
  await clickhouse.command({ query: createCtfSQL });

  console.log('Populating CTF proxy hashes (weekly batches)...');
  const ctfWeeks = 52;

  for (let week = 0; week < ctfWeeks; week++) {
    const weekStart = (week + 1) * 7;
    const weekEnd = week * 7;

    const insertCtfSQL = `
      INSERT INTO ctf_proxy_hashes (tx_hash, proxy_wallet, event_timestamp)
      SELECT DISTINCT
        tx_hash,
        lower(user_address) as proxy_wallet,
        min(event_timestamp) as event_timestamp
      FROM pm_ctf_events
      WHERE event_timestamp >= now() - INTERVAL ${weekStart} DAY
        AND event_timestamp < now() - INTERVAL ${weekEnd} DAY
        AND lower(user_address) IN (${proxyList})
        AND is_deleted = 0
        AND tx_hash != ''
      GROUP BY tx_hash, lower(user_address)
      SETTINGS max_memory_usage = 5000000000
    `;

    try {
      await clickhouse.command({ query: insertCtfSQL });
      if (week % 10 === 0) {
        const cntQ = 'SELECT count() FROM ctf_proxy_hashes';
        const cntR = await clickhouse.query({ query: cntQ, format: 'JSONEachRow' });
        const c = (await cntR.json() as any[])[0]['count()'];
        console.log(`  Week ${week}: ${Number(c).toLocaleString()} CTF proxy hashes`);
      }
    } catch (err: any) {
      console.log(`  Week ${week}: ${err.message?.slice(0, 60)}...`);
    }
  }

  const ctfCntQ = 'SELECT count() as cnt FROM ctf_proxy_hashes';
  const ctfCntR = await clickhouse.query({ query: ctfCntQ, format: 'JSONEachRow' });
  const ctfCnt = (await ctfCntR.json() as any[])[0].cnt;
  console.log(`\n✅ CTF proxy hashes: ${Number(ctfCnt).toLocaleString()}`);

  // ===== PHASE 3: Join the two small tables =====
  console.log('\n' + '='.repeat(60));
  console.log('PHASE 3: Joining to build wallet_identity_map');
  console.log('='.repeat(60));

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_identity_map' });

  const createMapSQL = `
    CREATE TABLE wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      tx_count UInt64,
      first_seen DateTime,
      last_seen DateTime
    )
    ENGINE = SummingMergeTree((tx_count))
    ORDER BY (user_eoa, proxy_wallet)
  `;
  await clickhouse.command({ query: createMapSQL });

  // This join should be fast since both tables are pre-computed
  console.log('\nJoining CLOB index with CTF proxy hashes...');
  const joinSQL = `
    INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, tx_count, first_seen, last_seen)
    SELECT
      clob.trader_wallet as user_eoa,
      ctf.proxy_wallet,
      count() as tx_count,
      min(ctf.event_timestamp) as first_seen,
      max(ctf.event_timestamp) as last_seen
    FROM ctf_proxy_hashes ctf
    INNER JOIN clob_tx_hash_index clob ON ctf.tx_hash = clob.tx_hash_hex
    WHERE clob.trader_wallet NOT IN (${proxyList})
    GROUP BY clob.trader_wallet, ctf.proxy_wallet
    SETTINGS max_memory_usage = 8000000000
  `;

  await clickhouse.command({ query: joinSQL });
  console.log('✅ Join complete');

  // Optimize
  await clickhouse.command({ query: 'OPTIMIZE TABLE wallet_identity_map FINAL' });

  // Final stats
  console.log('\n' + '='.repeat(60));
  console.log('FINAL STATISTICS');
  console.log('='.repeat(60));

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

  console.log(`Unique user wallets: ${Number(stats.unique_users).toLocaleString()}`);
  console.log(`Unique proxy contracts: ${Number(stats.unique_proxies).toLocaleString()}`);
  console.log(`Total mappings: ${Number(stats.total_mappings).toLocaleString()}`);
  console.log(`Total confirming txs: ${Number(stats.total_confirming_txs).toLocaleString()}`);

  // Test wallets
  console.log('\n\nTest Wallets:');
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
        console.log(`  ${m.proxy_wallet}: ${m.tx_count} txs`);
      }
    }
  }

  // Cleanup temp tables (optional - keep them for future rebuilds)
  // await clickhouse.command({ query: 'DROP TABLE IF EXISTS clob_tx_hash_index' });
  // await clickhouse.command({ query: 'DROP TABLE IF EXISTS ctf_proxy_hashes' });
  console.log('\n(Keeping index tables for future use)');
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
