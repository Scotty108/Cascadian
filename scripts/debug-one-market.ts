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
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  const wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';

  console.log("\n📊 DETAILED MARKET BREAKDOWN FOR ONE MARKET\n");

  // Get one market where this wallet has a position
  try {
    const marketList = await queryData(`
      SELECT DISTINCT
        market_id,
        condition_id_norm,
        outcome_idx,
        net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet}')
      LIMIT 1
    `);

    if (marketList.length === 0) {
      console.log("No positions found");
      return;
    }

    const market = marketList[0];
    console.log(`Market: ${market.market_id}`);
    console.log(`Condition: ${market.condition_id_norm}`);
    console.log(`Outcome: ${market.outcome_idx}`);
    console.log(`Net Shares: ${market.net_shares}\n`);

    // Get all positions in this market
    const positions = await queryData(`
      SELECT 
        outcome_idx,
        net_shares
      FROM outcome_positions_v2
      WHERE wallet = lower('${wallet}')
        AND market_id = '${market.market_id}'
      ORDER BY outcome_idx
    `);

    console.log("All positions in this market:");
    console.log(JSON.stringify(positions, null, 2));

    // Get all cashflows
    const cashflows = await queryData(`
      SELECT 
        outcome_idx,
        sum(cashflow_usdc) as total_cashflow
      FROM trade_cashflows_v3
      WHERE wallet = lower('${wallet}')
        AND market_id = '${market.market_id}'
      GROUP BY outcome_idx
      ORDER BY outcome_idx
    `);

    console.log("\nCashflows by outcome:");
    console.log(JSON.stringify(cashflows, null, 2));

    // Get winning outcome
    const winning = await queryData(`
      SELECT win_idx FROM winning_index
      WHERE condition_id_norm = '${market.condition_id_norm}'
    `);

    console.log(`\nWinning outcome index: ${winning[0]?.win_idx || 'NOT FOUND'}`);

    // Calculate PnL manually
    const winIdx = winning[0]?.win_idx;
    const winPos = positions.find((p: any) => p.outcome_idx == winIdx);
    const totalCashflow = cashflows.reduce((sum: number, cf: any) => sum + (cf.total_cashflow || 0), 0);

    console.log(`\nManual PnL calculation:`);
    console.log(`  Winning shares: ${winPos?.net_shares || 0}`);
    console.log(`  Total cashflow: ${totalCashflow}`);
    console.log(`  PnL = ${winPos?.net_shares || 0} - ${totalCashflow} = ${(winPos?.net_shares || 0) - totalCashflow}`);

  } catch (e: any) {
    console.error("Error:", e.message?.substring(0, 200));
  }
}

main().catch(console.error);
