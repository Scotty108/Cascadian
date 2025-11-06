#!/usr/bin/env npx tsx

/**
 * Fetch CLOB trades directly from the API without using the proxy mapping
 * The issue: we need to understand what the API actually returns for different query parameters
 */

import "dotenv/config";

const knownWallets = [
  { name: "HolyMoses7", addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8" },
  { name: "niggemon", addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0" },
];

async function fetchTrades(walletAddr: string, paramName: string): Promise<any[]> {
  const url = `https://data-api.polymarket.com/trades?${paramName}=${walletAddr}`;

  try {
    const response = await fetch(url, {
      headers: { "Accept": "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    const trades = await response.json();
    return Array.isArray(trades) ? trades : [];
  } catch (e) {
    return [];
  }
}

async function main() {
  console.log("Testing different API parameters for known wallets...\n");

  for (const wallet of knownWallets) {
    console.log(`\n=== ${wallet.name} (${wallet.addr}) ===\n`);

    // Try different parameter names
    const params = ["creator", "user", "proxyWallet", "wallet", "address"];

    for (const param of params) {
      const trades = await fetchTrades(wallet.addr, param);

      if (trades.length > 0) {
        console.log(`✅ ${param}: ${trades.length} trades`);

        if (trades.length > 0) {
          const sample = trades[0];
          console.log(`   Sample: proxyWallet=${sample.proxyWallet?.slice(0, 12)}... | side=${sample.side} | size=${sample.size} | price=${sample.price}`);

          // Check if proxyWallet matches our wallet
          if (sample.proxyWallet?.toLowerCase() === wallet.addr.toLowerCase()) {
            console.log(`   ✅ proxyWallet MATCHES our wallet!`);
          } else if (sample.proxyWallet) {
            console.log(`   ⚠️  proxyWallet is DIFFERENT: ${sample.proxyWallet.slice(0, 12)}...`);
          }
        }
      } else {
        console.log(`❌ ${param}: no trades`);
      }
    }
  }
}

main();
