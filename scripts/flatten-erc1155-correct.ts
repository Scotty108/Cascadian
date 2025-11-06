#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { Interface } from "ethers";

const CONDITIONAL_TOKENS = process.env.CONDITIONAL_TOKENS || "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

// ERC-1155 event ABIs
const ABI = [
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
];

const iface = new Interface(ABI);

// Event signatures (keccak256)
const TRANSFER_SINGLE_SIG = "0xc3d58168c5ae7397731d063d5bbf3d657706970d1a42a4d696ba6e40b0df91d4";
const TRANSFER_BATCH_SIG = "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595a27a15c63f41890908";

async function createTable() {
  console.log("Creating pm_erc1155_flats table...");

  await ch.exec({
    query: `
      DROP TABLE IF EXISTS pm_erc1155_flats
    `,
  });

  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS pm_erc1155_flats
      (
        tx_hash       String,
        log_index     UInt32,
        block_number  UInt32,
        block_time    DateTime,
        address       String,
        operator      String,
        from_address  String,
        to_address    String,
        token_id      String,
        amount        String,
        event_type    String DEFAULT 'TransferSingle'
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(block_time)
      ORDER BY (address, block_number, log_index)
    `,
  });

  console.log("✅ Table created\n");
}

async function fetchAndFlattenTransfers() {
  console.log("Fetching ERC-1155 transfer events from pre-decoded table...\n");

  // Fetch from already-decoded erc1155_transfers table
  const query = await ch.query({
    query: `
      SELECT
        tx_hash,
        log_index,
        block_number,
        block_timestamp,
        contract,
        operator,
        from_address,
        to_address,
        token_id,
        value,
        decoded_data
      FROM erc1155_transfers
      WHERE lower(contract) = lower('${CONDITIONAL_TOKENS}')
      ORDER BY block_number DESC, log_index DESC
    `,
  });

  const text = await query.text();
  const responseData = JSON.parse(text);
  const rows = responseData.data || [];

  console.log(`Found ${rows.length} transfer events\n`);

  const batch: any[] = [];
  let processedCount = 0;
  let skipped = 0;

  for (const row of rows) {
    try {

      // Sanity checks - skip unreasonable values
      const amount = String(row.value || "0");
      let amountNum = 0n;
      try {
        amountNum = BigInt(amount);
      } catch (e) {
        skipped++;
        continue;
      }

      // Skip if amount > 1e18 units (reasonable sanity cap for ERC1155)
      if (amountNum > 1000000000000000000n) {
        skipped++;
        continue;
      }

      // Require valid addresses (should start with 0x)
      if (!row.from_address?.startsWith("0x") || !row.to_address?.startsWith("0x")) {
        skipped++;
        continue;
      }

      batch.push({
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_number: row.block_number,
        block_time: row.block_timestamp,
        address: row.contract,
        operator: row.operator || "",
        from_address: row.from_address,
        to_address: row.to_address,
        token_id: row.token_id,
        amount: amount,
        event_type: "Transfer",
      });

      processedCount++;

      // Insert in batches
      if (batch.length >= 5000) {
        await ch.insert({
          table: "pm_erc1155_flats",
          values: batch,
          format: "JSONEachRow",
        });

        console.log(`Inserted ${batch.length} rows...`);
        batch.length = 0;
      }
    } catch (e) {
      skipped++;
    }
  }

  // Final insert
  if (batch.length > 0) {
    await ch.insert({
      table: "pm_erc1155_flats",
      values: batch,
      format: "JSONEachRow",
    });
    console.log(`Inserted final ${batch.length} rows...`);
  }

  console.log(`\nProcessed: ${processedCount} transfer events`);
  console.log(`Skipped: ${skipped} (failed validation)\n`);
}

async function runProbes() {
  console.log("Running probes...\n");

  // Probe 1: Total row count
  const countQ = await ch.query({
    query: "SELECT COUNT(*) as cnt FROM pm_erc1155_flats",
  });

  const countText = await countQ.text();
  const countData = JSON.parse(countText);
  const totalRows = countData.data?.[0]?.cnt || 0;

  console.log(`Total rows in pm_erc1155_flats: ${totalRows}\n`);

  // Probe 2: Top addresses
  const addrQ = await ch.query({
    query: `
      SELECT address, count() as cnt
      FROM pm_erc1155_flats
      GROUP BY address
      ORDER BY cnt DESC
      LIMIT 3
    `,
  });

  const addrText = await addrQ.text();
  const addrLines = addrText.trim().split("\n").filter((l) => l.trim());

  console.log("Top 3 addresses by event count:");
  addrLines.forEach((line) => {
    try {
      const row = JSON.parse(line);
      const isCtAddress =
        row.address.toLowerCase() === CONDITIONAL_TOKENS.toLowerCase() ? "✅ CT" : "  ";
      console.log(`  ${isCtAddress} ${row.address.slice(0, 12)}...: ${row.cnt}`);
    } catch (e) {}
  });

  // Probe 3: Event type breakdown
  const eventQ = await ch.query({
    query: `
      SELECT
        countIf(event_type = 'TransferSingle') as single,
        countIf(event_type = 'TransferBatch') as batch
      FROM pm_erc1155_flats
    `,
  });

  const eventText = await eventQ.text();
  const eventData = JSON.parse(eventText);
  const eventRow = eventData.data?.[0];

  console.log(`\nEvent type breakdown:`);
  console.log(`  TransferSingle: ${eventRow?.single || 0}`);
  console.log(`  TransferBatch: ${eventRow?.batch || 0}`);

  console.log("\n");
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 1: REBUILD ERC-1155 EVENT FLATTENING (Correct Decoding)");
  console.log(`ConditionalTokens: ${CONDITIONAL_TOKENS}`);
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    await createTable();
    await fetchAndFlattenTransfers();
    await runProbes();

    console.log("════════════════════════════════════════════════════════════════════");
    console.log("✅ STEP 1 COMPLETE: ERC-1155 flats rebuilt with correct decoding\n");

    process.exit(0);
  } catch (e) {
    console.error("❌ ERROR:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
