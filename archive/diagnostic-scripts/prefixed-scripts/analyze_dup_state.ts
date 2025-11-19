import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: 'polymarket_canonical'
});

async function analyze() {
  console.log("=== DUPLICATION ANALYSIS ===\n");
  
  // 1. Table engine
  const engine = await client.query({
    query: `SELECT engine, engine_full FROM system.tables WHERE database = 'polymarket_canonical' AND name = 'pm_trades_raw'`,
    format: 'JSONEachRow'
  });
  console.log("1. TABLE ENGINE:");
  console.log(await engine.json());
  
  // 2. XCN wallet stats
  const xcn = await client.query({
    query: `
      SELECT 
        count() as total_rows,
        count(DISTINCT (transaction_hash, log_index)) as unique_keys,
        total_rows / unique_keys as dup_factor
      FROM pm_trades_raw
      WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
    `,
    format: 'JSONEachRow'
  });
  console.log("\n2. XCN WALLET:");
  console.log(await xcn.json());
  
  // 3. Global stats
  const global = await client.query({
    query: `
      SELECT 
        count() as total_rows,
        count(DISTINCT (transaction_hash, log_index)) as unique_keys,
        total_rows / unique_keys as dup_factor
      FROM pm_trades_raw
    `,
    format: 'JSONEachRow'
  });
  console.log("\n3. GLOBAL:");
  console.log(await global.json());
  
  // 4. Sample duplicate
  const sample = await client.query({
    query: `
      SELECT 
        transaction_hash,
        log_index,
        count() as dup_count
      FROM pm_trades_raw
      WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
      GROUP BY transaction_hash, log_index
      HAVING dup_count > 1
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  console.log("\n4. SAMPLE DUPLICATE:");
  console.log(await sample.json());
  
  await client.close();
}

analyze().catch(console.error);
