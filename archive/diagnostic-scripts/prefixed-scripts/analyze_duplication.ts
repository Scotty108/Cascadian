import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'polymarket_canonical'
});

async function analyzeDuplication() {
  console.log("=== ANALYZING DUPLICATION ===\n");
  
  // 1. Get table schema
  console.log("1. TABLE SCHEMA:");
  const schemaResult = await client.query({
    query: `DESCRIBE TABLE pm_trades_raw`,
    format: 'JSONEachRow'
  });
  const schema = await schemaResult.json();
  console.log(schema);
  
  // 2. Check if table is ReplacingMergeTree
  console.log("\n2. TABLE ENGINE:");
  const engineResult = await client.query({
    query: `SELECT engine, engine_full FROM system.tables WHERE database = 'polymarket_canonical' AND name = 'pm_trades_raw'`,
    format: 'JSONEachRow'
  });
  const engine = await engineResult.json();
  console.log(engine);
  
  // 3. XCN wallet duplication analysis
  console.log("\n3. XCN WALLET DUPLICATION:");
  const xcnResult = await client.query({
    query: `
      SELECT 
        count() as total_rows,
        count(DISTINCT (transaction_hash, log_index)) as unique_by_tx_log,
        count(DISTINCT transaction_hash) as unique_tx,
        count() / count(DISTINCT (transaction_hash, log_index)) as duplication_factor
      FROM pm_trades_raw
      WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
    `,
    format: 'JSONEachRow'
  });
  const xcnStats = await xcnResult.json();
  console.log(xcnStats);
  
  // 4. Sample duplicates
  console.log("\n4. SAMPLE DUPLICATES:");
  const dupResult = await client.query({
    query: `
      SELECT 
        transaction_hash,
        log_index,
        count() as duplicate_count,
        groupArray(timestamp) as timestamps,
        groupArray(side) as sides
      FROM pm_trades_raw
      WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
      GROUP BY transaction_hash, log_index
      HAVING duplicate_count > 1
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const dups = await dupResult.json();
  console.log(JSON.stringify(dups, null, 2));
  
  // 5. Global duplication stats
  console.log("\n5. GLOBAL DUPLICATION:");
  const globalResult = await client.query({
    query: `
      SELECT 
        count() as total_rows,
        count(DISTINCT (transaction_hash, log_index)) as unique_by_tx_log,
        count() / count(DISTINCT (transaction_hash, log_index)) as global_duplication_factor
      FROM pm_trades_raw
    `,
    format: 'JSONEachRow'
  });
  const globalStats = await globalResult.json();
  console.log(globalStats);
  
  await client.close();
}

analyzeDuplication().catch(console.error);
