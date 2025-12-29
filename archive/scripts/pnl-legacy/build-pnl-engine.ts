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
  console.log("POLYMARKET P&L ENGINE BUILDER");
  console.log("Phase 1: HolyMoses7 + niggemon");
  console.log("════════════════════════════════════════════════════════════════════\n");

  const views = [
    [
      "Positions View",
      `DROP VIEW IF EXISTS wallet_positions_detailed`
    ],
    [
      "Create Positions View",
      `CREATE VIEW wallet_positions_detailed AS
SELECT
  lower(wallet_address) as wallet,
  market_id,
  outcome,
  outcome_index,
  count() as trade_count,
  sumIf(cast(shares as Float64), side='YES') as yes_shares,
  sumIf(cast(shares as Float64), side='NO') as no_shares,
  sumIf(cast(shares as Float64), side='YES') - sumIf(cast(shares as Float64), side='NO') as net_shares,
  round(
    sumIf(cast(entry_price as Float64) * cast(shares as Float64), side='YES') /
    nullIf(sumIf(cast(shares as Float64), side='YES'), 0),
    8
  ) as avg_entry_yes,
  round(
    sumIf(cast(entry_price as Float64) * cast(shares as Float64), side='NO') /
    nullIf(sumIf(cast(shares as Float64), side='NO'), 0),
    8
  ) as avg_entry_no,
  minIf(timestamp, side='YES') as first_buy,
  maxIf(timestamp, side='NO') as last_sell,
  sum(cast(usd_value as Float64)) as total_notional_usd
FROM trades_raw
WHERE lower(wallet_address) IN ('${TARGET_WALLETS[0].toLowerCase()}','${TARGET_WALLETS[1].toLowerCase()}')
  AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND market_id IS NOT NULL
  AND market_id != ''
GROUP BY wallet_address, market_id, outcome, outcome_index
HAVING net_shares != 0`
    ],
    [
      "Mark-to-Market View",
      `DROP VIEW IF EXISTS portfolio_mtm_detailed`
    ],
    [
      "Create Mark-to-Market View",
      `CREATE VIEW portfolio_mtm_detailed AS
SELECT
  p.wallet,
  p.market_id,
  p.outcome,
  p.outcome_index,
  p.trade_count,
  p.net_shares,
  CASE WHEN p.net_shares > 0 THEN p.avg_entry_yes ELSE p.avg_entry_no END as avg_entry_price,
  l.last_price,
  round(
    (cast(l.last_price as Float64) -
     (CASE WHEN p.net_shares > 0 THEN cast(p.avg_entry_yes as Float64) ELSE cast(p.avg_entry_no as Float64) END)) *
    cast(p.net_shares as Float64),
    4
  ) as unrealized_pnl_usd,
  p.total_notional_usd,
  p.first_buy,
  p.last_sell
FROM wallet_positions_detailed p
LEFT JOIN market_last_price l ON p.market_id = l.market_id`
    ],
    [
      "Wallet Summary View",
      `DROP VIEW IF EXISTS wallet_summary_metrics`
    ],
    [
      "Create Wallet Summary View",
      `CREATE VIEW wallet_summary_metrics AS
SELECT
  wallet,
  count(DISTINCT market_id) as markets_traded,
  sum(trade_count) as total_trades,
  countIf(net_shares > 0) as long_positions,
  countIf(net_shares < 0) as short_positions,
  round(sum(cast(unrealized_pnl_usd as Float64)), 2) as total_unrealized_pnl,
  round(sum(cast(total_notional_usd as Float64)), 2) as total_notional_usd,
  countIf(unrealized_pnl_usd > 0) as winning_positions,
  countIf(unrealized_pnl_usd < 0) as losing_positions,
  round(countIf(unrealized_pnl_usd > 0) / count() * 100, 2) as win_rate_pct,
  round(max(cast(unrealized_pnl_usd as Float64)), 2) as largest_win,
  round(min(cast(unrealized_pnl_usd as Float64)), 2) as largest_loss,
  min(first_buy) as first_trade_date,
  max(last_sell) as last_trade_date
FROM portfolio_mtm_detailed
GROUP BY wallet`
    ]
  ];

  let successCount = 0;
  for (const [name, query] of views) {
    if (await executeQuery(name, query)) {
      successCount++;
    }
  }

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  console.log(`View Creation: ${successCount}/${views.length} successful\n`);

  // Fetch summary stats
  try {
    console.log("📊 P&L Summary for Target Wallets:\n");

    const summaryQuery = `
      SELECT
        wallet,
        markets_traded,
        total_trades,
        long_positions,
        short_positions,
        total_unrealized_pnl,
        total_notional_usd,
        win_rate_pct,
        largest_win,
        largest_loss,
        first_trade_date,
        last_trade_date
      FROM wallet_summary_metrics
      ORDER BY wallet`;

    const result = await ch.query({ query: summaryQuery, format: 'JSON' });
    const text = await result.text();
    const data = JSON.parse(text);

    for (const row of data.data || []) {
      const walletName = row.wallet?.startsWith('0xa4b3') ? 'HolyMoses7' : 'niggemon';
      console.log(`${walletName}:`);
      console.log(`  Markets: ${row.markets_traded} | Trades: ${row.total_trades}`);
      console.log(`  Long: ${row.long_positions} | Short: ${row.short_positions}`);
      console.log(`  Unrealized PnL: $${parseFloat(row.total_unrealized_pnl).toFixed(2)}`);
      console.log(`  Total Notional: $${parseFloat(row.total_notional_usd).toFixed(2)}`);
      console.log(`  Win Rate: ${row.win_rate_pct}%`);
      console.log(`  Best Trade: $${parseFloat(row.largest_win).toFixed(2)} | Worst: $${parseFloat(row.largest_loss).toFixed(2)}`);
      console.log(`  Period: ${row.first_trade_date?.split(' ')[0]} to ${row.last_trade_date?.split(' ')[0]}`);
      console.log();
    }
  } catch (e: any) {
    console.error("Failed to fetch summary:", e.message?.substring(0, 100));
  }

  console.log("════════════════════════════════════════════════════════════════════");
  console.log("\n✅ P&L Engine Views Created!\n");
  console.log("Next Steps:");
  console.log("  1. Build realized PnL view for resolved markets");
  console.log("  2. Aggregate category PnL");
  console.log("  3. Verify position reconciliation vs ERC-1155");
  console.log("  4. Compute daily equity curve for Omega ratio");
  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
