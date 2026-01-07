/**
 * Build wallet_identity_map - V5 (Per-wallet on-demand approach)
 *
 * Key insight: We don't need to map ALL wallets, just leaderboard candidates.
 * For each candidate wallet:
 * 1. Get their CLOB tx_hashes (fast - single wallet)
 * 2. Check which hashes exist in CTF proxy events (fast - IN query)
 *
 * This avoids the memory issues entirely by never doing large aggregations.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
];

interface ProxyMapping {
  proxy_wallet: string;
  tx_count: number;
  first_seen: string;
  last_seen: string;
}

async function getProxyMappingsForWallet(wallet: string): Promise<ProxyMapping[]> {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Get this wallet's CLOB tx_hashes (very fast for single wallet)
  // Use a subquery approach that doesn't require materializing all hashes
  const query = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      LIMIT 10000  -- Cap at 10k txs per wallet
    )
    SELECT
      lower(user_address) as proxy_wallet,
      count() as tx_count,
      min(event_timestamp) as first_seen,
      max(event_timestamp) as last_seen
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND lower(user_address) IN (${proxyList})
      AND is_deleted = 0
    GROUP BY lower(user_address)
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];
    return rows.map(r => ({
      proxy_wallet: r.proxy_wallet,
      tx_count: Number(r.tx_count),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    }));
  } catch (err) {
    return [];
  }
}

async function main() {
  console.log('Building wallet_identity_map (V5 - per-wallet queries)...\n');

  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  // Step 1: Create target table
  console.log('Step 1: Creating wallet_identity_map table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS wallet_identity_map' });

  const createSQL = `
    CREATE TABLE wallet_identity_map (
      user_eoa String,
      proxy_wallet String,
      tx_count UInt64,
      first_seen DateTime,
      last_seen DateTime
    )
    ENGINE = ReplacingMergeTree()
    ORDER BY (user_eoa, proxy_wallet)
  `;
  await clickhouse.command({ query: createSQL });
  console.log('✅ Table created\n');

  // Step 2: Get candidate wallets (active traders from last 90 days)
  console.log('Step 2: Getting candidate wallets...');
  const candidateQuery = `
    SELECT
      lower(trader_wallet) as wallet,
      count() as trades
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= now() - INTERVAL 90 DAY
    GROUP BY lower(trader_wallet)
    HAVING trades >= 10  -- At least 10 trades
    ORDER BY trades DESC
    LIMIT 50000  -- Top 50k by activity
  `;

  const candidateResult = await clickhouse.query({ query: candidateQuery, format: 'JSONEachRow' });
  const candidates = (await candidateResult.json() as any[]).map(r => r.wallet);
  console.log(`Found ${candidates.length.toLocaleString()} candidate wallets\n`);

  // Step 3: Process each wallet
  console.log('Step 3: Building mappings per wallet...');
  let processedCount = 0;
  let mappedCount = 0;
  let totalMappings = 0;
  const batchSize = 100;
  let insertBatch: { user_eoa: string; proxy_wallet: string; tx_count: number; first_seen: string; last_seen: string }[] = [];

  const startTime = Date.now();

  for (const wallet of candidates) {
    const mappings = await getProxyMappingsForWallet(wallet);

    if (mappings.length > 0) {
      mappedCount++;
      for (const m of mappings) {
        insertBatch.push({
          user_eoa: wallet,
          proxy_wallet: m.proxy_wallet,
          tx_count: m.tx_count,
          first_seen: m.first_seen,
          last_seen: m.last_seen,
        });
        totalMappings++;
      }
    }

    // Batch insert
    if (insertBatch.length >= batchSize) {
      const insertSQL = `
        INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, tx_count, first_seen, last_seen)
        VALUES ${insertBatch.map(b =>
          `('${b.user_eoa}', '${b.proxy_wallet}', ${b.tx_count}, '${b.first_seen}', '${b.last_seen}')`
        ).join(',')}
      `;
      await clickhouse.command({ query: insertSQL });
      insertBatch = [];
    }

    processedCount++;

    // Progress every 500 wallets
    if (processedCount % 500 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / elapsed;
      const eta = (candidates.length - processedCount) / rate;
      console.log(
        `  ${processedCount.toLocaleString()}/${candidates.length.toLocaleString()} wallets ` +
        `(${mappedCount.toLocaleString()} mapped, ${totalMappings.toLocaleString()} mappings) ` +
        `[${rate.toFixed(1)}/sec, ETA ${Math.ceil(eta / 60)}min]`
      );
    }
  }

  // Insert remaining batch
  if (insertBatch.length > 0) {
    const insertSQL = `
      INSERT INTO wallet_identity_map (user_eoa, proxy_wallet, tx_count, first_seen, last_seen)
      VALUES ${insertBatch.map(b =>
        `('${b.user_eoa}', '${b.proxy_wallet}', ${b.tx_count}, '${b.first_seen}', '${b.last_seen}')`
      ).join(',')}
    `;
    await clickhouse.command({ query: insertSQL });
  }

  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n✅ Processed ${processedCount.toLocaleString()} wallets in ${(totalTime / 60).toFixed(1)} minutes`);

  // Step 4: Final stats
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
      SELECT proxy_wallet, tx_count, first_seen, last_seen
      FROM wallet_identity_map
      WHERE lower(user_eoa) = lower('${w.addr}')
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const mappings = await r.json() as any[];

    console.log(`\n${w.name}:`);
    if (mappings.length === 0) {
      // Check if they were in candidates
      const inCandidates = candidates.includes(w.addr.toLowerCase());
      if (inCandidates) {
        console.log('  In candidates but no proxy mappings (pure CLOB trader)');
      } else {
        console.log('  Not in candidate list (< 10 trades in last 90 days?)');
      }
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
