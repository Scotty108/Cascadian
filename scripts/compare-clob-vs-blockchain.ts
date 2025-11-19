import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("CLOB vs Blockchain Data Comparison");
  console.log("═".repeat(80));
  console.log();

  // First, check what ERC1155 tables we have
  console.log("Checking for ERC1155 tables...");
  const tablesQuery = await clickhouse.query({
    query: "SHOW TABLES LIKE '%erc1155%'",
    format: 'JSONEachRow'
  });
  const tables = await tablesQuery.json();

  if (tables.length === 0) {
    console.log("❌ No ERC1155 tables found in database");
    console.log();
    console.log("Available tables:");
    const allTables = await clickhouse.query({
      query: "SHOW TABLES",
      format: 'JSONEachRow'
    });
    const all = await allTables.json();
    console.log(all.slice(0, 20).map(t => `  - ${t.name}`).join('\n'));
    return;
  }

  console.log(`✅ Found ${tables.length} ERC1155 table(s):`);
  tables.forEach(t => console.log(`  - ${t.name}`));
  console.log();

  // Try to query the main ERC1155 table
  const erc1155Table = tables.find(t =>
    t.name === 'erc1155_transfers'
  )?.name || 'erc1155_transfers';

  if (!erc1155Table) {
    console.log("⚠️  Could not identify main ERC1155 transfers table");
    return;
  }

  console.log(`Using table: ${erc1155Table}`);
  console.log();

  // Check schema
  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE TABLE ${erc1155Table}`,
    format: 'JSONEachRow'
  });
  const schema = await schemaQuery.json();

  console.log("Table schema:");
  console.table(schema.slice(0, 15).map(c => ({ name: c.name, type: c.type })));
  console.log();

  // Try to find wallet address field
  const addressFields = schema.filter(c =>
    c.name.toLowerCase().includes('from') ||
    c.name.toLowerCase().includes('to') ||
    c.name.toLowerCase().includes('address')
  );

  console.log("Potential address fields:");
  addressFields.forEach(f => console.log(`  - ${f.name} (${f.type})`));
  console.log();

  // Attempt to query transfers
  const hasFrom = schema.some(c => c.name === 'from' || c.name === 'from_address');
  const hasTo = schema.some(c => c.name === 'to' || c.name === 'to_address');

  if (hasFrom && hasTo) {
    const fromField = schema.find(c => c.name === 'from' || c.name === 'from_address').name;
    const toField = schema.find(c => c.name === 'to' || c.name === 'to_address').name;

    console.log(`Querying transfers for wallet (from: ${fromField}, to: ${toField})...`);

    const transferQuery = `
      SELECT count(*) as transfer_count
      FROM ${erc1155Table}
      WHERE lower(${fromField}) = lower('${wallet}')
         OR lower(${toField}) = lower('${wallet}')
    `;

    const transferRes = await clickhouse.query({
      query: transferQuery,
      format: 'JSONEachRow'
    });
    const [result] = await transferRes.json();

    console.log();
    console.log("═".repeat(80));
    console.log("COMPARISON:");
    console.log(`  CLOB fills:        194`);
    console.log(`  Blockchain transfers: ${result.transfer_count}`);
    console.log();

    if (Number(result.transfer_count) > 194) {
      const diff = Number(result.transfer_count) - 194;
      console.log(`  ✅ Blockchain has ${diff} MORE transfers than CLOB!`);
      console.log();
      console.log("This could explain the missing P&L.");
      console.log("Next step: Rebuild P&L using blockchain data instead of clob_fills");
    } else if (Number(result.transfer_count) < 194) {
      console.log(`  ⚠️  Blockchain has FEWER transfers than CLOB`);
      console.log("This is unexpected - CLOB should be a subset of blockchain");
    } else {
      console.log(`  → Same count - might be 1:1 mapping`);
    }
    console.log("═".repeat(80));

  } else {
    console.log("⚠️  Could not identify from/to address fields");
    console.log("Manual inspection required");
  }
}

main().catch(console.error);
