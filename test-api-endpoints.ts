#!/usr/bin/env npx tsx

/**
 * Test script to find the correct CLOB API endpoint for trades/fills
 */

const PROXY_SAMPLES = [
  "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8", // HolyMoses7
  "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0", // niggemon
];

const ENDPOINTS = [
  // Try different CLOB endpoints
  (proxy: string) => `https://clob.polymarket.com/fills?creator=${proxy}`,
  (proxy: string) => `https://clob.polymarket.com/fills?trader=${proxy}`,
  (proxy: string) => `https://clob.polymarket.com/trades?creator=${proxy}`,
  (proxy: string) => `https://clob.polymarket.com/trades?trader=${proxy}`,
  (proxy: string) => `https://clob.polymarket.com/orders?creator=${proxy}`,
  // Try data-api endpoints
  (proxy: string) => `https://data-api.polymarket.com/trades?creator=${proxy}`,
  (proxy: string) => `https://data-api.polymarket.com/trades?user=${proxy}`,
  (proxy: string) => `https://data-api.polymarket.com/fills?user=${proxy}`,
  (proxy: string) => `https://data-api.polymarket.com/user/${proxy}/trades`,
  (proxy: string) => `https://data-api.polymarket.com/user/${proxy}/fills`,
];

async function testEndpoint(url: string): Promise<{ status: number; data: any }> {
  try {
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Test/1.0",
      },
    });

    const text = await response.text();
    let data: any = null;

    // Try to parse as JSON
    try {
      data = JSON.parse(text);
    } catch {
      data = text.substring(0, 200); // First 200 chars if not JSON
    }

    return { status: response.status, data };
  } catch (e: any) {
    return { status: -1, data: e.message };
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("Testing CLOB API Endpoints");
  console.log("════════════════════════════════════════════════════════════════════\n");

  for (const proxy of PROXY_SAMPLES) {
    console.log(`\n>>> Testing proxy: ${proxy.slice(0, 12)}...\n`);

    for (let i = 0; i < ENDPOINTS.length; i++) {
      const url = ENDPOINTS[i](proxy);
      const result = await testEndpoint(url);

      const endpoint = url.split("polymarket.com")[1];
      const status = result.status;
      const dataPreview =
        typeof result.data === "string"
          ? result.data.substring(0, 50)
          : JSON.stringify(result.data).substring(0, 50);

      // Highlight successful responses (200, 201) and data-containing responses
      const symbol =
        status === 200 || status === 201
          ? "✅"
          : status === 404
            ? "❌"
            : status === 403
              ? "🔒"
              : "⚠️ ";

      console.log(`  ${symbol} [${status}] ${endpoint}`);

      // Show first success with data
      if ((status === 200 || status === 201) && typeof result.data === "object" && result.data) {
        if (Array.isArray(result.data)) {
          console.log(`         → Array with ${result.data.length} items`);
          if (result.data.length > 0) {
            console.log(`         → First item keys: ${Object.keys(result.data[0]).join(", ")}`);
          }
        } else {
          console.log(
            `         → Object with keys: ${Object.keys(result.data).slice(0, 5).join(", ")}`
          );
        }
      }
    }

    // Small delay between proxies to avoid rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n════════════════════════════════════════════════════════════════════\n");
}

main();
