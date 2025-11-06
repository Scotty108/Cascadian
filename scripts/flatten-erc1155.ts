#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

// ERC1155 event signatures (topics[1] in SQL, topics[0] in JS)
const TRANSFER_SINGLE =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const TRANSFER_BATCH =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const APPROVAL_FOR_ALL =
  "0xa39707aee45523880143dba1da92036e62aa63c0";

// Polymarket ConditionalTokens on Polygon (corrected)
const CONDITIONAL_TOKENS =
  process.env.CONDITIONAL_TOKENS ||
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
  compression: { response: true },
});

function hexToUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}

async function main() {
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Flattening ERC1155 transfers from ConditionalTokens`);
  console.log(`Address: ${CONDITIONAL_TOKENS}`);
  console.log(`════════════════════════════════════════════════════════════════════\n`);

  try {
    // Create table if not exists with proper schema
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_erc1155_flats
        (
          block_number   UInt32,
          block_time     DateTime,
          tx_hash        String,
          log_index      UInt32,
          operator       String,
          from_address   String,
          to_address     String,
          token_id       String,
          amount         String,
          address        String
        )
        ENGINE = MergeTree
        PARTITION BY toYYYYMM(block_time)
        ORDER BY (block_number, tx_hash, log_index)
      `,
    });
    console.log("✅ pm_erc1155_flats table ready\n");

    // Fetch TransferSingle events (topics[1] in SQL = signature)
    console.log("Fetching TransferSingle events...");
    const singleQ = await ch.query({
      query: `
        SELECT
          block_number,
          block_time,
          tx_hash,
          log_index,
          topics[2] AS operator,
          topics[3] AS from_address,
          topics[4] AS to_address,
          data,
          address
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
          AND topics[1] = {sig:String}
          AND NOT startsWith(data, '0xff')
        ORDER BY block_number, log_index
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: CONDITIONAL_TOKENS.toLowerCase(),
        sig: TRANSFER_SINGLE,
      },
    });

    const singleReader = singleQ.stream();
    let singleCount = 0;
    const batch: any[] = [];

    for await (const raw of singleReader) {
      const row = JSON.parse(raw.toString("utf8"));

      // Extract token_id (bytes 0-32) and amount (bytes 32-64)
      const tokenId = "0x" + row.data.slice(2, 66);
      const amount = "0x" + row.data.slice(66, 130);

      batch.push({
        block_number: row.block_number,
        block_time: row.block_time,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        operator: row.operator,
        from_address: row.from_address,
        to_address: row.to_address,
        token_id: tokenId,
        amount: amount,
        address: row.address,
      });

      singleCount++;
      if (singleCount % 10000 === 0) {
        process.stdout.write(`\rTransferSingle processed: ${singleCount}`);
      }

      if (batch.length >= 5000) {
        await ch.insert({
          table: "pm_erc1155_flats",
          values: batch,
          format: "JSONEachRow",
        });
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await ch.insert({
        table: "pm_erc1155_flats",
        values: batch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n✅ TransferSingle: ${singleCount} events\n`);

    // Fetch TransferBatch events (requires ABI decoding - for now, parse manually)
    // Note: TransferBatch has complex data format - will need ethers ABI decoder
    console.log("Fetching TransferBatch events...");
    const batchQ = await ch.query({
      query: `
        SELECT
          block_number,
          block_time,
          tx_hash,
          log_index,
          topics[2] AS operator,
          topics[3] AS from_address,
          topics[4] AS to_address,
          data,
          address
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
          AND topics[1] = {sig:String}
          AND NOT startsWith(data, '0xff')
        ORDER BY block_number, log_index
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: CONDITIONAL_TOKENS.toLowerCase(),
        sig: TRANSFER_BATCH,
      },
    });

    const batchReader = batchQ.stream();
    let batchCount = 0;
    const batchBatch: any[] = [];

    for await (const raw of batchReader) {
      const row = JSON.parse(raw.toString("utf8"));

      // For now, store batch data as-is
      // Full decoding requires ABI parsing of dynamic arrays
      // TODO: Use ethers.Interface to decode TransferBatch properly
      batchBatch.push({
        block_number: row.block_number,
        block_time: row.block_time,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        operator: row.operator,
        from_address: row.from_address,
        to_address: row.to_address,
        token_id: "0x", // Placeholder - needs ABI decode
        amount: "0x", // Placeholder - needs ABI decode
        address: row.address,
      });

      batchCount++;
      if (batchCount % 10000 === 0) {
        process.stdout.write(`\rTransferBatch processed: ${batchCount}`);
      }

      if (batchBatch.length >= 5000) {
        await ch.insert({
          table: "pm_erc1155_flats",
          values: batchBatch,
          format: "JSONEachRow",
        });
        batchBatch.length = 0;
      }
    }

    if (batchBatch.length > 0) {
      await ch.insert({
        table: "pm_erc1155_flats",
        values: batchBatch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n✅ TransferBatch: ${batchCount} events (needs ABI decoding)\n`);

    // Show totals
    const countQ = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_erc1155_flats FORMAT JSONEachRow`,
    });
    const countText = await countQ.text();
    const countRow = JSON.parse(countText.trim());

    console.log(`════════════════════════════════════════════════════════════════════`);
    console.log(`Total rows in pm_erc1155_flats: ${countRow.cnt}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
