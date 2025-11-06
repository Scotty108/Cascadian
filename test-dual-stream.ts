import "dotenv/config";
import fetch from "node-fetch";

async function test() {
  const proxy = "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8";
  const CLOB_API = "https://data-api.polymarket.com";

  console.log("\n=== Testing Dual-Stream CLOB API ===\n");
  console.log(`Testing proxy: ${proxy}\n`);

  // Test maker= endpoint
  const makerUrl = `${CLOB_API}/trades?maker=${proxy}&limit=5`;
  console.log(`Fetching: ${makerUrl}`);

  try {
    const resp1 = await fetch(makerUrl);
    const data1 = await (resp1 as any).json();
    console.log(`Status: ${resp1.status}`);
    console.log(`Result type: ${Array.isArray(data1) ? "array" : typeof data1}`);
    if (Array.isArray(data1)) {
      console.log(`Array length: ${data1.length}`);
      if (data1.length > 0) {
        console.log(`First item keys: ${Object.keys(data1[0]).join(", ")}`);
      }
    }
  } catch (e) {
    console.log(`Error: ${e}`);
  }

  console.log("\n---\n");

  // Test taker= endpoint
  const takerUrl = `${CLOB_API}/trades?taker=${proxy}&limit=5`;
  console.log(`Fetching: ${takerUrl}`);

  try {
    const resp2 = await fetch(takerUrl);
    const data2 = await (resp2 as any).json();
    console.log(`Status: ${resp2.status}`);
    console.log(`Result type: ${Array.isArray(data2) ? "array" : typeof data2}`);
    if (Array.isArray(data2)) {
      console.log(`Array length: ${data2.length}`);
      if (data2.length > 0) {
        console.log(`First item keys: ${Object.keys(data2[0]).join(", ")}`);
      }
    }
  } catch (e) {
    console.log(`Error: ${e}`);
  }

  console.log("\n");
}

test();
