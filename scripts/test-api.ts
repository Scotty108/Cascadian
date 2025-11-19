import "dotenv/config";
import fetch from "node-fetch";

async function test() {
  const proxies = [
    "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
    "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0"
  ];

  const baseUrl = "https://data-api.polymarket.com";

  console.log("Testing Polymarket API endpoints...\n");

  const endpoints = [
    `/trades?taker=${proxies[0]}&limit=1`,
    `/data/trades?taker=${proxies[0]}&limit=1`,
    `/user/${proxies[0]}/trades?limit=1`,
    `/trades/user/${proxies[0]}?limit=1`,
  ];

  for (const endpoint of endpoints) {
    try {
      const url = baseUrl + endpoint;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      console.log(`${endpoint}`);
      console.log(`  Status: ${response.status} ${response.statusText}`);

      if (response.status === 200) {
        const data = await (response as any).json();
        const isArray = Array.isArray(data);
        console.log(`  Response type: ${isArray ? "array" : typeof data}`);
        if (isArray && data.length > 0) {
          console.log(`  First item keys: ${Object.keys(data[0]).join(", ")}`);
        } else if (data && typeof data === "object") {
          console.log(`  Top-level keys: ${Object.keys(data).join(", ")}`);
        }
      }
    } catch (e) {
      console.log(`${endpoint}`);
      console.log(`  Error: ${e}`);
    }
    console.log();
  }
}

test();
