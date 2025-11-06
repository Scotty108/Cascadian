#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import { resolveProxyViaAPI, pad32Hex } from "../lib/polymarket/resolver";

const KNOWN_WALLETS = [
  { eoa: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", name: "HolyMoses7", expectedPredictions: 2182 },
  {
    eoa: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    name: "niggemon",
    expectedPredictions: 1087,
  },
  { eoa: "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b", name: "Wallet3", expectedPredictions: 0 },
];

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 180000,
});

async function countTradesForProxy(proxy: string): Promise<{
  trades: number;
  buy_trades: number;
  sell_trades: number;
}> {
  try {
    const q = await ch.query({
      query: `
        SELECT
          COUNT(*) AS total_trades,
          countIf(side = 'buy') AS buy_trades,
          countIf(side = 'sell') AS sell_trades
        FROM pm_trades
        WHERE proxy_wallet = {proxy:String}
        FORMAT JSONEachRow
      `,
      query_params: { proxy: proxy.toLowerCase() },
    });
    const text = await q.text();
    const row = JSON.parse(text.trim());
    return {
      trades: Number(row.total_trades || 0),
      buy_trades: Number(row.buy_trades || 0),
      sell_trades: Number(row.sell_trades || 0),
    };
  } catch (e) {
    return { trades: 0, buy_trades: 0, sell_trades: 0 };
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("   VALIDATING AGAINST KNOWN POLYMARKET WALLETS");
  console.log("════════════════════════════════════════════════════════════════════\n");

  for (const k of KNOWN_WALLETS) {
    console.log(`📋 ${k.name} (${k.eoa})`);
    console.log(`   Expected Predictions: ${k.expectedPredictions}`);

    const proxy = await resolveProxyViaAPI(k.eoa);

    if (!proxy) {
      console.log(`   ❌ No proxy found via API\n`);
      continue;
    }

    console.log(`   ✅ Proxy: ${proxy.proxy_wallet}`);

    // Count trades from CLOB API
    const trades = await countTradesForProxy(proxy.proxy_wallet);
    console.log(`   Total Trades (CLOB): ${trades.trades}`);
    console.log(`   Buy Trades: ${trades.buy_trades}`);
    console.log(`   Sell Trades: ${trades.sell_trades}`);
    console.log(`   Expected Predictions: ${k.expectedPredictions}`);

    // Calculate accuracy
    const accuracy =
      k.expectedPredictions > 0
        ? ((trades.trades / k.expectedPredictions) * 100).toFixed(1)
        : "N/A";
    console.log(`   ✅ Accuracy: ${accuracy}% of expected`);

    // Get USDC flows for deposits/withdrawals only
    try {
      const flowQ = await ch.query({
        query: `
          SELECT
            sumIf(value, lower(to_address) = {proxy:String}) AS usdc_in,
            sumIf(value, lower(from_address) = {proxy:String}) AS usdc_out
          FROM erc20_transfers
          WHERE lower(contract) = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
            AND (lower(to_address) = {proxy:String} OR lower(from_address) = {proxy:String})
          FORMAT JSONEachRow
        `,
        query_params: { proxy: proxy.proxy_wallet.toLowerCase() },
      });

      const flowText = await flowQ.text();
      const flowRow = JSON.parse(flowText.trim());
      const usdcIn = BigInt(flowRow.usdc_in || 0);
      const usdcOut = BigInt(flowRow.usdc_out || 0);
      const net = usdcIn - usdcOut;

      console.log(`   USDC Deposits:  ${(usdcIn / 1000000n).toString()}`);
      console.log(`   USDC Withdrawals: ${(usdcOut / 1000000n).toString()}`);
      console.log(`   Net Funding: ${(net / 1000000n).toString()}`);
    } catch (e) {
      console.log(`   ⚠️  Could not fetch USDC flows`);
    }

    console.log(`   🔗 https://polymarket.com/profile/${k.eoa}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════\n");
  console.log("📊 Summary:");
  console.log("  - If trade counts from CLOB API are close to expected predictions, logic is correct");
  console.log("  - Accuracy % shows how complete our CLOB data is vs Polymarket profile");
  console.log("  - USDC deposits/withdrawals track funding only, not trading volume");
  console.log("  - If accuracy is low, may need to fetch more historical fills from CLOB API\n");

  await ch.close();
}

main().catch(async (e) => {
  console.error("Error:", e);
  await ch.close();
  process.exit(1);
});
