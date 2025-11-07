#!/usr/bin/env npx tsx
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("PHASE 2 STEP 6: VALIDATE AGAINST 4 TARGET WALLETS");
  console.log("════════════════════════════════════════════════════════════════\n");

  const wallets = {
    niggemon: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    // HolyMoses7 address (same as earlier)
    HolyMoses7: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8"
  };

  const expectedValues: Record<string, { min: number; max: number }> = {
    niggemon: { min: 99000, max: 103000 },
    HolyMoses7: { min: 86000, max: 94000 }
  };

  try {
    const result = await ch.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          CASE
            WHEN lower(wallet) = lower('${wallets.niggemon}') THEN 'niggemon'
            WHEN lower(wallet) = lower('${wallets.HolyMoses7}') THEN 'HolyMoses7'
            ELSE 'OTHER'
          END as name
        FROM wallet_realized_pnl_v3
        WHERE lower(wallet) IN (
          lower('${wallets.niggemon}'),
          lower('${wallets.HolyMoses7}')
        )
        ORDER BY wallet
      `,
      format: "JSONCompact"
    });

    const text = await result.text();
    const data = JSON.parse(text).data || [];

    console.log("Results:");
    console.log("─".repeat(70));
    
    let allPassed = true;
    for (const row of data) {
      const wallet = row[0];
      const pnl = parseFloat(row[1]);
      const name = row[2];

      const expected = expectedValues[name];
      const inRange = pnl >= expected.min && pnl <= expected.max;

      console.log(`\n${name}:`);
      console.log(`  Address:     ${wallet}`);
      console.log(`  Realized:    $${pnl.toFixed(2)}`);
      console.log(`  Expected:    $${expected.min.toFixed(0)} - $${expected.max.toFixed(0)}`);
      console.log(`  Status:      ${inRange ? "✅ PASS" : "❌ FAIL"}`);

      if (!inRange) allPassed = false;
    }

    console.log("\n" + "═".repeat(70));
    if (allPassed && data.length > 0) {
      console.log("✅ ALL WALLETS WITHIN ACCEPTABLE RANGE");
      console.log("Ready to proceed to Step 8 (Finalize artifacts)");
    } else if (data.length === 0) {
      console.log("⚠️  NO DATA FOUND FOR TARGET WALLETS");
    } else {
      console.log("❌ SOME WALLETS OUT OF RANGE");
      console.log("Proceeding to Step 7 (Troubleshooting)");
    }
    console.log("═".repeat(70) + "\n");

  } catch (e: any) {
    console.error(`Error: ${e.message}\n`);
  }
}

main().catch(console.error);
