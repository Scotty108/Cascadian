#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

interface KnownWallet {
  name: string;
  eoa: string;
  expectedTrades: number;
}

const KNOWN_WALLETS: KnownWallet[] = [
  {
    name: "HolyMoses7",
    eoa: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
    expectedTrades: 2182,
  },
  {
    name: "niggemon",
    eoa: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    expectedTrades: 1087,
  },
];

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 4: KNOWN WALLET VALIDATION");
  console.log("Validates: Trade counts match expected profiles");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    console.log("Wallet                  | Trades Found | Expected | % Capture | Status\n");

    let allPass = true;

    for (const wallet of KNOWN_WALLETS) {
      // Get proxies for this wallet
      const proxyQuery = await ch.query({
        query: `
          SELECT DISTINCT proxy_wallet
          FROM pm_user_proxy_wallets
          WHERE lower(user_eoa) = lower('${wallet.eoa}')
        `,
      });

      const proxyText = await proxyQuery.text();
      const proxyData = JSON.parse(proxyText);
      const proxies = (proxyData.data || []).map((row: any) => row.proxy_wallet);

      if (proxies.length === 0) {
        console.log(`${wallet.name.padEnd(23)} | 0            | ${String(wallet.expectedTrades).padStart(8)} | 0%        | ❌ FAIL`);
        allPass = false;
        continue;
      }

      // Get trade count for these proxies
      const proxySql = proxies.map((p: string) => `'${p}'`).join(",");
      const tradeQuery = await ch.query({
        query: `
          SELECT COUNT(*) as cnt
          FROM pm_trades
          WHERE proxy_wallet IN (${proxySql})
        `,
      });

      const tradeText = await tradeQuery.text();
      const tradeData = JSON.parse(tradeText);
      const tradeCount = tradeData.data?.[0]?.cnt || 0;

      const percentage = wallet.expectedTrades > 0 ? ((tradeCount / wallet.expectedTrades) * 100).toFixed(1) : "0";
      const passed = tradeCount >= wallet.expectedTrades * 0.95; // 95% threshold for now
      const status = passed ? "✅ PASS" : "⚠️  LOW";

      console.log(
        `${wallet.name.padEnd(23)} | ${String(tradeCount).padStart(12)} | ${String(wallet.expectedTrades).padStart(8)} | ${String(percentage).padStart(8)}% | ${status}`
      );

      if (!passed) {
        allPass = false;
        console.log(`   → Proxies: ${proxies.map((p: string) => p.slice(0, 12)).join(", ")}`);
      }
    }

    console.log("\n════════════════════════════════════════════════════════════════════");

    if (allPass) {
      console.log("✅ VALIDATION PASSED: Trade capture >= 95% for known wallets\n");
      process.exit(0);
    } else {
      console.log("⚠️  VALIDATION WARNING: Some wallets below 95% capture threshold\n");
      console.log("   Note: This is expected if CLOB API returns limited data (100 per proxy)");
      console.log("   Full backfill would be needed to reach 100% accuracy\n");
      process.exit(1);
    }
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }finally {
    await ch.close();
  }
}

main();
