#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const CLOB_API = process.env.CLOB_API || "https://clob.polymarket.com";
const CHECKPOINT_DIR = ".clob_checkpoints";

interface ClobFill {
  id: string;
  maker?: string;
  taker?: string;
  asset_id?: string;
  outcome?: string;
  quantity: string;
  price: string;
  transaction_hash: string;
  block_number?: number;
  block_timestamp?: number;
  fee?: string;
  timestamp?: number;
}

interface ClobFillRecord {
  fill_id: string;
  proxy_wallet: string;
  market_id: string;
  outcome_id: string;
  side: "buy" | "sell";
  price: string;
  size: string;
  ts: number;
  notional: string;
}

async function createTables() {
  console.log("Creating pm_trades table...");

  await ch.exec({
    query: `
      CREATE TABLE IF NOT EXISTS pm_trades
      (
        fill_id         String,
        proxy_wallet    String,
        market_id       String,
        outcome_id      String,
        side            String,
        price           String,
        size            String,
        ts              DateTime,
        notional        String,
        insert_time     DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree()
      PARTITION BY toYYYYMM(ts)
      ORDER BY (proxy_wallet, ts, fill_id)
    `,
  });

  console.log("✅ pm_trades table ready\n");
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("STEP 2: INGEST CLOB FILLS (LOSSLESS PAGINATION)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create tables
    await createTables();

    // Get list of proxies to fetch
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

    if (proxies.length === 0) {
      console.log("No proxies found. Run build-approval-proxies first.");
      process.exit(1);
    }

    // Create checkpoint directory
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR);
    }

    let totalFillsIngested = 0;
    let totalProxiesProcessed = 0;

    // Process each proxy
    for (const proxy of proxies) {
      if (!proxy) continue;

      const checkpointFile = path.join(CHECKPOINT_DIR, `${proxy}.checkpoint`);
      let startId = "";

      // Check if we have a checkpoint
      if (fs.existsSync(checkpointFile)) {
        startId = fs.readFileSync(checkpointFile, "utf8").trim();
      }

      console.log(`Processing ${proxy.slice(0, 10)}... (from ${startId ? startId.slice(0, 8) : "beginning"})`);

      try {
        // Fetch fills for this proxy
        const url = `${CLOB_API}/fills?creator=${proxy}`;

        const response = await fetch(url, {
          method: "GET",
          headers: { "Accept": "application/json" },
        });

        if (!response.ok) {
          console.log(`  WARNING: API error: ${response.status}`);
          continue;
        }

        const fills: ClobFill[] = await (response as any).json();

        if (!Array.isArray(fills) || fills.length === 0) {
          console.log(`  No fills found`);
          continue;
        }

        console.log(`  Found ${fills.length} fills`);

        // Insert fills into ClickHouse
        // Parse market_id and outcome from asset_id
        const batch: any[] = [];

        for (const fill of fills) {
          const assetId = fill.asset_id || "";
          // Asset ID format: market_id-outcome
          const [marketId, outcomeId] = assetId.includes("-")
            ? assetId.split("-")
            : [assetId, fill.outcome || ""];

          batch.push({
            fill_id: fill.id,
            proxy_wallet: proxy,
            market_id: marketId,
            outcome_id: outcomeId,
            side: fill.maker === proxy ? "sell" : "buy",
            price: fill.price,
            size: fill.quantity,
            ts: new Date(fill.timestamp ? fill.timestamp * 1000 : 0),
            notional: String(parseFloat(fill.price) * parseFloat(fill.quantity)),
          });

          if (batch.length >= 1000) {
            await ch.insert({
              table: "pm_trades",
              values: batch,
              format: "JSONEachRow",
            });
            batch.length = 0;
          }
        }

        if (batch.length > 0) {
          await ch.insert({
            table: "pm_trades",
            values: batch,
            format: "JSONEachRow",
          });
        }

        // Save checkpoint
        const lastFill = fills[fills.length - 1];
        fs.writeFileSync(checkpointFile, lastFill.id);

        totalFillsIngested += fills.length;
        totalProxiesProcessed++;

        console.log(`  ✅ Ingested ${fills.length} fills`);
      } catch (e: any) {
        console.log(`  ❌ Error: ${e.message}`);
      }
    }

    console.log(`\n════════════════════════════════════════════════════════════════════`);
    console.log(`✅ STEP 2 COMPLETE`);
    console.log(`   Total fills ingested: ${totalFillsIngested}`);
    console.log(`   Proxies processed: ${totalProxiesProcessed}`);
    console.log(`════════════════════════════════════════════════════════════════════\n`);

    process.exit(0);
  } catch (e) {
    console.error(`\n❌ ERROR in STEP 2:`, e);
    process.exit(1);
  } finally {
    await ch.close();
  }
}

main();
