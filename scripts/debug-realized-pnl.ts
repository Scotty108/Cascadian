#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

const TARGET_WALLETS = [
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', // HolyMoses7
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'  // niggemon
];

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("REALIZED P&L DEBUG TOOLKIT");
  console.log("Diagnostic queries to troubleshoot P&L calculation issues");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // ========================================================================
  // DEBUG 1: Check for duplicate trades
  // ========================================================================
  try {
    console.log("🔍 DEBUG 1: Checking for Duplicate Trades\n");

    const duplicates = await queryData(`
SELECT
  wallet_address,
  market_id,
  outcome,
  entry_price,
  shares,
  side,
  count(*) as duplicate_count
FROM trades_raw
WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
GROUP BY wallet_address, market_id, outcome, entry_price, shares, side
HAVING count(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10`);

    if (duplicates.length > 0) {
      console.log(`⚠️  Found ${duplicates.length} sets of duplicate trades:`);
      duplicates.forEach((row: any, idx: number) => {
        const walletName = row.wallet_address.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${idx + 1}. ${walletName} | Market ${row.market_id.slice(0, 16)}... | ${row.duplicate_count}x duplicates`);
        console.log(`     ${row.side} ${row.shares} @ $${row.entry_price} (${row.outcome})`);
      });
      console.log(`\n⚠️  ACTION REQUIRED: Deduplicate trades_raw table before calculating P&L\n`);
    } else {
      console.log(`✅ No duplicate trades found\n`);
    }
  } catch (e: any) {
    console.error(`Debug 1 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 2: Check trade counts per market
  // ========================================================================
  try {
    console.log("🔍 DEBUG 2: Trade Counts Per Market (Top 10)\n");

    const tradeCounts = await queryData(`
SELECT
  lower(wallet_address) AS wallet,
  lower(market_id) AS market_id,
  count(*) AS trade_count,
  sum(cast(shares as Float64)) AS total_volume
FROM trades_raw
WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
GROUP BY wallet, market_id
ORDER BY trade_count DESC
LIMIT 10`);

    if (tradeCounts.length > 0) {
      tradeCounts.forEach((row: any, idx: number) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${idx + 1}. ${walletName} | Market ${row.market_id.slice(0, 16)}... | ${row.trade_count} fills | $${row.total_volume.toFixed(2)} volume`);
      });
      console.log();
    }
  } catch (e: any) {
    console.error(`Debug 2 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 3: Check outcome_index consistency
  // ========================================================================
  try {
    console.log("🔍 DEBUG 3: Outcome Index Consistency Check\n");

    const outcomeMapping = await queryData(`
SELECT DISTINCT
  toString(outcome) AS outcome,
  cast(outcome_index AS Int16) AS outcome_index
FROM trades_raw
WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
  AND market_id IN (
    SELECT DISTINCT market_id
    FROM trades_raw
    WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
    LIMIT 5
  )
ORDER BY outcome_index
LIMIT 20`);

    if (outcomeMapping.length > 0) {
      const yesIndex = outcomeMapping.find((r: any) => r.outcome?.toUpperCase() === 'YES')?.outcome_index;
      const noIndex = outcomeMapping.find((r: any) => r.outcome?.toUpperCase() === 'NO')?.outcome_index;

      console.log(`  Outcome mappings found:`);
      outcomeMapping.forEach((row: any) => {
        console.log(`    "${row.outcome}" → index ${row.outcome_index}`);
      });

      if (yesIndex !== undefined && noIndex !== undefined) {
        if (yesIndex === 1 && noIndex === 0) {
          console.log(`\n  ✅ Standard binary mapping: NO=0, YES=1\n`);
        } else {
          console.log(`\n  ⚠️  Non-standard mapping detected! YES=${yesIndex}, NO=${noIndex}\n`);
        }
      }
    }
  } catch (e: any) {
    console.error(`Debug 3 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 4: Check bridge coverage gaps
  // ========================================================================
  try {
    console.log("🔍 DEBUG 4: Bridge Coverage Gaps\n");

    const gapsData = await queryData(`
SELECT
  m.market_id,
  cc.condition_id_norm,
  wi.win_idx,
  count() AS trade_count
FROM (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
) m
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
CROSS JOIN (
  SELECT count(*) AS trade_count
  FROM trades_raw tr
  WHERE lower(tr.market_id) = m.market_id
    AND lower(tr.wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
)
WHERE cc.condition_id_norm IS NULL OR wi.win_idx IS NULL
ORDER BY trade_count DESC
LIMIT 10`);

    if (gapsData.length > 0) {
      console.log(`  ⚠️  Found ${gapsData.length} markets with bridge gaps:`);
      gapsData.forEach((row: any, idx: number) => {
        const issue = !row.condition_id_norm ? 'No bridge' : 'Not resolved';
        console.log(`    ${idx + 1}. ${row.market_id.slice(0, 20)}... | ${issue} | ${row.trade_count} trades`);
      });
      console.log();
    } else {
      console.log(`  ✅ All markets have complete bridge coverage\n`);
    }
  } catch (e: any) {
    console.error(`Debug 4 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 5: Sample cashflow calculation
  // ========================================================================
  try {
    console.log("🔍 DEBUG 5: Sample Cashflow Calculation (First Market)\n");

    const sampleMarket = await queryData(`
SELECT market_id
FROM trades_raw
WHERE lower(wallet_address) = '${TARGET_WALLETS[0]}'
LIMIT 1`);

    if (sampleMarket.length > 0) {
      const marketId = sampleMarket[0].market_id;

      const cashflows = await queryData(`
SELECT
  toString(outcome) AS outcome,
  toString(side) AS side,
  cast(entry_price AS Float64) AS price,
  cast(shares AS Float64) AS shares,
  round(
    cast(entry_price AS Float64) * cast(shares AS Float64) *
    if(lowerUTF8(toString(side)) = 'buy', -1, 1),
    4
  ) AS cashflow
FROM trades_raw
WHERE lower(market_id) = lower('${marketId}')
  AND lower(wallet_address) = '${TARGET_WALLETS[0]}'
LIMIT 10`);

      console.log(`  Market: ${marketId.slice(0, 32)}...`);
      console.log(`  Sample fills:\n`);

      let totalCashflow = 0;
      cashflows.forEach((row: any, idx: number) => {
        console.log(`    ${idx + 1}. ${row.side.toUpperCase().padEnd(4)} ${row.shares.toFixed(2).padStart(10)} ${row.outcome.padEnd(6)} @ $${row.price.toFixed(4)} = ${row.cashflow >= 0 ? '+' : ''}$${row.cashflow.toFixed(2)}`);
        totalCashflow += parseFloat(row.cashflow);
      });

      console.log(`\n  Total cost basis (first 10 fills): $${totalCashflow.toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.error(`Debug 5 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 6: Compare aggregation methods
  // ========================================================================
  try {
    console.log("🔍 DEBUG 6: P&L Calculation Method Comparison\n");

    const methodA = await queryData(`
SELECT round(sum(realized_pnl_usd), 2) AS total_pnl
FROM realized_pnl_by_market_v2
WHERE wallet = '${TARGET_WALLETS[0]}'`);

    const methodB = await queryData(`
SELECT
  round(
    sum(cashflow_usdc) +
    sumIf(delta_shares, trade_idx = 1),
    2
  ) AS total_pnl_direct
FROM trade_flows_v2 tf
JOIN canonical_condition cc ON cc.market_id = tf.market_id
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm
WHERE tf.wallet = '${TARGET_WALLETS[0]}'
  AND wi.win_idx IS NOT NULL
  AND upperUTF8(tf.outcome_raw) IN ('YES', 'NO')`);

    console.log(`  Method A (via view):      $${methodA[0]?.total_pnl || 'N/A'}`);
    console.log(`  Method B (direct calc):   $${methodB[0]?.total_pnl_direct || 'N/A'}`);

    if (methodA[0] && methodB[0]) {
      const diff = Math.abs(methodA[0].total_pnl - methodB[0].total_pnl_direct);
      if (diff < 1) {
        console.log(`  ✅ Methods agree (diff: $${diff.toFixed(2)})\n`);
      } else {
        console.log(`  ⚠️  Methods disagree by $${diff.toFixed(2)}\n`);
      }
    }
  } catch (e: any) {
    console.error(`Debug 6 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 7: Check for NULL values in key fields
  // ========================================================================
  try {
    console.log("🔍 DEBUG 7: NULL Value Check in Key Fields\n");

    const nullCheck = await queryData(`
SELECT
  countIf(outcome_index IS NULL) AS null_outcome_index,
  countIf(entry_price IS NULL) AS null_price,
  countIf(shares IS NULL) AS null_shares,
  countIf(side IS NULL) AS null_side,
  count(*) AS total_trades
FROM trades_raw
WHERE lower(wallet_address) IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})`);

    if (nullCheck.length > 0) {
      const check = nullCheck[0];
      console.log(`  Total trades:           ${check.total_trades}`);
      console.log(`  NULL outcome_index:     ${check.null_outcome_index} ${check.null_outcome_index > 0 ? '⚠️' : '✅'}`);
      console.log(`  NULL entry_price:       ${check.null_price} ${check.null_price > 0 ? '⚠️' : '✅'}`);
      console.log(`  NULL shares:            ${check.null_shares} ${check.null_shares > 0 ? '⚠️' : '✅'}`);
      console.log(`  NULL side:              ${check.null_side} ${check.null_side > 0 ? '⚠️' : '✅'}`);
      console.log();

      if (check.null_outcome_index > 0 || check.null_price > 0 || check.null_shares > 0 || check.null_side > 0) {
        console.log(`  ⚠️  ACTION REQUIRED: Clean NULL values in trades_raw\n`);
      }
    }
  } catch (e: any) {
    console.error(`Debug 7 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 8: Top 5 most profitable markets
  // ========================================================================
  try {
    console.log("🔍 DEBUG 8: Top 5 Most Profitable Markets\n");

    const topMarkets = await queryData(`
SELECT
  wallet,
  substring(market_id, 1, 20) AS market_id_short,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
ORDER BY realized_pnl_usd DESC
LIMIT 5`);

    if (topMarkets.length > 0) {
      topMarkets.forEach((row: any, idx: number) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${idx + 1}. ${walletName} | ${row.market_id_short}... | +$${row.realized_pnl_usd.toFixed(2)} | ${row.fill_count} fills`);
      });
      console.log();
    }
  } catch (e: any) {
    console.error(`Debug 8 failed: ${e.message}\n`);
  }

  // ========================================================================
  // DEBUG 9: Top 5 biggest losses
  // ========================================================================
  try {
    console.log("🔍 DEBUG 9: Top 5 Biggest Losses\n");

    const worstMarkets = await queryData(`
SELECT
  wallet,
  substring(market_id, 1, 20) AS market_id_short,
  realized_pnl_usd,
  fill_count,
  resolved_at
FROM realized_pnl_by_market_v2
WHERE wallet IN (${TARGET_WALLETS.map(w => `'${w}'`).join(',')})
ORDER BY realized_pnl_usd ASC
LIMIT 5`);

    if (worstMarkets.length > 0) {
      worstMarkets.forEach((row: any, idx: number) => {
        const walletName = row.wallet.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`  ${idx + 1}. ${walletName} | ${row.market_id_short}... | $${row.realized_pnl_usd.toFixed(2)} | ${row.fill_count} fills`);
      });
      console.log();
    }
  } catch (e: any) {
    console.error(`Debug 9 failed: ${e.message}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ Debug Analysis Complete!");
  console.log("\nCommon Issues to Check:");
  console.log("  1. Duplicate trades → Deduplicate trades_raw");
  console.log("  2. Bridge coverage gaps → Fix canonical_condition or winning_index");
  console.log("  3. NULL values → Clean data in trades_raw");
  console.log("  4. Wrong outcome mapping → Verify outcome_index = 0 (NO), 1 (YES)");
  console.log("  5. Method disagreement → Check view logic");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
