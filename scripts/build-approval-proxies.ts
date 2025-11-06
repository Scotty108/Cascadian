#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

// Polymarket ConditionalTokens on Polygon
const CONDITIONAL_TOKENS =
  process.env.CONDITIONAL_TOKENS ||
  "0x4d97dcd97ec945f40cf65f87097ace5ea0476045";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

async function main() {
  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`Building EOA → Proxy Wallet mapping from ERC1155 transfers`);
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
          first_seen_at  DateTime DEFAULT now(),
          last_seen_at   DateTime DEFAULT now(),
          is_active      UInt8 DEFAULT 1
        )
        ENGINE = ReplacingMergeTree()
        PRIMARY KEY (proxy_wallet)
        ORDER BY (proxy_wallet)
      `,
    });
    console.log("✅ pm_user_proxy_wallets table ready\n");

    // Build proxy mappings from pm_erc1155_flats
    // Extract unique proxy wallets (contract column) per user
    console.log("Building proxy mappings from pm_erc1155_flats...");
    const mappingQ = await ch.query({
      query: `
        SELECT
          from_address as user_wallet,
          address as proxy_wallet,
          min(block_time) as first_seen_at,
          max(block_time) as last_seen_at
        FROM pm_erc1155_flats
        WHERE from_address != '' AND from_address != '0x0000000000000000000000000000000000000000'
        GROUP BY from_address, address
      `,
      format: 'JSONEachRow',
    });

    const mappingText = await mappingQ.text();
    const mappingLines = mappingText
      .trim()
      .split("\n")
      .filter((l) => l.trim());

    const batch: any[] = [];

    console.log(`Found ${mappingLines.length} from_addr→contract relationships\n`);

    for (const line of mappingLines) {
      const row = JSON.parse(line);

      batch.push({
        user_eoa: row.user_wallet.toLowerCase(),
        proxy_wallet: row.proxy_wallet.toLowerCase(),
        source: "erc1155_transfers",
        first_seen_at: row.first_seen_at,
        last_seen_at: row.last_seen_at,
        is_active: 1,
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

    if (batch.length > 0) {
      await ch.insert({
        table: "pm_user_proxy_wallets",
        values: batch,
        format: "JSONEachRow",
      });
    }

    // Show statistics
    const statsQ = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_pairs,
          COUNT(DISTINCT user_eoa) AS unique_eoas,
          COUNT(DISTINCT proxy_wallet) AS unique_proxies
        FROM pm_user_proxy_wallets
      `,
      format: 'JSONEachRow',
    });

    const statsText = await statsQ.text();
    const stats = JSON.parse(statsText.trim());

    console.log(`════════════════════════════════════════════════════════════════════`);
    console.log(`Summary:`);
    console.log(`  Total EOA→Proxy pairs: ${stats.total_pairs}`);
    console.log(`  Unique EOAs: ${stats.unique_eoas}`);
    console.log(`  Unique Proxies: ${stats.unique_proxies}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);

    // Show known wallets
    const knownWallets = [
      '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
      '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
      '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    ];

    console.log(`Proxies for known wallets:\n`);
    for (const eoa of knownWallets) {
      const proxyQ = await ch.query({
        query: `
          SELECT
            proxy_wallet,
            first_seen_at,
            last_seen_at
          FROM pm_user_proxy_wallets
          WHERE lower(user_eoa) = lower({eoa:String})
          ORDER BY first_seen_at
          LIMIT 20
        `,
        query_params: { eoa },
        format: 'JSONEachRow',
      });

      const proxyText = await proxyQ.text();
      const proxyLines = proxyText.trim().split("\n").filter(l => l.trim());

      if (proxyLines.length === 0) {
        console.log(`  ${eoa.slice(0, 14)}... : NO PROXIES FOUND`);
      } else {
        console.log(`  ${eoa.slice(0, 14)}... : ${proxyLines.length} proxies`);
        proxyLines.slice(0, 3).forEach((line: string) => {
          const row = JSON.parse(line);
          console.log(`    - ${row.proxy_wallet.slice(0, 14)}...`);
        });
        if (proxyLines.length > 3) {
          console.log(`    ... and ${proxyLines.length - 3} more`);
        }
      }
    }

    console.log(`\n════════════════════════════════════════════════════════════════════\n`);

    process.exit(0);
  } catch (error) {
    console.error("❌ ERROR in Phase 1:", error);
    process.exit(1);
  }
}

main();
