#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

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

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("THREE SAFE READ-ONLY VALIDATION PROBES");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // PROBE A: Do we have ERC-1155 volume at detected CT address?
    console.log("PROBE A: ERC-1155 Activity at Detected CT Address\n");
    console.log(`Checking address: ${CONDITIONAL_TOKENS}\n`);

    const probeAQ = await ch.query({
      query: `
        SELECT toStartOfDay(block_time) AS d, sum(amount) AS units
        FROM pm_erc1155_flats
        WHERE address = {ct_addr:String}
        GROUP BY d
        ORDER BY d DESC
        LIMIT 30
        FORMAT JSONEachRow
      `,
      query_params: { ct_addr: CONDITIONAL_TOKENS },
    });

    const probeAText = await probeAQ.text();
    const probeALines = probeAText
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    if (probeALines.length === 0) {
      console.log("⚠️  NO DATA FOUND in pm_erc1155_flats");
      console.log("   Action: Run flatten-erc1155.ts to populate\n");
    } else {
      console.log(`✅ Found ${probeALines.length} days of ERC-1155 activity:\n`);
      for (let i = 0; i < Math.min(10, probeALines.length); i++) {
        const row = JSON.parse(probeALines[i]);
        const units = parseFloat(row.units) || 0;
        console.log(`   ${row.d}: ${units.toLocaleString()} units`);
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

    // PROBE B: Do proxies exist for the three EOAs?
    console.log("PROBE B: EOA→Proxy Mapping for Known Wallets\n");

    const testEOAs = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
      "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
    ];

    for (const eoa of testEOAs) {
      const probeBQ = await ch.query({
        query: `
          SELECT user_eoa, proxy_wallet, first_seen_at, is_active
          FROM pm_user_proxy_wallets
          WHERE lower(user_eoa) = lower({eoa:String})
          LIMIT 10
          FORMAT JSONEachRow
        `,
        query_params: { eoa },
      });

      const probeBText = await probeBQ.text();
      const probeBLines = probeBText
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);

      if (probeBLines.length === 0) {
        console.log(`❌ ${eoa.slice(0, 14)}... - NO PROXIES FOUND`);
      } else {
        console.log(
          `✅ ${eoa.slice(0, 14)}... - ${probeBLines.length} proxies:`
        );
        for (let i = 0; i < probeBLines.length; i++) {
          const row = JSON.parse(probeBLines[i]);
          const status = row.is_active === 1 ? "✓" : "✗";
          console.log(
            `   ${status} ${row.proxy_wallet.slice(0, 14)}... (${row.first_seen_at})`
          );
        }
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

    // PROBE C: Do we see fills for those proxies?
    console.log("PROBE C: CLOB Fills for Known Wallet Proxies\n");

    const probeCQ = await ch.query({
      query: `
        SELECT
          proxy_wallet,
          COUNT(*) AS fills,
          COUNT(DISTINCT market_id) AS markets,
          sum(size) AS size_sum,
          sum(price * size) AS notional
        FROM pm_trades
        WHERE proxy_wallet IN (
          SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets
          WHERE lower(user_eoa) = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
        )
        GROUP BY proxy_wallet
        ORDER BY fills DESC
        LIMIT 10
        FORMAT JSONEachRow
      `,
    });

    const probeCText = await probeCQ.text();
    const probeCLines = probeCText
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);

    if (probeCLines.length === 0) {
      console.log("❌ NO FILLS FOUND for niggemon proxies");
      console.log("   Action: Run ingest-clob-fills-lossless.ts to populate\n");
    } else {
      console.log(`✅ Found fills for niggemon's proxies:\n`);
      for (let i = 0; i < probeCLines.length; i++) {
        const row = JSON.parse(probeCLines[i]);
        const notional = parseFloat(row.notional) || 0;
        console.log(
          `   ${row.proxy_wallet.slice(0, 14)}... | Fills: ${row.fills.toLocaleString()} | Markets: ${row.markets} | Notional: ${notional.toLocaleString()}`
        );
      }
    }

    console.log("\n" + "═".repeat(70) + "\n");

    // Summary verdict
    console.log("VERDICT\n");

    const hasERC1155 = probeALines.length > 0;
    const hasProxies = await checkProxiesExist();
    const hasFills = probeCLines.length > 0;

    console.log(`[${hasERC1155 ? "✅" : "❌"}] ERC-1155 data populated`);
    console.log(`[${hasProxies ? "✅" : "❌"}] Proxy mapping complete`);
    console.log(`[${hasFills ? "✅" : "❌"}] CLOB fills ingested`);

    if (hasERC1155 && hasProxies && hasFills) {
      console.log("\n✅ ALL PROBES PASSED - System is ready for full validation");
    } else if (hasERC1155 && hasProxies) {
      console.log("\n⏳ PARTIAL - Need to run CLOB fills ingestion");
    } else if (hasERC1155) {
      console.log("\n⏳ EARLY STAGE - Build proxy mapping first");
    } else {
      console.log("\n❌ START HERE - Run flatten-erc1155.ts to populate ERC-1155 data");
    }

    console.log("\n" + "═".repeat(70) + "\n");

    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

async function checkProxiesExist(): Promise<boolean> {
  try {
    const q = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_user_proxy_wallets LIMIT 1 FORMAT JSONEachRow`,
    });
    const text = await q.text();
    if (text.trim().length === 0) return false;
    const row = JSON.parse(text.trim());
    return row.cnt > 0;
  } catch {
    return false;
  }
}

main();
