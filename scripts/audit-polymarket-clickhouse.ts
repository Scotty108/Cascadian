#!/usr/bin/env npx tsx

/**
 * =====================================================================
 * POLYMARKET CLICKHOUSE DATA AUDIT
 * =====================================================================
 *
 * This script performs a comprehensive audit of the ClickHouse tables
 * required for Polymarket data pipeline:
 *
 * 1. Autodetect ConditionalTokens contract address
 * 2. Audit current state of all tables
 * 3. Check data quality and completeness
 * 4. Provide exact implementation plan
 *
 * Run with: npx tsx scripts/audit-polymarket-clickhouse.ts
 */

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
  compression: { response: true },
});

// Event signatures
const TRANSFER_SINGLE =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const TRANSFER_BATCH =
  "0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb";
const APPROVAL_FOR_ALL =
  "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

interface TableAudit {
  name: string;
  exists: boolean;
  row_count: number;
  schema: string[];
  sample_data?: any[];
  issues: string[];
  recommendations: string[];
}

async function section(title: string) {
  console.log("\n" + "=".repeat(80));
  console.log(title);
  console.log("=".repeat(80) + "\n");
}

async function subsection(title: string) {
  console.log("\n" + "-".repeat(60));
  console.log(title);
  console.log("-".repeat(60));
}

async function tableExists(tableName: string): Promise<boolean> {
  try {
    const rs = await ch.query({
      query: `SELECT 1 FROM system.tables WHERE database = currentDatabase() AND name = {table:String} FORMAT JSONEachRow`,
      query_params: { table: tableName },
    });
    const text = await rs.text();
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

async function getTableSchema(tableName: string): Promise<string[]> {
  try {
    const rs = await ch.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = currentDatabase() AND table = {table:String}
        ORDER BY position
        FORMAT JSONEachRow
      `,
      query_params: { table: tableName },
    });
    const text = await rs.text();
    const lines = text.trim().split("\n").filter((l) => l.length > 0);
    return lines.map((line) => {
      const col = JSON.parse(line);
      return `${col.name}: ${col.type}`;
    });
  } catch {
    return [];
  }
}

async function getRowCount(tableName: string): Promise<number> {
  try {
    const rs = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM ${tableName} FORMAT JSONEachRow`,
    });
    const text = await rs.text();
    const row = JSON.parse(text.trim());
    return row.cnt;
  } catch {
    return 0;
  }
}

