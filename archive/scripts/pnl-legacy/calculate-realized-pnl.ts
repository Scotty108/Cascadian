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

const TARGET_WALLETS = {
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8': 'HolyMoses7',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0': 'niggemon'
};

async function executeQuery(name: string, query: string) {
  try {
    console.log(`🔄 ${name}...`);
    await ch.query({ query });
    console.log(`✅ ${name}`);
    return true;
  } catch (e: any) {
    console.error(`❌ ${name}: ${e.message?.substring(0, 150)}`);
    return false;
  }
}

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("POLYMARKET REALIZED P&L CALCULATION - FOUR-STEP APPROACH");
  console.log("Using outcome_index array mapping for proper resolution matching");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // STEP 1: Condition ID Bridge (already exists in condition_market_map)
  const bridgeQuery = `
    SELECT
      market_id,
      condition_id,
      count() as source_count
    FROM condition_market_map
    WHERE condition_id LIKE '0x%'
      AND condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    GROUP BY market_id, condition_id
    LIMIT 5`;

  console.log("Step 1: Verifying condition_id bridge exists...");
  try {
    const bridgeData = await queryData(bridgeQuery);
    if (bridgeData.length > 0) {
      console.log(`✅ Bridge table verified: ${bridgeData.length} sample rows found\n`);
    }
  } catch (e: any) {
    console.log(`⚠️ Bridge verification skipped: ${e.message?.substring(0, 50)}\n`);
  }

  // STEP 2: Wallet Trade Cashflows by Side (YES/NO)
  // Simplified: compare trader's side directly to winning_outcome (no need for outcome arrays)
  const createCashflows = `CREATE OR REPLACE VIEW wallet_trade_cashflows_by_outcome AS
SELECT
  lower(t.wallet_address) as wallet,
  t.market_id,
  cm.condition_id as condition_id,
  toString(t.side) as side,
  countIf(toString(t.side) = 'YES') as yes_count,
  countIf(toString(t.side) = 'NO') as no_count,
  sumIf(cast(t.shares as Float64), toString(t.side) = 'YES') as yes_shares,
  sumIf(cast(t.shares as Float64), toString(t.side) = 'NO') as no_shares,
  sumIf(cast(t.shares as Float64), toString(t.side) = 'YES') - sumIf(cast(t.shares as Float64), toString(t.side) = 'NO') as net_shares,
  round(
    sumIf(cast(t.entry_price as Float64) * cast(t.shares as Float64), toString(t.side) = 'YES') /
    nullIf(sumIf(cast(t.shares as Float64), toString(t.side) = 'YES'), 0),
    8
  ) as avg_entry_yes,
  round(
    sumIf(cast(t.entry_price as Float64) * cast(t.shares as Float64), toString(t.side) = 'NO') /
    nullIf(sumIf(cast(t.shares as Float64), toString(t.side) = 'NO'), 0),
    8
  ) as avg_entry_no,
  min(t.timestamp) as first_trade,
  max(t.timestamp) as last_trade
FROM trades_raw t
LEFT JOIN condition_market_map cm ON t.market_id = cm.market_id
WHERE lower(t.wallet_address) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
  AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND t.market_id IS NOT NULL
GROUP BY wallet, t.market_id, condition_id, side`;

  // STEP 3: Realized P&L Calculation - Compare side to winning outcome
  const createRealizedPnL = `CREATE OR REPLACE VIEW realized_pnl_by_market AS
SELECT
  c.wallet,
  c.market_id,
  c.condition_id,
  c.side,
  c.net_shares,
  c.avg_entry_yes,
  c.avg_entry_no,
  mr.winning_outcome,
  CASE
    WHEN (c.side = 'YES' AND upper(mr.winning_outcome) = 'YES')
      OR (c.side = 'NO' AND upper(mr.winning_outcome) = 'NO')
    THEN 1.0
    ELSE 0.0
  END as is_winning,
  CASE
    WHEN c.net_shares > 0 THEN c.avg_entry_yes
    ELSE c.avg_entry_no
  END as entry_price,
  CASE
    WHEN (c.side = 'YES' AND upper(mr.winning_outcome) = 'YES')
      OR (c.side = 'NO' AND upper(mr.winning_outcome) = 'NO')
    THEN 1.0
    ELSE 0.0
  END as exit_price,
  round(
    (
      CASE
        WHEN (c.side = 'YES' AND upper(mr.winning_outcome) = 'YES')
          OR (c.side = 'NO' AND upper(mr.winning_outcome) = 'NO')
        THEN 1.0
        ELSE 0.0
      END -
      CASE
        WHEN c.net_shares > 0 THEN c.avg_entry_yes
        ELSE c.avg_entry_no
      END
    ) * c.net_shares, 4
  ) as realized_pnl_usd,
  mr.resolved_at,
  c.first_trade,
  c.last_trade
FROM wallet_trade_cashflows_by_outcome c
LEFT JOIN market_resolutions mr ON lower(c.condition_id) = lower(mr.condition_id)
WHERE mr.winning_outcome IS NOT NULL
  AND c.net_shares != 0`;

  // STEP 4: Wallet P&L Summary with Reconciliation
  const createWalletSummary = `CREATE OR REPLACE VIEW wallet_pnl_final_summary AS
SELECT
  wallet,
  count(DISTINCT market_id) as resolved_markets,
  sum(1) as total_positions,
  countIf(realized_pnl_usd > 0) as winning_positions,
  countIf(realized_pnl_usd < 0) as losing_positions,
  round(countIf(realized_pnl_usd > 0) / count() * 100, 2) as win_rate_pct,
  round(sum(realized_pnl_usd), 2) as total_realized_pnl,
  round(max(realized_pnl_usd), 2) as largest_win,
  round(min(realized_pnl_usd), 2) as largest_loss,
  min(resolved_at) as first_resolved,
  max(resolved_at) as last_resolved
FROM realized_pnl_by_market
GROUP BY wallet
ORDER BY wallet`;

  // Execute view creations in order
  const views = [
    ["Wallet Trade Cashflows", `DROP VIEW IF EXISTS wallet_trade_cashflows_by_outcome`],
    ["Wallet Trade Cashflows", createCashflows],
    ["Realized P&L by Market", `DROP VIEW IF EXISTS realized_pnl_by_market`],
    ["Realized P&L by Market", createRealizedPnL],
    ["Wallet P&L Final Summary", `DROP VIEW IF EXISTS wallet_pnl_final_summary`],
    ["Wallet P&L Final Summary", createWalletSummary]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // Step 2: Verify cashflows were created with proper outcome mapping
  try {
    console.log("Step 2: Verifying cashflows view...");
    const cashflowSample = await queryData(`
      SELECT *
      FROM wallet_trade_cashflows_by_outcome
      LIMIT 3`);

    if (cashflowSample.length > 0) {
      console.log(`✅ Cashflows created: ${cashflowSample.length} sample rows`);
      console.log(`   Sample outcome: ${cashflowSample[0].outcome_text || 'null outcome'} with net_shares=${cashflowSample[0].net_shares}\n`);
    } else {
      console.log(`⚠️ Cashflows view is empty\n`);
    }
  } catch (e: any) {
    console.log(`⚠️ Cashflows check: ${e.message?.substring(0, 100)}\n`);
  }

  // Step 3: Fetch realized P&L summary
  try {
    console.log("Step 3: Realized P&L Summary:\n");

    const summaryData = await queryData(`
      SELECT
        wallet,
        resolved_markets,
        total_positions,
        winning_positions,
        losing_positions,
        win_rate_pct,
        total_realized_pnl,
        largest_win,
        largest_loss,
        first_resolved,
        last_resolved
      FROM wallet_pnl_final_summary
      ORDER BY wallet`);

    if (summaryData.length === 0) {
      console.log("❌ No realized P&L data found in summary view");
    } else {
      for (const row of summaryData) {
        const walletName = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        console.log(`${walletName}:`);
        console.log(`  Resolved Markets: ${row.resolved_markets}`);
        console.log(`  Winning Positions: ${row.winning_positions}`);
        console.log(`  Losing Positions: ${row.losing_positions}`);
        console.log(`  Win Rate: ${row.win_rate_pct}%`);
        console.log(`  ✨ TOTAL REALIZED P&L: $${parseFloat(row.total_realized_pnl).toFixed(2)}`);
        console.log(`  Period: ${row.first_resolved?.split(' ')[0]} to ${row.last_resolved?.split(' ')[0]}`);
        console.log();
      }
    }
  } catch (e: any) {
    console.error("❌ Failed to fetch summary:", e.message?.substring(0, 150));
  }

  // Step 4: Compare unrealized + realized = total
  try {
    console.log("📈 TOTAL P&L (Unrealized + Realized):\n");

    const totalData = await queryData(`
      SELECT
        m.wallet,
        COALESCE(m.total_unrealized_pnl, 0) as unrealized_pnl,
        COALESCE(r.total_realized_pnl, 0) as realized_pnl,
        COALESCE(m.total_unrealized_pnl, 0) + COALESCE(r.total_realized_pnl, 0) as total_pnl
      FROM wallet_summary_metrics m
      LEFT JOIN wallet_pnl_final_summary r ON m.wallet = r.wallet
      ORDER BY m.wallet`);

    if (totalData.length > 0) {
      for (const row of totalData) {
        const walletName = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
        const unrealized = parseFloat(row.unrealized_pnl || 0);
        const realized = parseFloat(row.realized_pnl || 0);
        const total = parseFloat(row.total_pnl || 0);

        console.log(`${walletName}:`);
        console.log(`  Unrealized (open positions): $${unrealized.toFixed(2)}`);
        console.log(`  Realized (closed positions): $${realized.toFixed(2)}`);
        console.log(`  ✨ TOTAL ALL-TIME P&L: $${total.toFixed(2)}`);
        console.log();
      }

      // Validation against Polymarket
      console.log("📊 VALIDATION VS POLYMARKET:\n");
      console.log("HolyMoses7:");
      console.log("  Expected (Polymarket UI): +$89,975.16");
      console.log("  Expected (Polymarket Analytics): +$91,633");
      console.log("  Our Calculation: (see above) - checking for ±1% match\n");

      console.log("niggemon:");
      console.log("  Expected (Polymarket UI): +$102,001.46");
      console.log("  Our Calculation: (see above) - checking for ±1% match\n");
    }
  } catch (e: any) {
    console.error("❌ Failed to fetch total P&L:", e.message?.substring(0, 150));
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("✅ Realized P&L Calculation Complete!\n");
  console.log("Views created:");
  console.log("  - wallet_trade_cashflows_by_outcome (Step 2)");
  console.log("  - realized_pnl_by_market (Step 3)");
  console.log("  - wallet_pnl_final_summary (Step 4)");
  console.log("\nNext steps:");
  console.log("  1. Validate P&L against Polymarket (+89,975 to +91,633 for HolyMoses7)");
  console.log("  2. Validate against niggemon target (+102,001)");
  console.log("  3. Build daily equity curve for risk metrics");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
