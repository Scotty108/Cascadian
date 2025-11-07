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

async function getCoverageMetrics() {
  console.log(`\n[${new Date().toISOString()}] COVERAGE MONITOR - Live Join Metrics\n`);

  for (const wallet of wallets) {
    try {
      const metrics = await queryData(`
        SELECT
          lower(wallet_address) as wallet,
          count() as total_fills,
          countIf(market_id != '') as with_market_id,
          countIf(condition_id != '') as with_condition_id,
          countIf(lower(replaceAll(condition_id, '0x', '')) != '') as with_condition_norm
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${wallet}')
      `);

      if (metrics.length === 0) {
        console.log(`  ${wallet.substring(0, 12)}... - NO DATA\n`);
        continue;
      }

      const m = metrics[0];
      const total = parseInt(m.total_fills);
      const mkt_pct = (parseInt(m.with_market_id) / total * 100).toFixed(1);
      const cond_pct = (parseInt(m.with_condition_id) / total * 100).toFixed(1);
      const norm_pct = (parseInt(m.with_condition_norm) / total * 100).toFixed(1);

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    ① Market ID:         ${m.with_market_id}/${total} (${mkt_pct}%) ${parseInt(mkt_pct) >= 95 ? '✅' : '⚠️'}`);
      console.log(`    ② Condition ID:      ${m.with_condition_id}/${total} (${cond_pct}%) ${parseInt(cond_pct) >= 95 ? '✅' : '⚠️'}`);
      console.log(`    ③ Condition Norm:    ${m.with_condition_norm}/${total} (${norm_pct}%) ${parseInt(norm_pct) >= 95 ? '✅' : '⚠️'}\n`);
    } catch (e: any) {
      console.error(`  ${wallet.substring(0, 12)}... ERROR: ${e.message?.substring(0, 80)}\n`);
    }
  }

  // Check join-to-winner coverage
  console.log(`\n🔗 Join-to-Winner Coverage:\n`);

  for (const wallet of wallets) {
    try {
      const coverage = await queryData(`
        SELECT
          lower(t.wallet_address) as wallet,
          count(DISTINCT t.trade_id) as matched_to_winner,
          count(DISTINCT t.trade_id) OVER () as total_trades
        FROM trades_raw t
        INNER JOIN winning_index w
          ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
        WHERE lower(t.wallet_address) = lower('${wallet}')
        LIMIT 1
      `);

      if (coverage.length === 0) {
        // Fall back to count all trades
        const allTrades = await queryData(`
          SELECT count(DISTINCT trade_id) as total_trades
          FROM trades_raw
          WHERE lower(wallet_address) = lower('${wallet}')
        `);

        const total = parseInt(allTrades[0]?.total_trades || 0);
        console.log(`  ${wallet.substring(0, 12)}...`);
        console.log(`    Matched to winner:   0/${total} (0.0%) ❌ BLOCKER\n`);
        continue;
      }

      const c = coverage[0];
      const matched = parseInt(c.matched_to_winner || 0);
      const total = parseInt(c.total_trades || 0);
      const pct = (matched / total * 100).toFixed(1);

      console.log(`  ${wallet.substring(0, 12)}...`);
      console.log(`    Matched to winner:   ${matched}/${total} (${pct}%) ${parseInt(pct) >= 95 ? '✅ PASS' : '❌ BLOCKER'}\n`);
    } catch (e: any) {
      console.error(`  ${wallet.substring(0, 12)}... ERROR: ${e.message?.substring(0, 80)}\n`);
    }
  }

  console.log(`════════════════════════════════════════════════════════════════\n`);
}

async function main() {
  // Run immediately, then every 60 seconds
  await getCoverageMetrics();

  const intervalId = setInterval(async () => {
    await getCoverageMetrics();
  }, 60000); // 60 seconds

  // Keep running until user interrupts
  process.on('SIGINT', () => {
    clearInterval(intervalId);
    console.log('\nMonitor stopped.');
    process.exit(0);
  });
}

main().catch(console.error);
