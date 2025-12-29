#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

interface CheckResult {
  check: string;
  status: "✅" | "⚠️" | "❌";
  value: string;
  threshold?: string;
  passed: boolean;
}

const results: CheckResult[] = [];

async function runCheck(
  name: string,
  query: string,
  validator: (data: any) => { passed: boolean; message: string; threshold?: string }
) {
  try {
    const result = await ch.query({ query });
    const text = await result.text();
    const data = JSON.parse(text);
    const row = data.data?.[0];

    const validation = validator(row);
    const status = validation.passed ? "✅" : "⚠️";

    results.push({
      check: name,
      status: status as "✅" | "⚠️",
      value: validation.message,
      threshold: validation.threshold,
      passed: validation.passed,
    });

    console.log(`${status} ${name}`);
    console.log(`   Value: ${validation.message}`);
    if (validation.threshold) console.log(`   Threshold: ${validation.threshold}`);
  } catch (e: any) {
    results.push({
      check: name,
      status: "❌",
      value: e.message?.substring(0, 100),
      passed: false,
    });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${e.message?.substring(0, 100)}`);
  }
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("POLYMARKET P&L DATA VALIDATION");
  console.log("Ready-to-deploy verification suite");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Check 1: Trade Data Completeness
  await runCheck(
    "1. TRADES_COMPLETENESS",
    `
      SELECT
        count() as total_trades,
        countIf(transaction_hash IS NOT NULL AND transaction_hash != '') as trades_with_hash,
        countIf(market_id IS NOT NULL AND market_id != '') as trades_with_market,
        countIf(entry_price IS NOT NULL) as trades_with_price,
        countIf(shares IS NOT NULL) as trades_with_size,
        round(countIf(transaction_hash IS NOT NULL AND transaction_hash != '') / count() * 100, 2) as completeness_pct
      FROM trades_raw
      WHERE lower(wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
    `,
    (row) => {
      const complete = parseFloat(row.completeness_pct) >= 99.5;
      return {
        passed: complete,
        message: `${row.completeness_pct}% (${row.total_trades} trades)`,
        threshold: "≥99.5%",
      };
    }
  );

  // Check 2: Price Validity
  await runCheck(
    "2. PRICE_VALIDITY",
    `
      SELECT
        count() as total_trades,
        countIf(entry_price >= 0 AND entry_price <= 1) as valid_prices,
        countIf(entry_price < 0) as negative_prices,
        countIf(entry_price > 1) as prices_over_1,
        round(countIf(entry_price >= 0 AND entry_price <= 1) / count() * 100, 2) as validity_pct
      FROM trades_raw
      WHERE lower(wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
    `,
    (row) => {
      const valid = parseFloat(row.validity_pct) >= 99 && row.negative_prices === 0;
      return {
        passed: valid,
        message: `${row.validity_pct}% valid | ${row.negative_prices} negative | ${row.prices_over_1} over 1.0`,
        threshold: "≥99% valid, 0 negative",
      };
    }
  );

  // Check 3: ERC-1155 Reconciliation
  await runCheck(
    "3. ERC1155_RECONCILIATION",
    `
      WITH trades_with_erc AS (
        SELECT t.trade_id, e.tx_hash
        FROM trades_raw t
        LEFT JOIN pm_erc1155_flats e ON lower(t.transaction_hash) = lower(e.tx_hash)
        WHERE lower(t.wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
      )
      SELECT
        count() as total_trades,
        countIf(tx_hash IS NOT NULL) as erc1155_matched,
        countIf(tx_hash IS NULL) as unmatched,
        round(countIf(tx_hash IS NOT NULL) / count() * 100, 2) as match_pct
      FROM trades_with_erc
    `,
    (row) => {
      const match = parseFloat(row.match_pct) === 100;
      return {
        passed: match,
        message: `${row.match_pct}% match (${row.total_trades} trades) | ${row.unmatched} unmatched`,
        threshold: "100% match (critical)",
      };
    }
  );

  // Check 4: Wallet Trade Counts
  await runCheck(
    "4. WALLET_TRADE_COUNTS",
    `
      SELECT
        count() as total_trades,
        countIf(side='YES') as yes_trades,
        countIf(side='NO') as no_trades
      FROM trades_raw
      WHERE lower(wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
    `,
    (row) => {
      const has_both = row.yes_trades > 0 && row.no_trades > 0;
      return {
        passed: has_both,
        message: `${row.total_trades} total | ${row.yes_trades} YES | ${row.no_trades} NO`,
        threshold: "Both YES and NO trades present",
      };
    }
  );

  // Check 5: Position Sanity
  await runCheck(
    "5. POSITION_SANITY",
    `
      SELECT
        count() as total_positions,
        countIf(net_shares > 0) as long_positions,
        countIf(net_shares < 0) as short_positions,
        countIf(net_shares = 0) as zero_positions,
        min(net_shares) as min_position,
        max(net_shares) as max_position
      FROM (
        SELECT
          wallet_address,
          market_id,
          outcome,
          sumIf(shares, side='YES') - sumIf(shares, side='NO') AS net_shares
        FROM trades_raw
        WHERE lower(wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
        GROUP BY wallet_address, market_id, outcome
      )
    `,
    (row) => {
      const sanity = row.zero_positions === 0 && Math.abs(row.min_position) < 10000 && row.max_position < 10000;
      return {
        passed: sanity,
        message: `${row.total_positions} positions | ${row.long_positions} long | ${row.short_positions} short | Range: [${row.min_position}, ${row.max_position}]`,
        threshold: "Range within [-10k, +10k]",
      };
    }
  );

  // Check 6: Market Coverage
  await runCheck(
    "6. MARKET_COVERAGE",
    `
      SELECT
        count(DISTINCT market_id) as unique_markets,
        count(DISTINCT transaction_hash) as unique_transactions,
        min(timestamp) as first_trade,
        max(timestamp) as last_trade
      FROM trades_raw
      WHERE lower(wallet_address) IN (lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'), lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'))
    `,
    (row) => {
      const has_coverage = row.unique_markets > 50 && row.unique_transactions > 100;
      return {
        passed: has_coverage,
        message: `${row.unique_markets} markets | ${row.unique_transactions} transactions | Period: ${row.first_trade} to ${row.last_trade}`,
        threshold: ">50 markets, >100 transactions",
      };
    }
  );

  // Check 7: Candle Coverage
  await runCheck(
    "7. CANDLE_COVERAGE",
    `
      SELECT
        count() as total_candles,
        count(DISTINCT market_id) as candle_markets,
        min(bucket) as earliest_bucket,
        max(bucket) as latest_bucket,
        countIf(bucket >= now() - INTERVAL 7 DAY) as recent_candles_7d,
        round(countIf(bucket >= now() - INTERVAL 7 DAY) / count() * 100, 2) as recent_pct
      FROM market_candles_5m
    `,
    (row) => {
      const has_coverage = row.total_candles > 1000000 && row.candle_markets > 50000;
      return {
        passed: has_coverage,
        message: `${row.total_candles} candles | ${row.candle_markets} markets | Latest: ${row.latest_bucket} | Recent (7d): ${row.recent_candles_7d} (${row.recent_pct}%)`,
        threshold: ">1M candles, >50k markets",
      };
    }
  );

  // Check 8: View Availability
  await runCheck(
    "8. VIEWS_AVAILABLE",
    `
      SELECT
        (SELECT count() > 0 FROM market_last_price LIMIT 1) as has_market_last_price,
        (SELECT count() > 0 FROM wallet_positions LIMIT 1) as has_wallet_positions
    `,
    (row) => {
      const views_exist = row.has_market_last_price && row.has_wallet_positions;
      return {
        passed: views_exist,
        message: `market_last_price: ${row.has_market_last_price ? "✓" : "✗"} | wallet_positions: ${row.has_wallet_positions ? "✓" : "✗"}`,
        threshold: "Both views required",
      };
    }
  );

  // Summary
  console.log("\n════════════════════════════════════════════════════════════════════");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log(`\nSUMMARY: ${passed}/${total} checks passed\n`);

  if (passed === total) {
    console.log("🎉 ALL CHECKS PASSED - READY FOR UI DEPLOYMENT");
    console.log("\nNext steps:");
    console.log("  1. Load market metadata (names, categories) from Polymarket API");
    console.log("  2. Deploy API routes in app/api/");
    console.log("  3. Build portfolio dashboard UI");
    console.log("  4. Add confidence scoring for each metric");
    console.log("════════════════════════════════════════════════════════════════════\n");
  } else {
    console.log("⚠️  SOME CHECKS FAILED - REVIEW BELOW\n");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  ❌ ${r.check}: ${r.value}`);
      if (r.threshold) console.log(`     Expected: ${r.threshold}`);
    });
    console.log("════════════════════════════════════════════════════════════════════\n");
  }

  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
