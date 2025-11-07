#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 200)}`);
    return false;
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("DEDUP FORENSICS & REBUILD");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Step 1: Forensics - Check insert history
  console.log("📋 FORENSICS: Recent inserts to trades_dedup_mat\n");
  try {
    const inserts = await queryData(`
      SELECT 
        event_time,
        query_id,
        written_rows,
        substring(query, 1, 100) AS query_snippet
      FROM system.query_log
      WHERE type = 'QueryFinish'
        AND query_kind = 'Insert'
        AND table = 'trades_dedup_mat'
      ORDER BY event_time DESC
      LIMIT 20
    `);
    
    console.log(`Found ${inserts.length} recent inserts:`);
    for (const row of inserts) {
      console.log(`  ${row.event_time}: ${row.written_rows} rows - ${row.query_snippet}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message?.substring(0, 100)}`);
  }

  // Step 2: Check for materialized views
  console.log("\n🔍 Check for materialized views targeting trades_dedup_mat\n");
  try {
    const mvs = await queryData(`
      SELECT database, name, engine
      FROM system.tables
      WHERE engine ILIKE '%MaterializedView%'
        AND create_table_query ILIKE '%trades_dedup_mat%'
    `);
    
    if (mvs.length === 0) {
      console.log(`✅ No materialized views found`);
    } else {
      console.log(`⚠️  Found ${mvs.length} materialized views:`);
      for (const mv of mvs) {
        console.log(`  ${mv.database}.${mv.name}`);
      }
    }
  } catch (e: any) {
    console.error(`Error: ${e.message?.substring(0, 100)}`);
  }

  // Step 3: Check table size
  console.log("\n📊 Current trades_dedup_mat size\n");
  try {
    const size = await queryData(`
      SELECT 
        sum(rows) AS total_rows,
        count() AS part_count,
        sum(bytes) / 1024 / 1024 AS size_mb
      FROM system.parts
      WHERE database = currentDatabase() 
        AND table = 'trades_dedup_mat' 
        AND active
    `);
    
    const data = size[0];
    console.log(`  Total rows: ${data.total_rows}`);
    console.log(`  Parts: ${data.part_count}`);
    console.log(`  Size: ${data.size_mb.toFixed(2)} MB`);
  } catch (e: any) {
    console.error(`Error: ${e.message?.substring(0, 100)}`);
  }

  // Step 4: Check schema
  console.log("\n🔑 Check schema and describe trades_raw\n");
  try {
    const schema = await queryData(`DESCRIBE TABLE trades_raw`);
    console.log(`trades_raw columns:`);
    for (const col of schema) {
      console.log(`  ${col.name}: ${col.type}`);
    }
  } catch (e: any) {
    console.error(`Error: ${e.message?.substring(0, 100)}`);
  }

  // Step 5: Now rebuild cleanly
  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("REBUILD: Create clean dedup table");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Create dedup view using row_number
  const dedupView = `CREATE OR REPLACE VIEW trades_dedup_view AS
SELECT *
FROM (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY transaction_hash, lower(wallet_address)
      ORDER BY created_at, trade_id
    ) AS rn
  FROM trades_raw
) WHERE rn = 1`;

  // Drop old bad table and create new one
  const dropOld = `DROP TABLE IF EXISTS trades_dedup_mat_bak;
ALTER TABLE trades_dedup_mat RENAME TO trades_dedup_mat_bak`;

  const createNew = `CREATE TABLE trades_dedup_mat_new
ENGINE = MergeTree
ORDER BY (lower(wallet_address), market_id, outcome_index, transaction_hash)
SETTINGS index_granularity = 8192
AS
SELECT * EXCEPT rn FROM trades_dedup_view`;

  // Verify counts
  const verifyQuery = `
    SELECT 
      count() AS rows_after,
      countDistinct(transaction_hash, lower(wallet_address)) AS uniq_fills
    FROM trades_dedup_mat_new
  `;

  // Swap tables
  const swap = `RENAME TABLE trades_dedup_mat_bak TO trades_dedup_mat_old,
                         trades_dedup_mat_new TO trades_dedup_mat`;

  const steps = [
    ["Create dedup_view with row_number", dedupView],
    ["Backup old table", dropOld],
    ["Create clean dedup_mat_new", createNew],
  ];

  for (const [name, query] of steps) {
    if (await executeQuery(name, query)) {
      if (name.includes("Create clean")) {
        // Verify after creation
        try {
          const result = await queryData(verifyQuery);
          const data = result[0];
          console.log(`\n   ✅ Verification:`);
          console.log(`      Rows: ${data.rows_after}`);
          console.log(`      Unique fills: ${data.uniq_fills}`);
        } catch (e: any) {
          console.error(`   Error verifying: ${e.message?.substring(0, 100)}`);
        }
      }
    }
  }

  // Swap tables
  if (await executeQuery("Swap tables (rename)", swap)) {
    // Clean up old table
    await executeQuery("Drop old backup", "DROP TABLE trades_dedup_mat_old");
    
    // Final verification
    console.log("\n✅ Rebuild complete. Final verification:\n");
    try {
      const final = await queryData(`
        SELECT 
          count() AS final_rows,
          countDistinct(transaction_hash, lower(wallet_address)) AS uniq_fills
        FROM trades_dedup_mat
      `);
      const data = final[0];
      console.log(`  Final rows: ${data.final_rows}`);
      console.log(`  Unique fills: ${data.uniq_fills}`);
      console.log(`  Dedup ratio: ${(data.final_rows / data.uniq_fills).toFixed(1)}x`);
    } catch (e: any) {
      console.error(`Error: ${e.message?.substring(0, 100)}`);
    }
  }
}

main().catch(console.error);
