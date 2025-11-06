#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

// ApprovalForAll event signature
const APPROVAL_FOR_ALL_SIG =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

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
});

function topicToAddress(topic: string): string {
  if (!topic) return "0x0000000000000000000000000000000000000000";
  // Extract last 40 hex chars (20 bytes) from 32-byte padded topic
  const addr = topic.slice(-40);
  return "0x" + addr;
}

async function main() {
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Building EOA → Proxy Wallet mapping from ApprovalForAll events`);
  console.log(`ConditionalTokens: ${CONDITIONAL_TOKENS}`);
  console.log(`════════════════════════════════════════════════════════════════════\n`);

  try {
    // Create or update proxy table
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_user_proxy_wallets
        (
          user_eoa       LowCardinality(String),
          proxy_wallet   String,
          source         LowCardinality(String) DEFAULT 'onchain',
          first_seen_block UInt32,
          last_seen_block  UInt32,
          first_seen_at  DateTime,
          last_seen_at   DateTime DEFAULT now(),
          is_active      UInt8 DEFAULT 1
        )
        ENGINE = ReplacingMergeTree()
        PRIMARY KEY (proxy_wallet)
        ORDER BY (proxy_wallet)
      `,
    });
    console.log("✅ pm_user_proxy_wallets table ready\n");

    // Fetch ApprovalForAll events from ConditionalTokens
    console.log("Fetching ApprovalForAll events...");
    const approvalQ = await ch.query({
      query: `
        SELECT
          block_number,
          block_time,
          topics[2] AS owner_padded,
          topics[3] AS operator_padded,
          data
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
          AND topics[1] = {sig:String}
        ORDER BY block_number, log_index
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: CONDITIONAL_TOKENS.toLowerCase(),
        sig: APPROVAL_FOR_ALL_SIG,
      },
    });

    const approvalReader = approvalQ.stream();
    let processed = 0;
    let approved = 0;
    let revoked = 0;
    const batch: any[] = [];
    const seenMap = new Map<string, { block: number; owner: string }>();

    for await (const raw of approvalReader) {
      const row = JSON.parse(raw.toString("utf8"));

      const ownerEOA = topicToAddress(row.owner_padded).toLowerCase();
      const proxyWallet = topicToAddress(row.operator_padded).toLowerCase();

      // data is a boolean: approval status (1 = approved, 0 = revoked)
      const approved_flag =
        row.data === "0x0000000000000000000000000000000000000000000000000000000000000001"
          ? 1
          : 0;

      processed++;

      if (processed % 50000 === 0) {
        process.stdout.write(
          `\rProcessed: ${processed}, Approved: ${approved}, Revoked: ${revoked}`
        );
      }

      // Track most recent state for each (owner, proxy) pair
      const key = `${ownerEOA}:${proxyWallet}`;
      const existing = seenMap.get(key);

      if (!existing || row.block_number > existing.block) {
        seenMap.set(key, { block: row.block_number, owner: ownerEOA });

        if (approved_flag) {
          approved++;
        } else {
          revoked++;
        }

        batch.push({
          user_eoa: ownerEOA,
          proxy_wallet: proxyWallet,
          source: "onchain",
          first_seen_block: row.block_number,
          last_seen_block: row.block_number,
          first_seen_at: row.block_time,
          last_seen_at: row.block_time,
          is_active: approved_flag,
        });

        if (batch.length >= 5000) {
          await ch.insert({
            table: "pm_user_proxy_wallets",
            values: batch,
            format: "JSONEachRow",
          });
          batch.length = 0;
        }
      }
    }

    if (batch.length > 0) {
      await ch.insert({
        table: "pm_user_proxy_wallets",
        values: batch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n✅ Processed: ${processed} events`);
    console.log(`   Approvals: ${approved}`);
    console.log(`   Revocations: ${revoked}\n`);

    // Show statistics
    const statsQ = await ch.query({
      query: `
        SELECT
          countIf(is_active = 1) AS active_pairs,
          countIf(is_active = 0) AS revoked_pairs,
          COUNT(DISTINCT user_eoa) AS unique_eoas,
          COUNT(DISTINCT proxy_wallet) AS unique_proxies
        FROM pm_user_proxy_wallets
        FORMAT JSONEachRow
      `,
    });

    const statsText = await statsQ.text();
    const stats = JSON.parse(statsText.trim());

    console.log(`════════════════════════════════════════════════════════════════════`);
    console.log(`Summary:`);
    console.log(`  Active EOA→Proxy pairs: ${stats.active_pairs}`);
    console.log(`  Revoked pairs: ${stats.revoked_pairs}`);
    console.log(`  Unique EOAs: ${stats.unique_eoas}`);
    console.log(`  Unique Proxies: ${stats.unique_proxies}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);

    // Show top EOAs by activity
    console.log(`Top 20 EOAs by proxy count:\n`);
    const topQ = await ch.query({
      query: `
        SELECT
          user_eoa,
          COUNT(DISTINCT proxy_wallet) AS proxy_count,
          countIf(is_active = 1) AS active_proxies
        FROM pm_user_proxy_wallets
        GROUP BY user_eoa
        ORDER BY proxy_count DESC
        LIMIT 20
        FORMAT JSONEachRow
      `,
    });

    const topText = await topQ.text();
    const topLines = topText.trim().split("\n");
    for (let i = 0; i < topLines.length; i++) {
      const row = JSON.parse(topLines[i]);
      console.log(
        `${(i + 1).toString().padStart(2)}. ${row.user_eoa} - ${row.proxy_count} proxies (${row.active_proxies} active)`
      );
    }

    console.log("");
    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
