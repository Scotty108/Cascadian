/**
 * Build wallet_identity_map - V2 (Pre-materialize approach)
 *
 * Strategy: Instead of joining two massive tables, we:
 * 1. First extract just the tx_hashes from CTF events where user_address is a proxy
 * 2. Store those in a temp table (small - only proxy events)
 * 3. Then join that small table to CLOB events
 *
 * This avoids the full table scan issue.
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

async function main() {
  console.log('Building wallet_identity_map (V2 - pre-materialize approach)...\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Create the target table
  console.log('Step 1: Creating wallet_identity_map table...');
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      mapping_type String,
      tx_count UInt64,
      first_seen DateTime,
      last_seen DateTime,
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY (user_eoa, proxy_wallet)
  `;
  await clickhouse.command({ query: createTableSQL });
  console.log('✅ Target table ready\n');

  // Step 2: Create a temporary table with ONLY proxy CTF tx_hashes
  // This is much smaller than the full table
  console.log('Step 2: Creating temp table with proxy CTF tx_hashes...');

  // First drop if exists
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS temp_proxy_ctf_hashes' });

  const createTempSQL = `
    CREATE TABLE temp_proxy_ctf_hashes (
      tx_hash String,
      proxy_wallet String,
      event_timestamp DateTime
    )
    ENGINE = MergeTree()
    ORDER BY tx_hash
  `;
  await clickhouse.command({ query: createTempSQL });

  // Insert proxy CTF tx_hashes
  const insertTempSQL = `
    INSERT INTO temp_proxy_ctf_hashes (tx_hash, proxy_wallet, event_timestamp)
    SELECT DISTINCT
      tx_hash,
      lower(user_address) as proxy_wallet,
      event_timestamp
    FROM pm_ctf_events
    WHERE lower(user_address) IN (${proxyList})
      AND is_deleted = 0
      AND tx_hash != ''
      AND tx_hash IS NOT NULL
  `;

  console.log('  Extracting proxy CTF events...');
  await clickhouse.command({ query: insertTempSQL });

  // Check count
  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM temp_proxy_ctf_hashes',
    format: 'JSONEachRow'
  });
  const count = (await countResult.json() as any[])[0].cnt;
  console.log(`✅ Extracted ${count.toLocaleString()} proxy CTF tx_hashes\n`);

  // Step 3: Now join this small table to CLOB events
  // This is much more memory-efficient because one side is small
  console.log('Step 3: Joining to CLOB events to find user wallets...');

  // Process in time batches to be safe
  const windowDays = 30;
  const totalDays = 365; // Go back 1 year
  let totalMappings = 0;

  for (let daysAgo = 0; daysAgo < totalDays; daysAgo += windowDays) {
    const startDays = daysAgo;
    const endDays = Math.min(daysAgo + windowDays, totalDays);

    const batchSQL = `
      INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, first_seen, last_seen)
      SELECT
        lower(t.trader_wallet) as user_eoa,
        p.proxy_wallet,
        'tx_hash_join_v2' as mapping_type,
        count() as tx_count,
        min(p.event_timestamp) as first_seen,
        max(p.event_timestamp) as last_seen
      FROM temp_proxy_ctf_hashes p
      JOIN pm_trader_events_v2 t
        ON p.tx_hash = lower(concat('0x', hex(t.transaction_hash)))
      WHERE t.trade_time >= now() - INTERVAL ${endDays} DAY
        AND t.trade_time < now() - INTERVAL ${startDays} DAY
        AND t.is_deleted = 0
        AND lower(t.trader_wallet) NOT IN (${proxyList})
      GROUP BY lower(t.trader_wallet), p.proxy_wallet
    `;

    try {
      await clickhouse.command({ query: batchSQL });

      // Check how many we added
      const checkSQL = `
        SELECT count() as cnt
        FROM wallet_identity_map
        WHERE mapping_type = 'tx_hash_join_v2'
      `;
      const checkResult = await clickhouse.query({ query: checkSQL, format: 'JSONEachRow' });
      const newCount = (await checkResult.json() as any[])[0].cnt;

      console.log(`  Days ${startDays}-${endDays}: ${newCount.toLocaleString()} total mappings`);
      totalMappings = Number(newCount);
    } catch (err: any) {
      if (err.message?.includes('MEMORY_LIMIT')) {
        console.log(`  ⚠️ Days ${startDays}-${endDays}: Memory limit, trying smaller window...`);

        // Try 7-day sub-windows
        for (let subDays = startDays; subDays < endDays; subDays += 7) {
          const subStart = subDays;
          const subEnd = Math.min(subDays + 7, endDays);

          const subSQL = `
            INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, mapping_type, tx_count, first_seen, last_seen)
            SELECT
              lower(t.trader_wallet) as user_eoa,
              p.proxy_wallet,
              'tx_hash_join_v2' as mapping_type,
              count() as tx_count,
              min(p.event_timestamp) as first_seen,
              max(p.event_timestamp) as last_seen
            FROM temp_proxy_ctf_hashes p
            JOIN pm_trader_events_v2 t
              ON p.tx_hash = lower(concat('0x', hex(t.transaction_hash)))
            WHERE t.trade_time >= now() - INTERVAL ${subEnd} DAY
              AND t.trade_time < now() - INTERVAL ${subStart} DAY
              AND t.is_deleted = 0
              AND lower(t.trader_wallet) NOT IN (${proxyList})
            GROUP BY lower(t.trader_wallet), p.proxy_wallet
          `;

          try {
            await clickhouse.command({ query: subSQL });
            console.log(`    Sub-window ${subStart}-${subEnd}: OK`);
          } catch (subErr: any) {
            console.log(`    Sub-window ${subStart}-${subEnd}: Failed (${subErr.message?.slice(0, 50)}...)`);
          }
        }
      } else {
        console.log(`  ❌ Days ${startDays}-${endDays}: ${err.message?.slice(0, 80)}...`);
      }
    }
  }

  // Step 4: Cleanup and stats
  console.log('\nStep 4: Cleanup and final statistics...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS temp_proxy_ctf_hashes' });

  const statsQuery = `
    SELECT
      countDistinct(user_eoa) as unique_users,
      countDistinct(proxy_wallet) as unique_proxies,
      count() as total_mappings,
      sum(tx_count) as total_confirming_txs
    FROM wallet_identity_map
  `;
  const statsResult = await clickhouse.query({ query: statsQuery, format: 'JSONEachRow' });
  const stats = (await statsResult.json() as any[])[0];

  console.log('\n' + '='.repeat(60));
  console.log('WALLET IDENTITY MAP STATISTICS');
  console.log('='.repeat(60));
  console.log(`Unique user wallets mapped: ${stats.unique_users?.toLocaleString() || 0}`);
  console.log(`Unique proxy contracts: ${stats.unique_proxies?.toLocaleString() || 0}`);
  console.log(`Total mappings: ${stats.total_mappings?.toLocaleString() || 0}`);
  console.log(`Total confirming transactions: ${stats.total_confirming_txs?.toLocaleString() || 0}`);
  console.log('='.repeat(60));

  // Step 5: Check test wallets
  console.log('\nStep 5: Checking test wallets...');
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

    console.log(`\n${w.name} (${w.addr.slice(0, 10)}...):`);
    if (mappings.length === 0) {
      console.log('  No proxy mappings found');
    } else {
      for (const m of mappings) {
        console.log(`  Proxy: ${m.proxy_wallet}`);
        console.log(`    Confirming txs: ${m.tx_count}`);
        console.log(`    Period: ${m.first_seen} to ${m.last_seen}`);
      }
    }
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
