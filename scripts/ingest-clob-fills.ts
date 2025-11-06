#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";
import fetch from "node-fetch";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const CLOB_API = "https://clob.polymarket.com";

interface ClobFill {
  id: string;
  trader: string;
  outcome: string;
  shares: string;
  price: string;
  orderHash: string;
  timestamp: number;
  transactionHash: string;
}

async function fetchFillsForWallet(
  wallet: string,
  limit = 1000
): Promise<ClobFill[]> {
  try {
    const url = `${CLOB_API}/api/v1/trades?trader=${wallet}&limit=${limit}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      console.log(`  ⚠️  API returned ${resp.status} for ${wallet}`);
      return [];
    }

    const data = await resp.json() as any;
    const fills = Array.isArray(data) ? data : data.data || [];

    return fills;
  } catch (e) {
    console.log(`  ⚠️  Error fetching fills for ${wallet}:`, (e as any).message);
    return [];
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("Ingesting CLOB fills for proxy wallets from CLOB API");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create trades table
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_trades
        (
          proxy_wallet      String,
          market_id         String,
          outcome           String,
          side              LowCardinality(String),
          shares            String,
          execution_price   Decimal128(10),
          fee               String,
          ts                DateTime,
          tx_hash           String,
          order_hash        String,
          source            LowCardinality(String) DEFAULT 'clob_api'
        )
        ENGINE = MergeTree
        PARTITION BY toYYYYMM(ts)
        ORDER BY (proxy_wallet, ts, tx_hash)
      `,
    });
    console.log("✅ pm_trades table ready\n");

    // Load active proxies
    console.log("Loading active proxy wallets...");
    const proxRs = await ch.query({
      query: `
        SELECT proxy_wallet FROM pm_user_proxy_wallets
        WHERE is_active = 1
        ORDER BY last_seen_block DESC
        LIMIT 10000
        FORMAT JSONEachRow
      `,
    });

    const proxText = await proxRs.text();
    const proxLines = proxText.trim().split("\n").filter((l) => l.length > 0);
    const proxies: string[] = [];

    for (const line of proxLines) {
      const row = JSON.parse(line);
      proxies.push(row.proxy_wallet);
    }

    console.log(`Found ${proxies.length} active proxy wallets\n`);

    // For each proxy, fetch fills from CLOB API
    let totalFills = 0;
    const batch: any[] = [];

    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      process.stdout.write(
        `\rFetching fills for proxy ${i + 1}/${proxies.length}...`
      );

      const fills = await fetchFillsForWallet(proxy, 10000);

      for (const fill of fills) {
        batch.push({
          proxy_wallet: proxy,
          market_id: fill.outcome || "", // Will be enriched later via join
          outcome: fill.outcome || "",
          side: fill.shares.startsWith("-") ? "sell" : "buy",
          shares: Math.abs(parseFloat(fill.shares)).toString(),
          execution_price: parseFloat(fill.price),
          fee: "0", // CLOB API may not return fee, will need separate calculation
          ts: new Date(fill.timestamp * 1000).toISOString(),
          tx_hash: fill.transactionHash,
          order_hash: fill.orderHash,
          source: "clob_api",
        });

        totalFills++;

        if (batch.length >= 5000) {
          await ch.insert({
            table: "pm_trades",
            values: batch,
            format: "JSONEachRow",
          });
          batch.length = 0;
        }
      }

      // Small delay to avoid rate limiting
      await new Promise((r) => setTimeout(r, 100));
    }

    if (batch.length > 0) {
      await ch.insert({
        table: "pm_trades",
        values: batch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n✅ Ingested ${totalFills} fills from CLOB API\n`);

    // Show statistics
    const statsQ = await ch.query({
      query: `
        SELECT
          COUNT(*) AS total_trades,
          COUNT(DISTINCT proxy_wallet) AS traders,
          AVG(CAST(execution_price AS Float64)) AS avg_price,
          MIN(ts) AS earliest_trade,
          MAX(ts) AS latest_trade
        FROM pm_trades
        FORMAT JSONEachRow
      `,
    });

    const statsText = await statsQ.text();
    const stats = JSON.parse(statsText.trim());

    console.log("════════════════════════════════════════════════════════════════════");
    console.log("Summary:");
    console.log(`  Total Trades: ${stats.total_trades}`);
    console.log(`  Traders: ${stats.traders}`);
    console.log(`  Avg Price: ${stats.avg_price}`);
    console.log(`  Date Range: ${stats.earliest_trade} to ${stats.latest_trade}`);
    console.log("════════════════════════════════════════════════════════════════════\n");

    // Show top traders by volume
    console.log("Top 10 traders by trade count:\n");
    const topQ = await ch.query({
      query: `
        SELECT
          proxy_wallet,
          COUNT(*) AS trade_count,
          COUNT(DISTINCT outcome) AS markets_traded
        FROM pm_trades
        GROUP BY proxy_wallet
        ORDER BY trade_count DESC
        LIMIT 10
        FORMAT JSONEachRow
      `,
    });

    const topText = await topQ.text();
    const topLines = topText.trim().split("\n");

    for (let i = 0; i < topLines.length; i++) {
      const row = JSON.parse(topLines[i]);
      console.log(
        `${(i + 1)
          .toString()
          .padStart(2)}. ${row.proxy_wallet} - ${row.trade_count} trades across ${row.markets_traded} markets`
      );
    }

    console.log("");
    await ch.close();
  } catch (e) {
    console.error("Error:", e);
    process.exit(1);
  }
}

main();
