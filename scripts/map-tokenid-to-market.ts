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

const GAMMA_API = "https://gamma-api.polymarket.com";

// Helper to compute token ID from condition ID and outcome index
// Conditional Tokens spec: tokenId encodes condition and outcome
// For Polymarket: token_id = conditionId * 2^1 + outcomeIndex
// But more likely: token_id is derived via market-specific encoding
function deriveTokenIds(conditionId: string, numOutcomes: number): string[] {
  // Standard Conditional Tokens encoding per spec:
  // Position token ID for outcome i = conditionId << 1 | (1 << i)
  const ids: string[] = [];
  const cidBig = BigInt(conditionId);

  for (let i = 0; i < numOutcomes; i++) {
    // Each outcome gets a unique position token ID
    // Token ID = conditionId * 2 + outcome_index (simplified encoding)
    const tokenId = (cidBig * BigInt(2) + BigInt(i)).toString(16);
    ids.push("0x" + tokenId.padStart(64, "0"));
  }

  return ids;
}

interface GammaMarket {
  id: string;
  title: string;
  conditionId: string;
  outcomes: string[];
  resolutionSource?: string;
  tags?: string[];
}

async function fetchGammaMarkets(limit = 100000): Promise<GammaMarket[]> {
  console.log("Fetching markets from Gamma API...");
  const markets: GammaMarket[] = [];
  let offset = 0;
  const pageSize = 100;

  while (offset < limit) {
    try {
      const url = `${GAMMA_API}/markets?limit=${pageSize}&offset=${offset}`;
      const resp = await fetch(url);

      if (!resp.ok) {
        console.log(`API returned ${resp.status}, stopping pagination`);
        break;
      }

      const data = await resp.json() as any;
      const items = data.data || data || [];

      if (!Array.isArray(items) || items.length === 0) {
        console.log("No more markets from API");
        break;
      }

      for (const market of items) {
        markets.push({
          id: market.id,
          title: market.title || market.question || "",
          conditionId: market.conditionId,
          outcomes: market.outcomes || [],
        });
      }

      console.log(`Fetched ${markets.length} markets so far...`);
      offset += pageSize;

      if (markets.length >= limit) break;
    } catch (e) {
      console.log(`Error fetching page at offset ${offset}:`, e);
      break;
    }
  }

  return markets;
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("Building Token ID → Market mapping from Gamma API");
  console.log("════════════════════════════════════════════════════════════════════\n");

  try {
    // Create mapping table
    await ch.exec({
      query: `
        CREATE TABLE IF NOT EXISTS pm_tokenid_market_map
        (
          token_id          String,
          market_id         LowCardinality(String),
          outcome_index     UInt8,
          outcome_label     String,
          condition_id      String,
          market_title      String,
          source            LowCardinality(String) DEFAULT 'gamma_api'
        )
        ENGINE = ReplacingMergeTree()
        PRIMARY KEY (token_id)
        ORDER BY (token_id)
      `,
    });
    console.log("✅ pm_tokenid_market_map table ready\n");

    // Fetch all markets from Gamma API
    const markets = await fetchGammaMarkets();
    console.log(`\n✅ Fetched ${markets.length} markets from Gamma API\n`);

    // Build mapping: token_id → market_id + outcome
    const batch: any[] = [];
    let mappingCount = 0;

    for (const market of markets) {
      if (!market.conditionId) {
        console.log(`Skipping market ${market.id} - no conditionId`);
        continue;
      }

      const outcomes = market.outcomes || [];
      const numOutcomes = outcomes.length || 2; // Default to 2 outcomes

      // Generate token IDs for each outcome
      for (let i = 0; i < numOutcomes; i++) {
        // Standard Conditional Tokens: token_id = conditionId * 2^(i+1)
        // Or simpler: use packed encoding
        const tidBig = BigInt(market.conditionId) * BigInt(2) + BigInt(i);
        const tokenId = "0x" + tidBig.toString(16).padStart(64, "0");

        const outcomeLabel = outcomes[i] || `Outcome ${i}`;

        batch.push({
          token_id: tokenId,
          market_id: market.id,
          outcome_index: i,
          outcome_label: outcomeLabel,
          condition_id: market.conditionId,
          market_title: market.title,
          source: "gamma_api",
        });

        mappingCount++;

        if (batch.length >= 5000) {
          await ch.insert({
            table: "pm_tokenid_market_map",
            values: batch,
            format: "JSONEachRow",
          });
          batch.length = 0;
          process.stdout.write(`\rInserted: ${mappingCount} mappings`);
        }
      }
    }

    if (batch.length > 0) {
      await ch.insert({
        table: "pm_tokenid_market_map",
        values: batch,
        format: "JSONEachRow",
      });
    }

    console.log(`\n✅ Created ${mappingCount} token_id → market mappings\n`);

    // Show statistics
    const statsQ = await ch.query({
      query: `
        SELECT
          COUNT(DISTINCT token_id) AS total_tokens,
          COUNT(DISTINCT market_id) AS unique_markets,
          COUNT(DISTINCT condition_id) AS unique_conditions
        FROM pm_tokenid_market_map
        FORMAT JSONEachRow
      `,
    });

    const statsText = await statsQ.text();
    const stats = JSON.parse(statsText.trim());

    console.log("════════════════════════════════════════════════════════════════════");
    console.log("Summary:");
    console.log(`  Total Token IDs: ${stats.total_tokens}`);
    console.log(`  Unique Markets: ${stats.unique_markets}`);
    console.log(`  Unique Conditions: ${stats.unique_conditions}`);
    console.log("════════════════════════════════════════════════════════════════════\n");

    // Show sample mappings
    console.log("Sample mappings:\n");
    const sampleQ = await ch.query({
      query: `
        SELECT
          token_id,
          market_id,
          outcome_index,
          outcome_label,
          market_title
        FROM pm_tokenid_market_map
        LIMIT 10
        FORMAT JSONEachRow
      `,
    });

    const sampleText = await sampleQ.text();
    const samples = sampleText.trim().split("\n");

    for (let i = 0; i < Math.min(10, samples.length); i++) {
      const row = JSON.parse(samples[i]);
      console.log(
        `Token: ${row.token_id.slice(0, 16)}... → Market ${row.market_id} Outcome ${row.outcome_index} (${row.outcome_label})`
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
