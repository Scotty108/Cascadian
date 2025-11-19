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
const CHECKPOINT_DIR = ".clob_checkpoints";

interface ClobTrade {
  id: string;
  transaction_hash?: string;
  taker: string;
  maker?: string;
  market: string;
  price?: string;
  size?: string;
  match_time_ms: number;
  side?: string;
  [key: string]: any;
}

interface Checkpoint {
  lastMinTimestampMs: number;
  pagesProcessed: number;
  totalNewFills: number;
  lastPageSize: number;
  lastPageUniqueIdCount: number;
}

async function fetchWithRetry(url: string, maxRetries = 3): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "L2-Key": process.env.L2_KEY || "",
        },
      });

      if (!response.ok) {
        if (attempt === maxRetries) {
          console.log(`  ⚠️  API error: ${response.status} (${response.statusText})`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      return await (response as any).json();
    } catch (e) {
      if (attempt === maxRetries) {
        console.log(`  ❌ Fetch error: ${e}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

async function fetchPage(
  proxy: string,
  beforeMs: number
): Promise<{ trades: ClobTrade[]; minTimestampMs: number; shouldContinue: boolean }> {
  // Use /trades endpoint with taker filter
  // Fields: proxyWallet, side, asset, conditionId, size, price, timestamp, transactionHash
  const params = new URLSearchParams({
    taker: proxy,
    limit: "1000",
  });

  // Add before parameter if we're paginating backwards
  if (beforeMs < Date.now()) {
    params.set("before", String(beforeMs));
  }

  const url = `${CLOB_API}/trades?${params}`;

  const response = await fetchWithRetry(url);
  if (!response || !Array.isArray(response)) {
    return { trades: [], minTimestampMs: beforeMs, shouldContinue: false };
  }

  // Map API response to our trade structure
  // API uses timestamp (seconds), we need milliseconds
  const trades: ClobTrade[] = response.map((t: any) => ({
    id: t.transactionHash || `${t.conditionId}-${t.timestamp}-${proxy}`,
    transaction_hash: t.transactionHash || "",
    taker: t.proxyWallet || proxy,
    maker: "",
    market: t.conditionId || t.asset || "",
    price: String(t.price || "0"),
    size: String(t.size || "0"),
    match_time_ms: (t.timestamp || 0) * 1000, // Convert seconds to ms
    side: (t.side || "").toLowerCase(),
  }));

  if (trades.length === 0) {
    return { trades: [], minTimestampMs: beforeMs, shouldContinue: false };
  }

  // Find minimum timestamp in this page (in milliseconds)
  const minTimestampMs = Math.min(...trades.map((t) => t.match_time_ms));

  // Should continue if we got results and timestamp moved backwards
  const shouldContinue = trades.length > 0 && minTimestampMs < beforeMs;

  return { trades, minTimestampMs, shouldContinue };
}

async function ingestTrades(trades: ClobTrade[]): Promise<number> {
  if (trades.length === 0) return 0;

  const batch: any[] = [];

  for (const trade of trades) {
    // Use id as primary key (dedup by id)
    const row = {
      id: trade.id,
      transaction_hash: trade.transaction_hash || "",
      proxy_wallet: trade.taker,
      market_id: trade.market || "",
      side: (trade.side || "").toLowerCase(),
      size: String(trade.size || "0"),
      price: String(trade.price || "0"),
      ts: new Date(trade.match_time_ms),
      notional: String((parseFloat(String(trade.price || 0)) * parseFloat(String(trade.size || 0))).toFixed(6)),
    };

    batch.push(row);
  }

  // Filter out duplicate trades using guardrail
  const cleanTrades = await filterDuplicateTrades(batch, ch, "pm_trades");
  const filtered = batch.length - cleanTrades.length;
  if (filtered > 0) {
    console.log(`  🛡️  Guardrail: Filtered ${filtered} duplicate trades`);
  }

  if (cleanTrades.length === 0) return 0;

  // Insert with ON CONFLICT(id) DO NOTHING for deduplication
  try {
    await ch.insert({
      table: "pm_trades",
      values: cleanTrades,
      format: "JSONEachRow",
    });
    return cleanTrades.length;
  } catch (e: any) {
    console.log(`  ⚠️  Ingest error: ${e.message?.substring(0, 100)}`);
    return 0;
  }
}

async function backfillProxy(proxy: string): Promise<{ total: number; checkpoint: Checkpoint }> {
  const checkpointFile = path.join(CHECKPOINT_DIR, `${proxy}.json`);

  let checkpoint: Checkpoint = {
    lastMinTimestampMs: Date.now(),
    pagesProcessed: 0,
    totalNewFills: 0,
    lastPageSize: 0,
    lastPageUniqueIdCount: 0,
  };

  // Load checkpoint if exists
  if (fs.existsSync(checkpointFile)) {
    const saved = JSON.parse(fs.readFileSync(checkpointFile, "utf8"));
    checkpoint = { ...checkpoint, ...saved };
  }

  let beforeMs = checkpoint.lastMinTimestampMs;
  let totalThisRun = 0;
  let pageCount = 0;
  let seenIds = new Set<string>();

  while (true) {
    pageCount++;
    const { trades, minTimestampMs, shouldContinue } = await fetchPage(proxy, beforeMs);

    if (trades.length === 0) {
      console.log(`  ✅ No more trades (page ${pageCount})`);
      break;
    }

    // Track unique ids on this page
    const uniqueIdsOnPage = new Set(trades.map((t) => t.id));
    const duplicatesOnPage = trades.length - uniqueIdsOnPage.size;
    const duplicateRate = trades.length > 0 ? (duplicatesOnPage / trades.length) * 100 : 0;

    const ingested = await ingestTrades(trades);
    totalThisRun += ingested;

    // Update seen ids
    uniqueIdsOnPage.forEach((id) => seenIds.add(id));

    checkpoint.lastMinTimestampMs = minTimestampMs;
    checkpoint.pagesProcessed++;
    checkpoint.totalNewFills += ingested;
    checkpoint.lastPageSize = trades.length;
    checkpoint.lastPageUniqueIdCount = uniqueIdsOnPage.size;

    console.log(`  Page ${pageCount}: ${trades.length} trades, ${uniqueIdsOnPage.size} unique, ${duplicateRate.toFixed(1)}% dups (total: ${totalThisRun})`);

    // Save checkpoint every page
    fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2));

    // Loop protection: if duplicates exceed 95%, decrement before by 1000ms and retry once
    if (duplicateRate > 95) {
      console.log(`  ⚠️  High duplication (${duplicateRate.toFixed(1)}%), stepping back 1000ms and retrying`);
      beforeMs = minTimestampMs - 1000;
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    // Stop if we're not making progress
    if (!shouldContinue) {
      console.log(`  ✅ Backfill complete (earliest timestamp not moving)`);
      break;
    }

    // Set before for next page: min(match_time_ms) - 1
    beforeMs = minTimestampMs - 1;

    // Rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  return { total: totalThisRun, checkpoint };
}

async function verifyFillCounts(): Promise<{ holyMoses7: number; niggemon: number }> {
  const wallets = [
    {
      name: "HolyMoses7",
      addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
    },
    {
      name: "niggemon",
      addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
    },
  ];

  const results: Record<string, number> = {};

  for (const wallet of wallets) {
    const query = await ch.query({
      query: `SELECT COUNT(*) as cnt FROM pm_trades WHERE lower(proxy_wallet) = lower('${wallet.addr}')`,
    });

    const text = await query.text();
    const data = JSON.parse(text);
    const count = data.data?.[0]?.cnt || 0;

    results[wallet.name.toLowerCase()] = count;
    console.log(`  ${wallet.name}: ${count} fills`);
  }

  return {
    holyMoses7: results.holymoses7 || 0,
    niggemon: results.niggemon || 0,
  };
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 2: CLOB FILLS BACKFILL (Fixed Pagination with Loop Guards)");
  console.log("Endpoint: /data/trades with taker filter");
  console.log("Key: id (dedup by CLOB trade id)");
  console.log("Pagination: before=min(match_time_ms)-1 with 95% dup detection");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create checkpoint directory
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR);
    }

    // Get list of proxies
    console.log("Fetching list of proxies...");

    const proxiesQ = await ch.query({
      query: `
        SELECT DISTINCT proxy_wallet
        FROM pm_user_proxy_wallets
        WHERE is_active = 1
        ORDER BY proxy_wallet
      `,
    });

    const proxiesText = await proxiesQ.text();
    const proxiesData = JSON.parse(proxiesText);
    const proxies = (proxiesData.data || []).map((row: any) => row.proxy_wallet);

    console.log(`Found ${proxies.length} active proxies\n`);

    let totalIngested = 0;

    for (const proxy of proxies) {
      if (!proxy) continue;

      console.log(`Processing ${proxy.slice(0, 12)}...\n`);

      const { total } = await backfillProxy(proxy);
      totalIngested += total;

      console.log();
    }

    console.log("════════════════════════════════════════════════════════════════════");
    console.log("\nVERIFYING FILL COUNTS:\n");

    const counts = await verifyFillCounts();

    console.log("\n════════════════════════════════════════════════════════════════════");
    console.log("ACCEPTANCE GATES:\n");

    const holyMosesPass = counts.holyMoses7 >= 2182;
    const niggemonPass = counts.niggemon >= 1087;

    console.log(`[${holyMosesPass ? "✅" : "❌"}] HolyMoses7: ${counts.holyMoses7}/${2182} fills`);
    console.log(
      `[${niggemonPass ? "✅" : "❌"}] niggemon: ${counts.niggemon}/${1087} fills`
    );

    console.log("\n════════════════════════════════════════════════════════════════════\n");

    if (!holyMosesPass || !niggemonPass) {
      console.log("❌ HARD FAIL: Fill count gates not met\n");
      process.exit(1);
    }

    console.log("✅ STEP 2 COMPLETE: All gates passed\n");
    process.exit(0);
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
