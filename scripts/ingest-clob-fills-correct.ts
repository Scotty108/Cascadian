#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { filterDuplicateTrades } from "@/lib/ingestion-guardrail";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const CLOB_API = "https://data-api.polymarket.com";
const CHECKPOINT_DIR = ".clob_checkpoints_v2";

interface ClaimTrade {
  id?: string;
  transaction_hash?: string;
  maker?: string;
  taker?: string;
  market?: string;
  price?: string | number;
  size?: string | number;
  side?: string;
  timestamp?: number; // seconds
  proxyWallet?: string;
  conditionId?: string;
  asset?: string;
  [key: string]: any;
}

interface CompositeKey {
  transaction_hash: string;
  market: string;
  price: string;
  size: string;
  side: string;
  maker: string;
  taker: string;
  ts_ms: number;
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
async function fetchDualStreams(
  proxy: string,
  beforeMs: number
): Promise<ClaimTrade[]> {
  const allTrades: ClaimTrade[] = [];
  const seenIds = new Set<string>();

  // Convert milliseconds to seconds for API
  const beforeSeconds = Math.floor(beforeMs / 1000);

  // Fetch as maker
  const makerUrl = `${CLOB_API}/trades?maker=${proxy}&limit=500${beforeMs < Date.now() ? `&before=${beforeSeconds}` : ""}`;
  const makerData = await fetchWithRetry(makerUrl);
  if (Array.isArray(makerData)) {
    makerData.forEach((t: any) => {
      allTrades.push(t);
      seenIds.add(t.id || `${t.transactionHash}-${t.timestamp}`);
    });
  }

  // Fetch as taker
  const takerUrl = `${CLOB_API}/trades?taker=${proxy}&limit=500${beforeMs < Date.now() ? `&before=${beforeSeconds}` : ""}`;
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
      maker: (trade.maker || "").toLowerCase(),
      taker: (trade.taker || "").toLowerCase(),
      market_id: trade.conditionId || trade.market || trade.asset || "",
      side: (trade.side || "").toLowerCase(),
      price: String(trade.price || "0"),
      size: String(trade.size || "0"),
      ts: new Date((trade.timestamp || 0) * 1000),
      ts_ms: (trade.timestamp || 0) * 1000,
      notional: String((parseFloat(String(trade.price || 0)) * parseFloat(String(trade.size || 0))).toFixed(6)),
    };

    // Skip invalid rows
    if (!row.market_id || parseFloat(row.size) <= 0) continue;

    batch.push(row);
  }

  if (batch.length === 0) return 0;

  // Filter out duplicate trades using guardrail
  const cleanTrades = await filterDuplicateTrades(batch, ch, "pm_trades");
  const filtered = batch.length - cleanTrades.length;
  if (filtered > 0) {
    console.log(`    🛡️  Guardrail: Filtered ${filtered} duplicate trades`);
  }

  if (cleanTrades.length === 0) return 0;

  try {
    await ch.insert({
      table: "pm_trades",
      values: cleanTrades,
      format: "JSONEachRow",
    });
    return cleanTrades.length;
  } catch (e: any) {
    console.log(`    ⚠️  Ingest error: ${e.message?.substring(0, 50)}`);
    return 0;
  }
}

async function backfillProxyByDayWindows(proxy: string): Promise<number> {
  const startDate = new Date("2024-01-01");
  const endDate = new Date();
  let totalFilled = 0;

  console.log(`\n  Processing ${proxy.slice(0, 12)}... day windows\n`);

  const currentDate = new Date(endDate);
  while (currentDate >= startDate) {
    const dayStart = new Date(currentDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(currentDate);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const dayLabel = dayStart.toISOString().split("T")[0];
    let before = Math.floor(dayEnd.getTime());
    let pageNum = 0;
    let dayPagesFilled = 0;
    const daySeenIds = new Set<string>();

    while (before >= Math.floor(dayStart.getTime())) {
      pageNum++;
      const trades = await fetchDualStreams(proxy, before);
      const filtered = filterForProxy(trades, proxy);

      if (filtered.length === 0) {
        break;
      }

      // Track unique IDs on this page
      const pageUniqueIds = new Set(filtered.map((t) => t.id || makeCompositeKey(t)));
      const duplicateCount = filtered.length - pageUniqueIds.size;
      const dupRate = (duplicateCount / filtered.length) * 100;

      const ingested = await ingestTrades(filtered);
      dayPagesFilled += ingested;
      totalFilled += ingested;

      console.log(
        `    ${dayLabel} page ${pageNum}: ${filtered.length} trades, ${pageUniqueIds.size} unique, ${dupRate.toFixed(0)}% dups → ${ingested} inserted`
      );

      // Update before for next page
      const minTs = Math.min(...filtered.map((t) => (t.timestamp || 0) * 1000));
      const newBefore = minTs - 1;

      // Loop protection: if 95%+ duplicates, back off 1000ms and retry once
      if (dupRate >= 95) {
        console.log(`    ⚠️  High dup rate, backing off 1000ms`);
        before = minTs - 1000;
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      // Stop if we didn't advance
      if (newBefore >= before) {
        break;
      }

      before = newBefore;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (dayPagesFilled > 0) {
      console.log(`    ✅ ${dayLabel}: ${dayPagesFilled} fills\n`);
    }

    currentDate.setUTCDate(currentDate.getUTCDate() - 1);
  }

  return totalFilled;
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("CLOB FILLS BACKFILL (Corrected: Dual-Stream, Local Filter, TX Link)");
  console.log("Fetch both maker= and taker=");
  console.log("Filter locally: keep if maker === proxy OR taker === proxy");
  console.log("Link to ERC-1155 by transaction_hash");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create checkpoint directory
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR);
    }

    // Get list of proxies from known wallets
    const proxies = [
      "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    ];

    console.log(`Found ${proxies.length} target proxies\n`);

    let totalIngested = 0;

    for (const proxy of proxies) {
      const filled = await backfillProxyByDayWindows(proxy);
      totalIngested += filled;
    }

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log(`TOTAL FILLS INGESTED: ${totalIngested}\n`);

    // Verify fill counts
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
