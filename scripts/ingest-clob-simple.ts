#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import fetch from "node-fetch";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const CLOB_API = "https://data-api.polymarket.com";

interface ClaimTrade {
  id?: string;
  transactionHash?: string;
  proxyWallet?: string;
  maker?: string;
  taker?: string;
  market?: string;
  price?: string | number;
  size?: string | number;
  side?: string;
  timestamp?: number;
  conditionId?: string;
  asset?: string;
  [key: string]: any;
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        if (attempt === maxRetries) {
          console.log(`    ⚠️  ${response.status}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      return await (response as any).json();
    } catch (e) {
      if (attempt === maxRetries) {
        console.log(`    ❌ Fetch error`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// Fetch both maker= and taker= streams
async function fetchDualStreams(proxy: string, beforeSeconds?: number): Promise<ClaimTrade[]> {
  const allTrades: ClaimTrade[] = [];
  const seenIds = new Set<string>();

  // Fetch as maker
  const makerUrl = beforeSeconds
    ? `${CLOB_API}/trades?maker=${proxy}&limit=500&before=${beforeSeconds}`
    : `${CLOB_API}/trades?maker=${proxy}&limit=500`;

  const makerData = await fetchWithRetry(makerUrl);
  if (Array.isArray(makerData)) {
    makerData.forEach((t: any) => {
      allTrades.push(t);
      seenIds.add(t.id || `${t.transactionHash}-${t.timestamp}`);
    });
  }

  // Fetch as taker
  const takerUrl = beforeSeconds
    ? `${CLOB_API}/trades?taker=${proxy}&limit=500&before=${beforeSeconds}`
    : `${CLOB_API}/trades?taker=${proxy}&limit=500`;

  const takerData = await fetchWithRetry(takerUrl);
  if (Array.isArray(takerData)) {
    takerData.forEach((t: any) => {
      const tradeId = t.id || `${t.transactionHash}-${t.timestamp}`;
      if (!seenIds.has(tradeId)) {
        allTrades.push(t);
        seenIds.add(tradeId);
      }
    });
  }

  return allTrades;
}

// Filter locally to keep only trades where maker === proxy OR taker === proxy
function filterForProxy(trades: ClaimTrade[], proxy: string): ClaimTrade[] {
  return trades.filter((t) => {
    const maker = (t.maker || t.proxyWallet || "").toLowerCase();
    const taker = (t.taker || t.proxyWallet || "").toLowerCase();
    const proxyLower = proxy.toLowerCase();
    return maker === proxyLower || taker === proxyLower;
  });
}

// Generate composite key for deduplication fallback
function makeCompositeKey(t: ClaimTrade): string {
  return `${t.transactionHash || ""}-${t.conditionId || t.market || ""}-${t.price || ""}-${t.size || ""}-${t.side || ""}-${t.maker || ""}-${t.taker || ""}-${(t.timestamp || 0) * 1000}`;
}

async function ingestTrades(trades: ClaimTrade[]): Promise<number> {
  if (trades.length === 0) return 0;

  const batch: any[] = [];
  const seenKeys = new Set<string>();

  for (const trade of trades) {
    // Use id as primary, fallback to composite key
    const tradeId = trade.id || makeCompositeKey(trade);
    if (seenKeys.has(tradeId)) continue;
    seenKeys.add(tradeId);

    const row = {
      id: trade.id || "",
      transaction_hash: trade.transactionHash || "",
      proxy_wallet: (trade.proxyWallet || trade.taker || trade.maker || "").toLowerCase(),
      market_id: trade.conditionId || trade.market || trade.asset || "",
      side: (trade.side || "").toLowerCase(),
      price: String(trade.price || "0"),
      size: String(trade.size || "0"),
      ts: new Date((trade.timestamp || 0) * 1000),
      notional: String((parseFloat(String(trade.price || 0)) * parseFloat(String(trade.size || 0))).toFixed(6)),
    };

    // Skip invalid rows
    if (!row.market_id || parseFloat(row.size) <= 0) continue;

    batch.push(row);
  }

  if (batch.length === 0) return 0;

  try {
    await ch.insert({
      table: "pm_trades",
      values: batch,
      format: "JSONEachRow",
    });
    return batch.length;
  } catch (e: any) {
    console.log(`    ⚠️  Ingest error: ${e.message?.substring(0, 50)}`);
    return 0;
  }
}

async function backfillProxy(proxy: string): Promise<number> {
  console.log(`\n  Processing ${proxy.slice(0, 12)}...`);

  let totalFilled = 0;
  let beforeSeconds: number | undefined;
  let pageNum = 0;
  let consecutiveEmptyPages = 0;

  while (true) {
    pageNum++;
    if (pageNum > 100) {
      console.log(`  ⚠️  Reached 100 pages, stopping pagination`);
      break;
    }

    const trades = await fetchDualStreams(proxy, beforeSeconds);
    const filtered = filterForProxy(trades, proxy);

    if (filtered.length === 0) {
      consecutiveEmptyPages++;
      if (consecutiveEmptyPages >= 2) {
        console.log(`    ✅ No more trades (${consecutiveEmptyPages} consecutive empty pages)`);
        break;
      }
      beforeSeconds = undefined; // Reset pagination
      continue;
    }

    consecutiveEmptyPages = 0;
    const ingested = await ingestTrades(filtered);
    totalFilled += ingested;

    console.log(`    Page ${pageNum}: ${filtered.length} trades → ${ingested} inserted`);

    // Update before for next page: min timestamp - 1 second
    const minTs = Math.min(...filtered.map((t) => t.timestamp || 0));
    beforeSeconds = minTs - 1;

    // Rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  return totalFilled;
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("CLOB FILLS BACKFILL (Simplified: Dual-Stream, Local Filter)");
  console.log("Fetch both maker= and taker=");
  console.log("Filter locally: keep if maker === proxy OR taker === proxy");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    const proxies = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    ];

    console.log(`Found ${proxies.length} target proxies\n`);

    let totalIngested = 0;

    for (const proxy of proxies) {
      const filled = await backfillProxy(proxy);
      totalIngested += filled;
    }

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log(`TOTAL FILLS INGESTED: ${totalIngested}\n`);

    // Verify counts
    const q = await ch.query({
      query: `
        SELECT
          COUNT(DISTINCT id) as total_ids,
          COUNT(DISTINCT transaction_hash) as total_tx_hash,
          COUNT(*) as total_rows
        FROM pm_trades
      `,
    });

    const text = await q.text();
    const data = JSON.parse(text);
    const stats = data.data?.[0] || {};

    console.log("Database state:");
    console.log(`  Total rows: ${stats.total_rows}`);
    console.log(`  Unique IDs: ${stats.total_ids}`);
    console.log(`  Unique TXs: ${stats.total_tx_hash}\n`);

    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
