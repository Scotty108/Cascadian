#!/usr/bin/env npx tsx

/**
 * =====================================================================
 * DECODE TRANSFERBATCH EVENTS WITH ETHERS.JS
 * =====================================================================
 *
 * TransferBatch events have complex ABI encoding with dynamic arrays:
 *   event TransferBatch(
 *     address indexed operator,
 *     address indexed from,
 *     address indexed to,
 *     uint256[] ids,
 *     uint256[] amounts
 *   )
 *
 * This script properly decodes the data field using ethers.js Interface
 * and flattens into individual rows for pm_erc1155_flats.
 *
 * Run with: npx tsx scripts/decode-transfer-batch.ts
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { Interface } from "ethers";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
  compression: { response: true },
});

// Event signatures
const TRANSFER_BATCH =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";

// Polymarket ConditionalTokens
const CONDITIONAL_TOKENS =
  process.env.CONDITIONAL_TOKENS ||
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

// ERC1155 ABI fragment for TransferBatch
const ERC1155_ABI = [
  "event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] amounts)",
];

const iface = new Interface(ERC1155_ABI);

function extractAddress(topic: string): string {
  // Topics are 32-byte padded, extract last 20 bytes (40 hex chars)
  if (!topic || topic.length < 66) return "0x0000000000000000000000000000000000000000";
  return "0x" + topic.slice(-40);
}

async function main() {
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Decoding TransferBatch Events with ethers.js`);
  console.log(`ConditionalTokens: ${CONDITIONAL_TOKENS}`);
  console.log(`════════════════════════════════════════════════════════════════════\n`);

  try {
    // Check if pm_erc1155_flats exists
    console.log("Checking pm_erc1155_flats table...");
    const tableCheck = await ch.query({
      query: `
        SELECT 1 FROM system.tables
        WHERE database = currentDatabase() AND name = 'pm_erc1155_flats'
        FORMAT JSONEachRow
      `,
    });
    const tableText = await tableCheck.text();
    const tableExists = tableText.trim().length > 0;

    if (!tableExists) {
      console.log("Creating pm_erc1155_flats table...");
      await ch.exec({
        query: `
          CREATE TABLE IF NOT EXISTS pm_erc1155_flats
          (
            block_number   UInt32,
            block_time     DateTime,
            tx_hash        String,
            log_index      UInt32,
            operator       String,
            from_addr      String,
            to_addr        String,
            token_id       String,
            amount         String,
            event_type     LowCardinality(String) DEFAULT 'single' COMMENT 'single or batch'
          )
          ENGINE = MergeTree
          PARTITION BY toYYYYMM(block_time)
          ORDER BY (block_number, tx_hash, log_index)
          COMMENT 'Flattened ERC1155 transfer events';
        `,
      });
      console.log("✅ Table created\n");
    } else {
      console.log("✅ Table exists\n");
    }

    // Count TransferBatch events
    console.log("Counting TransferBatch events...");
    const countRs = await ch.query({
      query: `
        SELECT COUNT(*) as cnt
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
          AND topics[1] = {sig:String}
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: CONDITIONAL_TOKENS.toLowerCase(),
        sig: TRANSFER_BATCH,
      },
    });
    const countText = await countRs.text();
    const countRow = JSON.parse(countText.trim());

    console.log(`Found ${countRow.cnt.toLocaleString()} TransferBatch events\n`);

    if (countRow.cnt === 0) {
      console.log("⚠️  No TransferBatch events to decode. Exiting.");
      return;
    }

    // Fetch and decode TransferBatch events
    console.log("Fetching and decoding TransferBatch events...");
    const batchQ = await ch.query({
      query: `
        SELECT
          block_number,
          block_time,
          tx_hash,
          log_index,
          topics,
          data
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
          AND topics[1] = {sig:String}
        ORDER BY block_number, log_index
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: CONDITIONAL_TOKENS.toLowerCase(),
        sig: TRANSFER_BATCH,
      },
    });

    const batchReader = batchQ.stream();
    let processed = 0;
    let decoded = 0;
    let failed = 0;
    let totalFlattened = 0;
    const batch: any[] = [];

    for await (const raw of batchReader) {
      const row = JSON.parse(raw.toString("utf8"));
      processed++;

      try {
        // Extract indexed parameters from topics
        const operator = extractAddress(row.topics[2]);
        const from = extractAddress(row.topics[3]);
        const to = extractAddress(row.topics[4]);

        // Decode data field containing arrays
        const decodedData = iface.parseLog({
          topics: row.topics,
          data: row.data,
        });

        if (!decodedData) {
          throw new Error("Failed to decode log");
        }

        // Extract arrays
        const ids = decodedData.args[3]; // uint256[] ids
        const amounts = decodedData.args[4]; // uint256[] amounts

        // Flatten: one row per token
        for (let i = 0; i < ids.length; i++) {
          const tokenId = "0x" + ids[i].toString(16).padStart(64, "0");
          const amount = "0x" + amounts[i].toString(16).padStart(64, "0");

          batch.push({
            block_number: row.block_number,
            block_time: row.block_time,
            tx_hash: row.tx_hash,
            log_index: row.log_index,
            operator: operator.toLowerCase(),
            from_addr: from.toLowerCase(),
            to_addr: to.toLowerCase(),
            token_id: tokenId,
            amount: amount,
            event_type: "batch",
          });

          totalFlattened++;
        }

        decoded++;

        // Insert in batches
        if (batch.length >= 5000) {
          await ch.insert({
            table: "pm_erc1155_flats",
            values: batch,
            format: "JSONEachRow",
          });
          batch.length = 0;
        }

        if (processed % 1000 === 0) {
          process.stdout.write(
            `\rProcessed: ${processed}, Decoded: ${decoded}, Failed: ${failed}, Flattened: ${totalFlattened}`
          );
        }
      } catch (e) {
        failed++;
        if (failed <= 5) {
          console.error(
            `\n⚠️  Failed to decode event at block ${row.block_number}, tx ${row.tx_hash}:`,
            (e as Error).message
          );
        }
      }
    }

    // Insert remaining
    if (batch.length > 0) {
      await ch.insert({
        table: "pm_erc1155_flats",
        values: batch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n\n✅ Decoding complete!`);
    console.log(`   Processed: ${processed} TransferBatch events`);
    console.log(`   Decoded: ${decoded} successfully`);
    console.log(`   Failed: ${failed}`);
    console.log(`   Flattened into: ${totalFlattened} individual transfers\n`);

    // Verify pm_erc1155_flats
    console.log("Verifying pm_erc1155_flats...");
    const verifyRs = await ch.query({
      query: `
        SELECT
          event_type,
          COUNT(*) as cnt
        FROM pm_erc1155_flats
        GROUP BY event_type
        FORMAT JSONEachRow
      `,
    });
    const verifyText = await verifyRs.text();
    const verifyLines = verifyText.trim().split("\n");

    console.log("\nBreakdown by event type:");
    verifyLines.forEach((line) => {
      const row = JSON.parse(line);
      console.log(`  ${row.event_type}: ${row.cnt.toLocaleString()} rows`);
    });

    console.log(`\n════════════════════════════════════════════════════════════════════`);
    console.log(`✅ TransferBatch decoding complete!`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);
  } catch (e) {
    console.error("❌ Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
