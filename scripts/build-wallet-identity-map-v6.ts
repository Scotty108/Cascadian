/**
 * Build wallet_identity_map - V6 (Micro-batch CTF hashes approach)
 *
 * Strategy: Process proxy CTF events in tiny batches (1000 at a time).
 * For each batch, find matching CLOB trader_wallets.
 *
 * This keeps memory low by never loading large datasets.
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
  console.log('Building wallet_identity_map (V6 - micro-batch CTF hashes)...\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Create target table
  console.log('Step 1: Creating wallet_identity_map table...');
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

  // Step 2: Get distinct proxy CTF tx_hashes in batches
  console.log('Step 2: Processing proxy CTF events in micro-batches...\n');

  // First check how many proxy CTF events we have in last 90 days
  const countQ = `
    SELECT count() as cnt, countDistinct(tx_hash) as unique_hashes
    FROM pm_ctf_events
    WHERE lower(user_address) IN (${proxyList})
      AND is_deleted = 0
      AND event_timestamp >= now() - INTERVAL 90 DAY
  `;
  const countR = await clickhouse.query({ query: countQ, format: 'JSONEachRow' });
  const counts = (await countR.json() as any[])[0];
  console.log(`Proxy CTF events (90 days): ${Number(counts.cnt).toLocaleString()} events, ${Number(counts.unique_hashes).toLocaleString()} unique hashes\n`);

  // Process in batches by event_timestamp chunks (1 day at a time)
  const totalDays = 90;
  const batchSize = 5000; // CTF hashes per batch
  let totalMappings = 0;
  let totalCTFProcessed = 0;
  const startTime = Date.now();

  for (let day = 0; day < totalDays; day++) {
    const dayStart = day + 1;
    const dayEnd = day;

    // Get distinct CTF hashes for this day
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      // Get a batch of CTF tx_hashes for this day
      const batchQ = `
        SELECT DISTINCT
          tx_hash,
          lower(user_address) as proxy_wallet
        FROM pm_ctf_events
        WHERE event_timestamp >= now() - INTERVAL ${dayStart} DAY
          AND event_timestamp < now() - INTERVAL ${dayEnd} DAY
          AND lower(user_address) IN (${proxyList})
          AND is_deleted = 0
          AND tx_hash != ''
        LIMIT ${batchSize}
        OFFSET ${offset}
      `;

      const batchR = await clickhouse.query({ query: batchQ, format: 'JSONEachRow' });
      const ctfBatch = await batchR.json() as { tx_hash: string; proxy_wallet: string }[];

      if (ctfBatch.length === 0) {
        hasMore = false;
        continue;
      }

      totalCTFProcessed += ctfBatch.length;

      // For this batch, find matching CLOB trader_wallets
      // Group by proxy_wallet to handle multiple proxies
      const proxyGroups = new Map<string, string[]>();
      for (const c of ctfBatch) {
        if (!proxyGroups.has(c.proxy_wallet)) {
          proxyGroups.set(c.proxy_wallet, []);
        }
        proxyGroups.get(c.proxy_wallet)!.push(c.tx_hash);
      }

      // Process each proxy group
      for (const [proxy, hashes] of proxyGroups) {
        // Convert hex hashes to binary for lookup
        const hashList = hashes.map(h => `unhex('${h.slice(2)}')`).join(',');

        const lookupQ = `
          SELECT
            lower(trader_wallet) as user_eoa,
            '${proxy}' as proxy_wallet,
            count() as tx_count
          FROM pm_trader_events_v2
          WHERE transaction_hash IN (${hashList})
            AND is_deleted = 0
            AND lower(trader_wallet) NOT IN (${proxyList})
          GROUP BY lower(trader_wallet)
        `;

        try {
          const lookupR = await clickhouse.query({ query: lookupQ, format: 'JSONEachRow' });
          const matches = await lookupR.json() as any[];

          if (matches.length > 0) {
            // Insert matches
            const insertSQL = `
              INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, tx_count)
              VALUES ${matches.map(m =>
                `('${m.user_eoa}', '${m.proxy_wallet}', ${m.tx_count})`
              ).join(',')}
            `;
            await clickhouse.command({ query: insertSQL });
            totalMappings += matches.length;
          }
        } catch (err: any) {
          // Skip errors (likely memory on large batches)
          if (!err.message?.includes('MEMORY')) {
            console.log(`    Error: ${err.message?.slice(0, 60)}`);
          }
        }
      }

      offset += batchSize;

      // Continue if we got a full batch (there might be more)
      if (ctfBatch.length < batchSize) {
        hasMore = false;
      }
    }

    // Progress every 10 days
    if (day % 10 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalCTFProcessed / elapsed;
      console.log(
        `  Day ${day}: ${totalCTFProcessed.toLocaleString()} CTF hashes processed, ` +
        `${totalMappings.toLocaleString()} mappings found [${rate.toFixed(1)} hashes/sec]`
      );
    }
  }

  // Optimize
  console.log('\nOptimizing table...');
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

  console.log(`Unique user wallets mapped: ${Number(stats.unique_users).toLocaleString()}`);
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
      SELECT proxy_wallet, tx_count
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
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
