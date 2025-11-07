#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message?.substring(0, 200)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

const expected = {
  [wallet1]: 89975.16,
  [wallet2]: 102001.46
};

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("P&L CALCULATION FROM PM_TRADES (RAW CLOB FILLS)");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Find proxy wallets for target EOAs
  console.log("🔍 STEP 1: Finding Proxy Wallets\n");

  let proxyWallets: { [key: string]: string[] } = {
    [wallet1]: [],
    [wallet2]: []
  };

  try {
    for (const eoa of [wallet1, wallet2]) {
      const proxies = await queryData(`
        SELECT DISTINCT lower(proxy_wallet) as proxy_wallet
        FROM pm_user_proxy_wallets
        WHERE lower(user_eoa) = lower('${eoa}')
      `);

      if (proxies.length > 0) {
        proxyWallets[eoa] = proxies.map((p: any) => p.proxy_wallet);
        console.log(`  ${eoa.substring(0, 12)}...`);
        console.log(`    Proxy wallets: ${proxyWallets[eoa].join(', ')}`);
      } else {
        console.log(`  ${eoa.substring(0, 12)}... - NO PROXIES FOUND`);
      }
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  console.log();

  // Step 2: Get trade counts from pm_trades for proxy wallets
  console.log("📊 STEP 2: Trade Counts in pm_trades\n");

  for (const eoa of [wallet1, wallet2]) {
    const proxies = proxyWallets[eoa];
    if (proxies.length === 0) continue;

    const proxyList = proxies.map(p => `'${p}'`).join(',');

    try {
      const trades = await queryData(`
        SELECT
          count() as total_trades,
          countDistinct(market_id) as unique_markets,
          count(DISTINCT taker_address = lower('${eoa}')) as as_taker,
          count(DISTINCT maker_address = lower('${eoa}')) as as_maker
        FROM pm_trades
        WHERE taker_address IN (${proxyList}) OR maker_address IN (${proxyList})
      `);

      if (trades.length > 0) {
        const t = trades[0];
        console.log(`  ${eoa.substring(0, 12)}...`);
        console.log(`    Total trades: ${t.total_trades}`);
        console.log(`    Unique markets: ${t.unique_markets}\n`);
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
    }
  }

  // Step 3: Calculate P&L from pm_trades
  console.log("💰 STEP 3: P&L Calculation from pm_trades\n");

  for (const eoa of [wallet1, wallet2]) {
    const proxies = proxyWallets[eoa];
    if (proxies.length === 0) continue;

    const proxyList = proxies.map(p => `'${p}'`).join(',');
    const expected_val = expected[eoa];

    try {
      // Build the P&L calculation using CLOB fills
      const pnl = await queryData(`
        WITH fills AS (
          SELECT
            market_id,
            CASE
              WHEN taker_address IN (${proxyList}) THEN
                CASE
                  WHEN side = 'BUY' THEN -price * size
                  WHEN side = 'SELL' THEN price * size
                  ELSE 0
                END
              WHEN maker_address IN (${proxyList}) THEN
                CASE
                  WHEN side = 'BUY' THEN price * size
                  WHEN side = 'SELL' THEN -price * size
                  ELSE 0
                END
              ELSE 0
            END as cashflow_usd,
            price,
            size,
            side,
            created_at
          FROM pm_trades
          WHERE taker_address IN (${proxyList}) OR maker_address IN (${proxyList})
        )
        SELECT
          round(sum(cashflow_usd), 2) as total_cashflow
        FROM fills
      `);

      if (pnl.length > 0) {
        const cashflow = parseFloat(pnl[0].total_cashflow || 0);
        const variance = ((cashflow - expected_val) / expected_val * 100).toFixed(2);

        console.log(`  ${eoa.substring(0, 12)}...`);
        console.log(`    Net cashflow: $${cashflow.toFixed(2)}`);
        console.log(`    Expected: $${expected_val.toFixed(2)}`);
        console.log(`    Variance: ${variance}%`);
        console.log(`    Status: ${Math.abs(parseFloat(variance)) <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
    }
  }

  // Step 4: Alternative - Check if EOA addresses appear in pm_trades directly
  console.log("🔎 STEP 4: Direct EOA Lookup (if no proxy mapping found)\n");

  for (const eoa of [wallet1, wallet2]) {
    try {
      const trades = await queryData(`
        SELECT
          count() as total_trades,
          countDistinct(market_id) as unique_markets
        FROM pm_trades
        WHERE lower(taker_address) = lower('${eoa}') OR lower(maker_address) = lower('${eoa}')
      `);

      if (trades.length > 0 && trades[0].total_trades > 0) {
        console.log(`  ${eoa.substring(0, 12)}... appears directly in pm_trades`);
        console.log(`    Total trades: ${trades[0].total_trades}`);
        console.log(`    Unique markets: ${trades[0].unique_markets}\n`);
      }
    } catch (e: any) {
      // Ignore
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
