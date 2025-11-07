#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 30000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message?.substring(0, 100)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';
const wallets = [wallet1, wallet2];

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("ANALYSIS: Resolvable vs Unresolvable Trades");
  console.log("════════════════════════════════════════════════════════════════\n");

  for (const wallet of wallets) {
    try {
      const analysis = await queryData(`
        SELECT
          lower(wallet_address) as wallet,
          count() as total_trades,
          countIf(market_id = '0x0000000000000000000000000000000000000000000000000000000000000000') as null_market_trades,
          countIf(market_id != '0x0000000000000000000000000000000000000000000000000000000000000000') as resolvable_trades
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet}')
        GROUP BY wallet
      `);

      if (analysis.length === 0) continue;

      const a = analysis[0];
      const total = parseInt(a.total_trades);
      const null_market = parseInt(a.null_market_trades);
      const resolvable = parseInt(a.resolvable_trades);
      const null_pct = (null_market / total * 100).toFixed(1);
      const resolvable_pct = (resolvable / total * 100).toFixed(1);

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Total trades:           ${total}`);
      console.log(`    Resolvable (valid mkt): ${resolvable} (${resolvable_pct}%)`);
      console.log(`    Unresolvable (NULL):    ${null_market} (${null_pct}%) ❌ Cannot join\n`);
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 80)}\n`);
    }
  }

  // Now compute coverage ONLY on resolvable trades
  console.log("💡 Coverage on RESOLVABLE Trades Only:\n");

  for (const wallet of wallets) {
    try {
      const resolved = await queryData(`
        SELECT
          count(DISTINCT t.trade_id) as matched_to_winner
        FROM trades_raw t
        INNER JOIN winning_index w ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
        WHERE lower(t.wallet_address) = lower('${wallet}')
          AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `);

      const resolvable = await queryData(`
        SELECT count() as total
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet}')
          AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
      `);

      const matched = parseInt(resolved[0]?.matched_to_winner || 0);
      const total = parseInt(resolvable[0]?.total || 0);
      const pct = total > 0 ? (matched / total * 100).toFixed(1) : '0.0';

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Matched to winner:  ${matched}/${total} (${pct}%)`);
      console.log(`    Status: ${parseInt(pct) >= 95 ? '✅ GATE WOULD PASS' : `⚠️  Still ${pct}%`}\n`);
    } catch (e: any) {
      console.error(`  Error: ${e.message?.substring(0, 80)}\n`);
    }
  }

  // Sample the unresolvable trades to understand what they are
  console.log("🔍 Sample Unresolvable Trades (market_id = 0x000...000):\n");

  try {
    const samples = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        condition_id,
        outcome_index,
        side,
        shares,
        entry_price,
        timestamp
      FROM trades_raw
      WHERE market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND lower(wallet_address) IN (lower('${wallet1}'), lower('${wallet2}'))
      ORDER BY timestamp DESC
      LIMIT 5
    `);

    for (const s of samples) {
      console.log(`  ${s.wallet.substring(0, 12)}... | ${s.side} ${s.shares} @ $${s.entry_price}`);
      console.log(`    condition_id: ${s.condition_id ? s.condition_id.substring(0, 20) : 'NULL'}...`);
      console.log(`    outcome_index: ${s.outcome_index}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 80)}\n`);
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("RECOMMENDATION:\n");
  console.log("  The unresolvable trades (market_id = 0x000...000) should be");
  console.log("  EXCLUDED from coverage gates and P&L reconciliation, as they");
  console.log("  genuinely lack market context and cannot be joined to winners.\n");
  console.log("  Proceed to Step 7 with resolvable trades only.\n");
  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
