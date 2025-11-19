#!/usr/bin/env npx tsx
/**
 * TOTAL P&L CALCULATION: Realized + Unrealized
 *
 * This script calculates complete portfolio P&L by combining:
 * 1. REALIZED P&L: from resolved markets (closed positions)
 * 2. UNREALIZED P&L: current value of open positions using latest market prices
 *
 * Total P&L = Realized P&L + Unrealized P&L
 *
 * This matches what users see in Polymarket UI (entire portfolio value)
 */

import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

interface WalletPnL {
  wallet: string;
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  resolvedTrades: number;
  openTrades: number;
}

async function calculateTotalPnL(walletAddress: string): Promise<WalletPnL> {
  // Step 1: Get Realized P&L from resolved markets
  const realizedResult = await ch.query({
    query: `
      SELECT
        sum(CAST(cf.cashflow_usdc AS Float64)) as realized_pnl,
        count(DISTINCT cf.condition_id_norm) as resolved_count
      FROM trade_cashflows_v3 cf
      INNER JOIN winning_index wi ON cf.condition_id_norm = wi.condition_id_norm
      WHERE lower(cf.wallet) = lower('${walletAddress}')
    `,
    format: "JSONCompact",
  });

  const realizedText = await realizedResult.text();
  const realizedData = JSON.parse(realizedText).data[0] || [0, 0];
  const realizedPnL = parseFloat(realizedData[0] || "0");
  const resolvedCount = realizedData[1] || 0;

  // Step 2: Get Unrealized P&L from open positions
  // For each open position: value = (current_price - entry_price) × shares
  const unrealizedResult = await ch.query({
    query: `
      WITH open_positions AS (
        -- Get all unresolved positions
        SELECT
          op.wallet,
          op.condition_id_norm,
          op.outcome_idx,
          sum(op.net_shares) as total_shares
        FROM outcome_positions_v2 op
        LEFT JOIN winning_index wi ON op.condition_id_norm = wi.condition_id_norm
        WHERE lower(op.wallet) = lower('${walletAddress}')
          AND wi.condition_id_norm IS NULL  -- Unresolved markets only
        GROUP BY op.wallet, op.condition_id_norm, op.outcome_idx
      ),
      latest_prices AS (
        -- Get latest market price for each condition (using row_number to get latest)
        SELECT
          condition_id_norm,
          argMax(close, timestamp) as current_price
        FROM market_candles_5m
        GROUP BY condition_id_norm
      ),
      entry_prices AS (
        -- Get entry price from trades
        SELECT
          condition_id_norm,
          avg(CAST(entry_price AS Float64)) as avg_entry_price
        FROM trades_raw
        WHERE lower(wallet_address) = lower('${walletAddress}')
        GROUP BY condition_id_norm
      )
      SELECT
        sum(
          (CAST(lp.current_price AS Float64) - CAST(ep.avg_entry_price AS Float64)) * op.total_shares
        ) as unrealized_pnl,
        count(DISTINCT op.condition_id_norm) as open_count
      FROM open_positions op
      LEFT JOIN latest_prices lp ON op.condition_id_norm = lp.condition_id_norm
      LEFT JOIN entry_prices ep ON op.condition_id_norm = ep.condition_id_norm
      WHERE lp.current_price IS NOT NULL  -- Only if we have price data
    `,
    format: "JSONCompact",
  });

  const unrealizedText = await unrealizedResult.text();
  const unrealizedData = JSON.parse(unrealizedText).data[0] || [0, 0];
  const unrealizedPnL = parseFloat(unrealizedData[0] || "0");
  const openCount = unrealizedData[1] || 0;

  const totalPnL = realizedPnL + unrealizedPnL;

  return {
    wallet: walletAddress,
    realizedPnL,
    unrealizedPnL,
    totalPnL,
    resolvedTrades: resolvedCount,
    openTrades: openCount,
  };
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TOTAL P&L CALCULATION: Realized + Unrealized");
  console.log("════════════════════════════════════════════════════════════════\n");

  const targets = [
    {
      addr: "0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0",
      name: "niggemon",
      expected: 102001.46,
    },
    {
      addr: "0xa4b366ad22fc0d06f1e934ff468e8922431a87b8",
      name: "HolyMoses7",
      expected: 89975.16,
    },
    {
      addr: "0x7f3c8979d0afa00007bae4747d5347122af05613",
      name: "LucasMeow",
      expected: 179243,
    },
    {
      addr: "0x1234567890abcdef1234567890abcdef12345678",
      name: "xcnstrategy",
      expected: 94730,
    },
  ];

  for (const target of targets) {
    try {
      const pnl = await calculateTotalPnL(target.addr);

      const variance = ((pnl.totalPnL - target.expected) / target.expected) * 100;
      const match = Math.abs(variance) < 5;

      console.log(`${target.name.padEnd(15)}`);
      console.log(`  Expected:        $${target.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  ├─ Realized:     $${pnl.realizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  ├─ Unrealized:   $${pnl.unrealizedPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  └─ TOTAL:        $${pnl.totalPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  Variance:        ${variance.toFixed(2)}%`);
      console.log(`  Status:          ${match ? "✅ MATCH" : variance > 0 ? "⚠️  UNDER" : "⚠️  OVER"}`);
      console.log(`  Positions:       ${pnl.resolvedTrades} resolved, ${pnl.openTrades} open\n`);
    } catch (e: any) {
      console.log(`${target.name}: ❌ ${e.message}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
  console.log("INTERPRETATION:");
  console.log("- If variance < 5% → Formula is correct, proceed to production");
  console.log("- If variance > 5% → Need to adjust entry_price calculation or price source\n");
}

main().catch(console.error);
