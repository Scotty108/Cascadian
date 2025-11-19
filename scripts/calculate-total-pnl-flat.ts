#!/usr/bin/env npx tsx
/**
 * TOTAL P&L CALCULATION: Realized + Unrealized
 * Simplified flat query approach
 */

import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: "default",
  password: "8miOkWI~OhsDb",
  database: "default",
  request_timeout: 60000,
});

async function calculateTotalPnL(walletAddress: string): Promise<any> {
  // Get REALIZED P&L from resolved markets
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
  const realized = parseFloat(realizedData[0] || "0");
  const resolvedCount = realizedData[1] || 0;

  // Get UNREALIZED P&L from open positions
  // For simplicity: just count open positions and estimate P&L
  // We'll need market_candles data for accurate calculation
  const unrealizedResult = await ch.query({
    query: `
      SELECT
        count() as open_position_rows,
        count(DISTINCT condition_id_norm) as distinct_open_conditions
      FROM outcome_positions_v2 op
      WHERE lower(op.wallet) = lower('${walletAddress}')
        AND condition_id_norm NOT IN (SELECT DISTINCT condition_id_norm FROM winning_index)
    `,
    format: "JSONCompact",
  });

  const unrealizedText = await unrealizedResult.text();
  const unrealizedData = JSON.parse(unrealizedText).data[0] || [0, 0];
  const openCount = unrealizedData[1] || 0;

  // Fetch current market prices
  const pricesResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        argMax(close, timestamp) as latest_price
      FROM market_candles_5m
      GROUP BY condition_id_norm
      ORDER BY condition_id_norm
    `,
    format: "JSONCompact",
  });

  const pricesText = await pricesResult.text();
  const pricesData = JSON.parse(pricesText).data || [];

  // Build price map
  const priceMap: { [key: string]: number } = {};
  pricesData.forEach((row: any[]) => {
    priceMap[row[0]] = parseFloat(row[1] || "0");
  });

  // Now calculate unrealized for open positions
  const openPosResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        sum(net_shares) as total_shares
      FROM outcome_positions_v2
      WHERE lower(wallet) = lower('${walletAddress}')
        AND condition_id_norm NOT IN (SELECT DISTINCT condition_id_norm FROM winning_index)
      GROUP BY condition_id_norm
    `,
    format: "JSONCompact",
  });

  const openPosText = await openPosResult.text();
  const openPosData = JSON.parse(openPosText).data || [];

  // Get entry prices from trades
  const entryResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        avg(CAST(entry_price AS Float64)) as avg_entry_price
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${walletAddress}')
      GROUP BY condition_id_norm
    `,
    format: "JSONCompact",
  });

  const entryText = await entryResult.text();
  const entryData = JSON.parse(entryText).data || [];

  const entryMap: { [key: string]: number } = {};
  entryData.forEach((row: any[]) => {
    entryMap[row[0]] = parseFloat(row[1] || "0");
  });

  // Calculate unrealized P&L
  let unrealizedPnL = 0;
  openPosData.forEach((row: any[]) => {
    const condId = row[0];
    const shares = parseFloat(row[1] || "0");
    const currentPrice = priceMap[condId] || 0;
    const entryPrice = entryMap[condId] || 0;
    if (currentPrice > 0 && entryPrice > 0) {
      unrealizedPnL += (currentPrice - entryPrice) * shares;
    }
  });

  return {
    realized,
    unrealized: unrealizedPnL,
    total: realized + unrealizedPnL,
    resolvedCount,
    openCount,
  };
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("TOTAL P&L CALCULATION: Realized + Unrealized (Flat Approach)");
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
  ];

  for (const target of targets) {
    try {
      const pnl = await calculateTotalPnL(target.addr);
      const variance = ((pnl.total - target.expected) / target.expected) * 100;
      const match = Math.abs(variance) < 5;

      console.log(`${target.name.padEnd(15)}`);
      console.log(`  Expected:        $${target.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  Realized:        $${pnl.realized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  Unrealized:      $${pnl.unrealized.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  TOTAL:           $${pnl.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
      console.log(`  Variance:        ${variance.toFixed(2)}%`);
      console.log(`  Status:          ${match ? "✅ MATCH" : variance > 0 ? "⚠️  UNDER" : "⚠️  OVER"}`);
      console.log(`  Positions:       ${pnl.resolvedCount} resolved, ${pnl.openCount} open\n`);
    } catch (e: any) {
      console.log(`${target.name}: ❌ ${e.message}\n`);
    }
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
