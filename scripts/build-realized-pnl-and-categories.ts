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

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("POLYMARKET REALIZED PNL & CATEGORY BUILDER");
  console.log("Phase 2: Resolved positions and category aggregation");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // Create realized PnL view for resolved markets
  const createRealizedPnL = `CREATE VIEW realized_pnl_by_market AS
SELECT
  lower(wallet_address) as wallet,
  market_id,
  outcome,
  outcome_index,
  condition_id,
  count() as trade_count,
  sum(cast(shares as Float64)) as total_shares,
  round(
    sum(CASE WHEN side='YES' THEN cast(entry_price as Float64) * cast(shares as Float64) ELSE 0 END) /
    nullIf(sum(CASE WHEN side='YES' THEN cast(shares as Float64) ELSE 0 END), 0),
    8
  ) as avg_yes_price,
  round(
    sum(CASE WHEN side='NO' THEN cast(entry_price as Float64) * cast(shares as Float64) ELSE 0 END) /
    nullIf(sum(CASE WHEN side='NO' THEN cast(shares as Float64) ELSE 0 END), 0),
    8
  ) as avg_no_price
FROM trades_raw
WHERE lower(wallet_address) IN ('${TARGET_WALLETS[0].toLowerCase()}','${TARGET_WALLETS[1].toLowerCase()}')
  AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND market_id IS NOT NULL
  AND is_closed = 1
GROUP BY wallet_address, market_id, outcome, outcome_index, condition_id`;

  // Create category PnL aggregation
  const createCategoryPnL = `CREATE VIEW portfolio_category_summary AS
SELECT
  p.wallet,
  COALESCE(m.category, 'UNCATEGORIZED') as category,
  count(DISTINCT p.market_id) as markets_in_category,
  sum(p.trade_count) as total_trades,
  round(sum(cast(p.unrealized_pnl_usd as Float64)), 2) as unrealized_pnl_usd,
  round(sum(cast(p.total_notional_usd as Float64)), 2) as notional_usd,
  countIf(p.unrealized_pnl_usd > 0) as winning_positions,
  countIf(p.unrealized_pnl_usd < 0) as losing_positions,
  round(countIf(p.unrealized_pnl_usd > 0) / count() * 100, 2) as win_rate_pct,
  round(max(cast(p.unrealized_pnl_usd as Float64)), 2) as largest_win,
  round(min(cast(p.unrealized_pnl_usd as Float64)), 2) as largest_loss
FROM portfolio_mtm_detailed p
LEFT JOIN market_metadata m ON p.market_id = m.market_id
GROUP BY wallet, category
ORDER BY wallet, unrealized_pnl_usd DESC`;

  // Create position reconciliation view
  const createReconciliation = `CREATE VIEW position_reconciliation AS
SELECT
  t.wallet_address as wallet,
  t.market_id,
  t.outcome,
  t.outcome_index,
  count() as trade_count,
  sum(cast(t.shares as Float64)) as net_shares_from_trades,
  COALESCE(e.net_erc1155, 0) as net_shares_from_erc1155,
  CASE WHEN abs(sum(cast(t.shares as Float64)) - COALESCE(e.net_erc1155, 0)) < 0.01 THEN 'RECONCILED' ELSE 'MISMATCH' END as status,
  abs(sum(cast(t.shares as Float64)) - COALESCE(e.net_erc1155, 0)) as delta
FROM trades_raw t
LEFT JOIN (
  SELECT
    wallet,
    market_id,
    outcome_index,
    sum(cast(net_transfer as Float64)) as net_erc1155
  FROM (
    SELECT
      lower(from_address) as wallet,
      market_id,
      outcome_index,
      cast(value as Float64) as net_transfer
    FROM pm_erc1155_transfers
    WHERE from_address NOT IN (
      '0x0000000000000000000000000000000000000000',
      '0xaaa2945ecc5797262f5f2290c8c5b5fc62abb6c5'
    )
    UNION ALL
    SELECT
      lower(to_address) as wallet,
      market_id,
      outcome_index,
      -cast(value as Float64) as net_transfer
    FROM pm_erc1155_transfers
    WHERE to_address NOT IN (
      '0x0000000000000000000000000000000000000000',
      '0xaaa2945ecc5797262f5f2290c8c5b5fc62abb6c5'
    )
  )
  GROUP BY wallet, market_id, outcome_index
) e ON lower(t.wallet_address) = e.wallet AND t.market_id = e.market_id AND t.outcome_index = e.outcome_index
WHERE lower(t.wallet_address) IN ('${TARGET_WALLETS[0].toLowerCase()}','${TARGET_WALLETS[1].toLowerCase()}')
  AND t.market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
GROUP BY wallet_address, market_id, outcome, outcome_index, e.net_erc1155
HAVING net_shares_from_trades > 0 OR net_shares_from_erc1155 > 0`;

  // Execute view creations
  const views = [
    ["Realized PnL by Market", `DROP VIEW IF EXISTS realized_pnl_by_market`],
    ["Realized PnL by Market", createRealizedPnL],
    ["Category PnL Summary", `DROP VIEW IF EXISTS portfolio_category_summary`],
    ["Category PnL Summary", createCategoryPnL],
    ["Position Reconciliation", `DROP VIEW IF EXISTS position_reconciliation`],
    ["Position Reconciliation", createReconciliation]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // Query category summaries
  try {
    console.log("📊 P&L by Category:\n");

    const categoryQuery = `
      SELECT
        wallet,
        category,
        markets_in_category,
        total_trades,
        unrealized_pnl_usd,
        notional_usd,
        winning_positions,
        losing_positions,
        win_rate_pct
      FROM portfolio_category_summary
      ORDER BY wallet, unrealized_pnl_usd DESC
      LIMIT 20`;

    const result = await ch.query({ query: categoryQuery, format: 'JSON' });
    const text = await result.text();
    const data = JSON.parse(text);

    let currentWallet = '';
    for (const row of data.data || []) {
      const walletName = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';

      if (currentWallet !== walletName) {
        currentWallet = walletName;
        console.log(`\n${walletName}:`);
      }

      console.log(`  ${row.category || 'UNCATEGORIZED'}`);
      console.log(`    Markets: ${row.markets_in_category} | Trades: ${row.total_trades}`);
      console.log(`    PnL: $${parseFloat(row.unrealized_pnl_usd).toFixed(2)} | Exposure: $${parseFloat(row.notional_usd).toFixed(2)}`);
      console.log(`    Win: ${row.winning_positions} | Loss: ${row.losing_positions} | Rate: ${row.win_rate_pct}%`);
    }
  } catch (e: any) {
    console.error("Failed to fetch categories:", e.message?.substring(0, 100));
  }

  // Query reconciliation stats
  try {
    console.log("\n\n🔍 Position Reconciliation Status:\n");

    const reconQuery = `
      SELECT
        wallet,
        status,
        count() as position_count,
        sum(CASE WHEN status = 'MISMATCH' THEN delta ELSE 0 END) as total_delta
      FROM position_reconciliation
      GROUP BY wallet, status
      ORDER BY wallet, status`;

    const result = await ch.query({ query: reconQuery, format: 'JSON' });
    const text = await result.text();
    const data = JSON.parse(text);

    let currentWallet = '';
    for (const row of data.data || []) {
      const walletName = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';

      if (currentWallet !== walletName) {
        currentWallet = walletName;
        console.log(`\n${walletName}:`);
      }

      console.log(`  ${row.status}: ${row.position_count} positions | Delta: ${parseFloat(row.total_delta || 0).toFixed(2)}`);
    }
  } catch (e: any) {
    console.error("Failed to fetch reconciliation:", e.message?.substring(0, 100));
  }

  console.log("\n\n════════════════════════════════════════════════════════════════════");
  console.log("✅ Category & Reconciliation Views Built!\n");
  console.log("Next Steps:");
  console.log("  1. Sample 10 markets per wallet with payout checks");
  console.log("  2. Build daily equity curve for risk metrics");
  console.log("  3. Compute Omega ratio, Sharpe, Sortino, max drawdown");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
