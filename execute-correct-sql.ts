#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";
import * as fs from "fs";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 600000,
});

async function executeSqlFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");
  const statements = content
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("EXECUTING CORRECT SQL FROM realized-pnl-corrected.sql");
  console.log("════════════════════════════════════════════════════════════════\n");

  for (const statement of statements) {
    const name = statement.split("\n")[0].substring(0, 50);
    try {
      console.log(`🔄 ${name}...`);
      await ch.query({ query: statement });
      console.log(`✅ ${name}`);
    } catch (e: any) {
      console.error(`❌ ${name}: ${e.message}`);
    }
  }

  // Now test the results
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TESTING RESULTS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const niggemon = "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0";
  const holymoses = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          CASE
            WHEN lower(wallet) = lower('${niggemon}') THEN 'niggemon ($102,001 expected)'
            WHEN lower(wallet) = lower('${holymoses}') THEN 'HolyMoses7 ($89,975 expected)'
            ELSE wallet
          END as target_info
        FROM wallet_realized_pnl_v2
        WHERE lower(wallet) IN (lower('${niggemon}'), lower('${holymoses}'))
        ORDER BY wallet
      `,
      format: "JSONCompact",
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);
      const info = row[2];

      console.log(`${info}`);
      console.log(`  Calculated P&L: $${pnl.toFixed(2)}\n`);

      if (wallet.includes("eb6f")) {
        const variance = ((pnl - 102001) / 102001) * 100;
        console.log(`  Variance from expected $102,001: ${variance.toFixed(2)}%`);
        console.log(
          variance >= -5 && variance <= 5
            ? "  ✅ WITHIN ACCEPTABLE RANGE (±5%)\n"
            : "  ❌ OUT OF RANGE\n"
        );
      } else if (wallet.includes("a4b3")) {
        const variance = ((pnl - 89975) / 89975) * 100;
        console.log(`  Variance from expected $89,975: ${variance.toFixed(2)}%`);
        console.log(
          variance >= -5 && variance <= 5
            ? "  ✅ WITHIN ACCEPTABLE RANGE (±5%)\n"
            : "  ❌ OUT OF RANGE\n"
        );
      }
    }
  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

executeSqlFile("/Users/scotty/Projects/Cascadian-app/scripts/realized-pnl-corrected.sql").catch(
  console.error
);