async function getSampleData(
  tableName: string,
  limit: number = 3
): Promise<any[]> {
  try {
    const rs = await ch.query({
      query: `SELECT * FROM ${tableName} LIMIT ${limit} FORMAT JSONEachRow`,
    });
    const text = await rs.text();
    const lines = text.trim().split("\n").filter((l) => l.length > 0);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function auditTable(tableName: string): Promise<TableAudit> {
  const audit: TableAudit = {
    name: tableName,
    exists: false,
    row_count: 0,
    schema: [],
    issues: [],
    recommendations: [],
  };

  audit.exists = await tableExists(tableName);

  if (!audit.exists) {
    audit.issues.push(`Table ${tableName} does NOT exist`);
    return audit;
  }

  audit.schema = await getTableSchema(tableName);
  audit.row_count = await getRowCount(tableName);
  audit.sample_data = await getSampleData(tableName);

  return audit;
}

async function autodetectCTAddress(): Promise<string | null> {
  subsection("AUTODETECTING CONDITIONAL TOKENS CONTRACT ADDRESS");

  try {
    const rs = await ch.query({
      query: `
        SELECT
          lower(address) as address,
          count() AS event_count
        FROM erc1155_transfers
        WHERE topics[1] IN (
          '${TRANSFER_SINGLE}',
          '${TRANSFER_BATCH}'
        )
        GROUP BY address
        ORDER BY event_count DESC
        LIMIT 5
        FORMAT JSONEachRow
      `,
    });

    const text = await rs.text();
    const lines = text.trim().split("\n").filter((l) => l.length > 0);

    if (lines.length === 0) {
      console.log("❌ No ERC1155 transfer events found in erc1155_transfers");
      return null;
    }

    console.log("Top addresses emitting ERC1155 transfer events:\n");
    const results = lines.map((line) => JSON.parse(line));

    results.forEach((row, i) => {
      const marker = i === 0 ? "✅" : "  ";
      console.log(
        `${marker} ${i + 1}. ${row.address} - ${row.event_count.toLocaleString()} events`
      );
    });

    const topAddress = results[0].address;
    console.log(`\n✅ Detected CT address: ${topAddress}`);
    console.log(
      `   Total transfer events: ${results[0].event_count.toLocaleString()}`
    );

    return topAddress;
  } catch (e) {
    console.error("❌ Error autodetecting CT address:", e);
    return null;
  }
}

async function auditErc1155Transfers(ctAddress: string) {
  subsection("AUDITING erc1155_transfers SOURCE TABLE");

  try {
    // Get total count
    const totalRs = await ch.query({
      query: `
        SELECT COUNT(*) as cnt
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String}
        FORMAT JSONEachRow
      `,
      query_params: { ct: ctAddress.toLowerCase() },
    });
    const totalText = await totalRs.text();
    const totalRow = JSON.parse(totalText.trim());

    // Count by event type
    const singleRs = await ch.query({
      query: `
        SELECT COUNT(*) as cnt
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String} AND topics[1] = {sig:String}
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: ctAddress.toLowerCase(),
        sig: TRANSFER_SINGLE,
      },
    });
    const singleText = await singleRs.text();
    const singleRow = JSON.parse(singleText.trim());

    const batchRs = await ch.query({
      query: `
        SELECT COUNT(*) as cnt
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String} AND topics[1] = {sig:String}
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: ctAddress.toLowerCase(),
        sig: TRANSFER_BATCH,
      },
    });
    const batchText = await batchRs.text();
    const batchRow = JSON.parse(batchText.trim());

    const approvalRs = await ch.query({
      query: `
        SELECT COUNT(*) as cnt
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String} AND topics[1] = {sig:String}
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: ctAddress.toLowerCase(),
        sig: APPROVAL_FOR_ALL,
      },
    });
    const approvalText = await approvalRs.text();
    const approvalRow = JSON.parse(approvalText.trim());

    console.log(`Total events from CT address: ${totalRow.cnt.toLocaleString()}`);
    console.log(`  - TransferSingle: ${singleRow.cnt.toLocaleString()}`);
    console.log(`  - TransferBatch: ${batchRow.cnt.toLocaleString()}`);
    console.log(`  - ApprovalForAll: ${approvalRow.cnt.toLocaleString()}`);

    // Sample data
    const sampleRs = await ch.query({
      query: `
        SELECT
          block_number,
          block_time,
          tx_hash,
          log_index,
          topics,
          data
        FROM erc1155_transfers
        WHERE lower(address) = {ct:String} AND topics[1] = {sig:String}
        ORDER BY block_number DESC
        LIMIT 2
        FORMAT JSONEachRow
      `,
      query_params: {
        ct: ctAddress.toLowerCase(),
        sig: TRANSFER_SINGLE,
      },
    });
    const sampleText = await sampleRs.text();
    const sampleLines = sampleText.trim().split("\n");

    console.log(`\n📊 Sample TransferSingle event:`);
    if (sampleLines.length > 0) {
      const sample = JSON.parse(sampleLines[0]);
      console.log(`   Block: ${sample.block_number}`);
      console.log(`   TxHash: ${sample.tx_hash}`);
      console.log(`   Topics: ${sample.topics.length} items`);
      console.log(`   Data length: ${sample.data.length} chars`);
      console.log(`   Data: ${sample.data.slice(0, 100)}...`);
    }

    return {
      total: totalRow.cnt,
      single: singleRow.cnt,
      batch: batchRow.cnt,
      approval: approvalRow.cnt,
    };
  } catch (e) {
    console.error("❌ Error auditing erc1155_transfers:", e);
    return { total: 0, single: 0, batch: 0, approval: 0 };
  }
}

async function main() {
  console.log("\n" + "█".repeat(80));
  console.log("█" + " ".repeat(78) + "█");
  console.log(
    "█" +
      " ".center(78, " ") +
      "POLYMARKET CLICKHOUSE DATA AUDIT".padStart(54) +
      " ".repeat(24) +
      "█"
  );
  console.log("█" + " ".repeat(78) + "█");
  console.log("█".repeat(80));

  try {
    // ========================================================================
    // STEP 1: AUTODETECT CT ADDRESS
    // ========================================================================
    await section("STEP 1: AUTODETECT CONDITIONAL TOKENS ADDRESS");
    const ctAddress = await autodetectCTAddress();

    if (!ctAddress) {
      console.log("\n❌ Cannot proceed without CT address. Exiting.");
      process.exit(1);
    }

    // ========================================================================
    // STEP 2: AUDIT SOURCE DATA
    // ========================================================================
    await section("STEP 2: AUDIT SOURCE DATA (erc1155_transfers)");
    const sourceStats = await auditErc1155Transfers(ctAddress);

    // ========================================================================
    // STEP 3: AUDIT TARGET TABLES
    // ========================================================================
    await section("STEP 3: AUDIT TARGET TABLES");

    subsection("Table: pm_erc1155_flats");
    const flatsAudit = await auditTable("pm_erc1155_flats");
    console.log(`Exists: ${flatsAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${flatsAudit.row_count.toLocaleString()}`);
    if (flatsAudit.schema.length > 0) {
      console.log(`Schema:`);
      flatsAudit.schema.forEach((col) => console.log(`  - ${col}`));
    }
    if (flatsAudit.row_count === 0) {
      console.log(
        `\n⚠️  TABLE IS EMPTY - needs to be populated from erc1155_transfers`
      );
    }

    subsection("Table: pm_user_proxy_wallets");
    const proxyAudit = await auditTable("pm_user_proxy_wallets");
    console.log(`Exists: ${proxyAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${proxyAudit.row_count.toLocaleString()}`);
    if (proxyAudit.schema.length > 0) {
      console.log(`Schema:`);
      proxyAudit.schema.forEach((col) => console.log(`  - ${col}`));
    }
    if (proxyAudit.row_count === 0) {
      console.log(
        `\n⚠️  TABLE IS EMPTY - needs to be populated from ApprovalForAll events`
      );
    }

    subsection("Table: ctf_token_map");
    const tokenMapAudit = await auditTable("ctf_token_map");
    console.log(`Exists: ${tokenMapAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${tokenMapAudit.row_count.toLocaleString()}`);
    if (tokenMapAudit.schema.length > 0) {
      console.log(`Schema:`);
      tokenMapAudit.schema.forEach((col) => console.log(`  - ${col}`));

      // Check for required columns
      const hasMarketId = tokenMapAudit.schema.some((s) =>
        s.includes("market_id")
      );
      const hasOutcome = tokenMapAudit.schema.some((s) =>
        s.includes("outcome")
      );

      if (!hasMarketId) {
        console.log(`\n⚠️  MISSING COLUMN: market_id`);
      }
      if (!hasOutcome) {
        console.log(`\n⚠️  MISSING COLUMN: outcome`);
      }
    }

    subsection("Table: gamma_markets");
    const gammaAudit = await auditTable("gamma_markets");
    console.log(`Exists: ${gammaAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${gammaAudit.row_count.toLocaleString()}`);
    if (gammaAudit.schema.length > 0) {
      console.log(`Schema:`);
      gammaAudit.schema.forEach((col) => console.log(`  - ${col}`));

      // Sample data
      if (gammaAudit.sample_data && gammaAudit.sample_data.length > 0) {
        console.log(`\nSample data (first row):`);
        const sample = gammaAudit.sample_data[0];
        Object.entries(sample)
          .slice(0, 10)
          .forEach(([key, value]) => {
            const valStr =
              typeof value === "string" && value.length > 50
                ? value.slice(0, 50) + "..."
                : String(value);
            console.log(`  ${key}: ${valStr}`);
          });
      }
    }

    subsection("Table: market_resolutions_final");
    const resolutionsAudit = await auditTable("market_resolutions_final");
    console.log(`Exists: ${resolutionsAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${resolutionsAudit.row_count.toLocaleString()}`);
    if (resolutionsAudit.schema.length > 0) {
      console.log(`Schema:`);
      resolutionsAudit.schema.forEach((col) => console.log(`  - ${col}`));
    }

    subsection("Table: pm_trades (CLOB fills)");
    const tradesAudit = await auditTable("pm_trades");
    console.log(`Exists: ${tradesAudit.exists ? "✅" : "❌"}`);
    console.log(`Rows: ${tradesAudit.row_count.toLocaleString()}`);
    if (tradesAudit.schema.length > 0) {
      console.log(`Schema:`);
      tradesAudit.schema.forEach((col) => console.log(`  - ${col}`));
    }

    // ========================================================================
    // STEP 4: GENERATE IMPLEMENTATION PLAN
    // ========================================================================
    await section("STEP 4: IMPLEMENTATION PLAN");

    console.log("Based on the audit, here is the recommended implementation order:\n");

    const plan = [];

    // Plan for pm_erc1155_flats
    if (!flatsAudit.exists || flatsAudit.row_count === 0) {
      plan.push({
        step: plan.length + 1,
        title: "Populate pm_erc1155_flats",
        description:
          "Extract and flatten TransferSingle and TransferBatch events",
        estimated_time: "10-30 minutes",
        script: "scripts/flatten-erc1155.ts",
        prerequisites: ["CT address detected"],
        commands: [
          `npx tsx scripts/flatten-erc1155.ts`,
        ],
      });
    }

    // Plan for pm_user_proxy_wallets
    if (!proxyAudit.exists || proxyAudit.row_count === 0) {
      plan.push({
        step: plan.length + 1,
        title: "Build pm_user_proxy_wallets",
        description: "Extract user-proxy mappings from ApprovalForAll events",
        estimated_time: "5-15 minutes",
        script: "scripts/build-approval-proxies.ts (needs to be created)",
        prerequisites: ["erc1155_transfers table populated"],
        commands: [
          `-- Create table if not exists`,
          `CREATE TABLE IF NOT EXISTS pm_user_proxy_wallets (
            user_eoa String,
            proxy_wallet String,
            source String DEFAULT 'approval',
            first_seen_at DateTime DEFAULT now(),
            last_seen_at DateTime DEFAULT now(),
            is_active UInt8 DEFAULT 1
          ) ENGINE = ReplacingMergeTree(last_seen_at)
          ORDER BY (user_eoa, proxy_wallet);`,
          ``,
          `-- Populate from ApprovalForAll events`,
          `INSERT INTO pm_user_proxy_wallets (user_eoa, proxy_wallet, source, first_seen_at)
          SELECT
            lower(substring(topics[2], 27)) AS user_eoa,
            lower(substring(topics[3], 27)) AS proxy_wallet,
            'approval' AS source,
            min(block_time) AS first_seen_at
          FROM erc1155_transfers
          WHERE lower(address) = '${ctAddress}'
            AND topics[1] = '${APPROVAL_FOR_ALL}'
          GROUP BY user_eoa, proxy_wallet;`,
        ],
      });
    }

    // Plan for ctf_token_map enhancements
    if (tokenMapAudit.exists) {
      const hasMarketId = tokenMapAudit.schema.some((s) =>
        s.includes("market_id")
      );
      const hasOutcome = tokenMapAudit.schema.some((s) =>
        s.includes("outcome")
      );

      if (!hasMarketId || !hasOutcome) {
        plan.push({
          step: plan.length + 1,
          title: "Enhance ctf_token_map",
          description: "Add market_id and outcome columns",
          estimated_time: "1-5 minutes",
          script: "Direct SQL",
          prerequisites: ["gamma_markets table exists"],
          commands: [
            `-- Add market_id column`,
            `ALTER TABLE ctf_token_map ADD COLUMN IF NOT EXISTS market_id String DEFAULT '';`,
            ``,
            `-- Add outcome column`,
            `ALTER TABLE ctf_token_map ADD COLUMN IF NOT EXISTS outcome String DEFAULT '';`,
            ``,
            `-- Add outcome_index column`,
            `ALTER TABLE ctf_token_map ADD COLUMN IF NOT EXISTS outcome_index UInt8 DEFAULT 0;`,
          ],
        });
      }
    }

    // Plan for market view
    if (gammaAudit.exists && resolutionsAudit.exists) {
      plan.push({
        step: plan.length + 1,
        title: "Create markets view",
        description:
          "Join gamma_markets with market_resolutions_final for complete market data",
        estimated_time: "< 1 minute",
        script: "Direct SQL",
        prerequisites: ["gamma_markets exists", "market_resolutions_final exists"],
        commands: [
          `CREATE OR REPLACE VIEW markets_enriched AS
          SELECT
            m.*,
            r.winner,
            r.resolution_source,
            r.is_resolved
          FROM gamma_markets m
          LEFT JOIN market_resolutions_final r
            ON m.market_id = r.market_id;`,
        ],
      });
    }

    // Display plan
    plan.forEach((item) => {
      console.log(`\n${"▸".repeat(60)}`);
      console.log(`STEP ${item.step}: ${item.title}`);
      console.log(`${"▸".repeat(60)}`);
      console.log(`Description: ${item.description}`);
      console.log(`Estimated time: ${item.estimated_time}`);
      console.log(`Script: ${item.script}`);
      console.log(`Prerequisites: ${item.prerequisites.join(", ")}`);
      console.log(`\nCommands:`);
      item.commands.forEach((cmd) => console.log(cmd));
    });

    // ========================================================================
    // SUMMARY
    // ========================================================================
    await section("SUMMARY");

    console.log("✅ Detected CT Address:");
    console.log(`   ${ctAddress}`);
    console.log(`\n✅ Source Data (erc1155_transfers):`);
    console.log(`   Total events: ${sourceStats.total.toLocaleString()}`);
    console.log(`   - TransferSingle: ${sourceStats.single.toLocaleString()}`);
    console.log(`   - TransferBatch: ${sourceStats.batch.toLocaleString()}`);
    console.log(`   - ApprovalForAll: ${sourceStats.approval.toLocaleString()}`);

    console.log(`\n📋 Target Tables Status:`);
    const tables = [
      { name: "pm_erc1155_flats", audit: flatsAudit },
      { name: "pm_user_proxy_wallets", audit: proxyAudit },
      { name: "ctf_token_map", audit: tokenMapAudit },
      { name: "gamma_markets", audit: gammaAudit },
      { name: "market_resolutions_final", audit: resolutionsAudit },
      { name: "pm_trades", audit: tradesAudit },
    ];

    tables.forEach(({ name, audit }) => {
      const status = audit.exists
        ? audit.row_count > 0
          ? "✅"
          : "⚠️ "
        : "❌";
      console.log(
        `   ${status} ${name}: ${audit.exists ? `${audit.row_count.toLocaleString()} rows` : "NOT FOUND"}`
      );
    });

    console.log(`\n📝 Implementation Steps: ${plan.length}`);

    console.log("\n" + "=".repeat(80));
    console.log("Audit complete! Review the implementation plan above.");
    console.log("=".repeat(80) + "\n");
  } catch (e) {
    console.error("\n❌ Audit failed:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

// Helper to center string
String.prototype.center = function (width: number, padding: string) {
  return this.padStart((width + this.length) / 2, padding).padEnd(width, padding);
};

main();
