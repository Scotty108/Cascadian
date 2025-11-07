#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}\n`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 150)}\n`);
    return false;
  }
}

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message?.substring(0, 150)}`);
    return [];
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TASK B: BUILD CANONICAL BRIDGE (market_id → condition_id)");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Step 1: Create enriched trades view with condition_id filled from market mapping
  const createEnrichedTrades = `
    CREATE OR REPLACE VIEW trades_enriched_with_condition AS
    SELECT
      t.*,
      COALESCE(
        t.condition_id,
        CASE
          WHEN c.condition_id IS NOT NULL
          THEN c.condition_id
          ELSE ''
        END
      ) AS condition_id_filled,
      COALESCE(
        lower(replaceAll(t.condition_id, '0x', '')),
        CASE
          WHEN c.condition_id IS NOT NULL
          THEN lower(replaceAll(c.condition_id, '0x', ''))
          ELSE ''
        END
      ) AS condition_id_norm
    FROM trades_raw t
    LEFT JOIN condition_market_map c
      ON lower(t.market_id) = lower(c.market_id)
  `;

  if (!await executeQuery("Create enriched trades view", createEnrichedTrades)) {
    return;
  }

  // Step 2: Verify coverage improvement
  console.log("📊 Coverage Analysis:\n");

  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  for (const wallet of [wallet1, wallet2]) {
    try {
      const before = await queryData(`
        SELECT
          countIf(condition_id != '') as has_condition,
          count() as total
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet}')
      `);

      const after = await queryData(`
        SELECT
          countIf(condition_id_filled != '') as has_condition,
          count() as total
        FROM trades_enriched_with_condition
        WHERE lower(wallet_address) = lower('${wallet}')
      `);

      const b = before[0];
      const a = after[0];
      const before_pct = (parseInt(b.has_condition) / parseInt(b.total) * 100).toFixed(1);
      const after_pct = (parseInt(a.has_condition) / parseInt(a.total) * 100).toFixed(1);
      const improvement = (parseInt(a.has_condition) - parseInt(b.has_condition));

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Before: ${b.has_condition}/${b.total} (${before_pct}%)`);
      console.log(`    After:  ${a.has_condition}/${a.total} (${after_pct}%)`);
      console.log(`    Gain:   +${improvement} trades (${((improvement/parseInt(b.total)*100)).toFixed(1)}%)\n`);
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
    }
  }

  // Step 3: Check join-to-winner coverage with enriched trades
  console.log("🔗 Join-to-Winner Coverage (using enriched trades):\n");

  for (const wallet of [wallet1, wallet2]) {
    try {
      const all_trades = await queryData(`
        SELECT count(DISTINCT trade_id) as total
        FROM trades_enriched_with_condition
        WHERE lower(wallet_address) = lower('${wallet}')
      `);

      const matched = await queryData(`
        SELECT count(DISTINCT t.trade_id) as matched
        FROM trades_enriched_with_condition t
        INNER JOIN winning_index w
          ON t.condition_id_norm = w.condition_id_norm
        WHERE lower(t.wallet_address) = lower('${wallet}')
      `);

      const total = parseInt(all_trades[0]?.total || 0);
      const match_count = parseInt(matched[0]?.matched || 0);
      const pct = total > 0 ? (match_count / total * 100).toFixed(1) : '0.0';

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Matched: ${match_count}/${total} (${pct}%)`);
      console.log(`    Status:  ${parseInt(pct) >= 95 ? '✅ GATE PASSED' : '⚠️  Still below 95%'}\n`);
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
    }
  }

  // Step 4: Sample verification - 10 random bridged rows
  console.log("✅ Bridge Quality Verification (10 random samples):\n");

  try {
    const samples = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        market_id,
        condition_id_filled,
        condition_id_norm
      FROM trades_enriched_with_condition
      WHERE lower(wallet_address) IN (lower('${wallet1}'), lower('${wallet2}'))
        AND condition_id_filled != ''
      ORDER BY rand()
      LIMIT 10
    `);

    for (const s of samples) {
      console.log(`  Market: ${s.market_id.substring(0, 20)}...`);
      console.log(`    → Condition: ${s.condition_id_norm.substring(0, 16)}...\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  // Step 5: Assert cardinality - each market_id maps to exactly 1 condition_id_norm
  console.log("🔐 Cardinality Assertions:\n");

  try {
    const cardinality = await queryData(`
      SELECT
        count(DISTINCT market_id) as unique_markets,
        count(*) as total_rows,
        max(market_id_count) as max_conditions_per_market,
        sum(CASE WHEN market_id_count > 1 THEN 1 ELSE 0 END) as markets_with_dupes
      FROM (
        SELECT
          market_id,
          count(DISTINCT condition_id_norm) as market_id_count
        FROM condition_market_map
        WHERE market_id != '' AND condition_id_norm != ''
        GROUP BY market_id
      )
    `);

    const c = cardinality[0];
    console.log(`  Unique markets: ${c.unique_markets}`);
    console.log(`  Total rows: ${c.total_rows}`);
    console.log(`  Max conditions/market: ${c.max_conditions_per_market}`);
    console.log(`  Markets with dupes: ${c.markets_with_dupes}`);

    if (c.max_conditions_per_market === '1' && c.markets_with_dupes === '0') {
      console.log(`  ✅ CARDINALITY: Perfect 1:1 mapping\n`);
    } else {
      console.log(`  ⚠️ CARDINALITY: Some markets map to multiple conditions\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 100)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("Bridge building complete. Use trades_enriched_with_condition for P&L calcs.\n");
}

main().catch(console.error);
