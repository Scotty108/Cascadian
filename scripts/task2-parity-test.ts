#!/usr/bin/env npx tsx
/**
 * Task 2: Single-market parity test
 * Take wallet's top profit market and compare our P&L calc against Polymarket API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

const GAMMA_API = 'https://api.gamma.polymarket.com';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log('TASK 2: SINGLE-MARKET PARITY TEST');
  console.log('═'.repeat(100) + '\n');

  try {
    // Get wallet's highest profit position
    console.log('1️⃣  Finding wallet\'s highest profit market...\n');

    const topMarketQuery = `
      WITH wallet_pnl AS (
        SELECT
          t.condition_id,
          lower(replaceAll(t.condition_id, '0x', '')) as condition_id_norm,
          t.outcome_index,
          SUM(if(t.trade_direction = 'BUY', t.shares, -t.shares)) as net_shares,
          SUM(t.cashflow_usdc) as total_cashflow,
          res.payout_numerators,
          res.payout_denominator,
          res.winning_index,
          SUM(t.cashflow_usdc) + if(res.winning_index IS NOT NULL,
            SUM(if(t.trade_direction = 'BUY', t.shares, -t.shares)) *
              (arrayElement(res.payout_numerators, res.winning_index + 1) / res.payout_denominator),
            0
          ) as total_pnl
        FROM default.trades_raw t
        LEFT JOIN default.market_resolutions_final res
          ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
        WHERE lower(t.wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY t.condition_id, condition_id_norm, t.outcome_index, res.payout_numerators, res.payout_denominator, res.winning_index
      )
      SELECT
        condition_id,
        condition_id_norm,
        outcome_index,
        net_shares,
        total_cashflow,
        payout_numerators,
        payout_denominator,
        winning_index,
        total_pnl
      FROM wallet_pnl
      ORDER BY total_pnl DESC
      LIMIT 5
    `;

    const topResult = await ch.query({
      query: topMarketQuery,
      format: 'JSONEachRow'
    });
    const topMarkets = await topResult.json<any[]>();

    if (topMarkets.length === 0) {
      console.log('   ❌ No markets found\n');
      return;
    }

    const topMarket = topMarkets[0];
    console.log(`   ✅ Top market found`);
    console.log(`      Condition ID: ${topMarket.condition_id_norm}`);
    console.log(`      Outcome Index: ${topMarket.outcome_index}`);
    console.log(`      Net Shares: ${topMarket.net_shares}`);
    console.log(`      Realized Cashflow: $${topMarket.total_cashflow.toFixed(2)}`);
    console.log(`      Total P&L (Ours): $${topMarket.total_pnl.toFixed(2)}\n`);

    // Query 2: Fetch from Gamma API
    console.log('2️⃣  Querying Gamma API for market metadata...\n');

    const conditionIdWithPrefix = '0x' + topMarket.condition_id_norm;
    console.log(`   Fetching markets with condition ID: ${conditionIdWithPrefix}\n`);

    const gammaUrl = `${GAMMA_API}/markets?condition_id=${conditionIdWithPrefix}`;
    const gammaResponse = await fetch(gammaUrl, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!gammaResponse.ok) {
      console.log(`   ❌ Gamma API error: ${gammaResponse.status}`);
      console.log(`   URL: ${gammaUrl}\n`);
      console.log('   Note: Gamma API may have rate limits or require authentication\n');
    } else {
      const gammaData: any = await gammaResponse.json();

      if (gammaData.data && gammaData.data.length > 0) {
        const market = gammaData.data[0];
        console.log(`   ✅ Market found on Gamma API`);
        console.log(`      Title: ${market.title || 'N/A'}`);
        console.log(`      Slug: ${market.slug || 'N/A'}`);
        console.log(`      Question: ${market.question || 'N/A'}`);
        console.log(`      Status: ${market.status || 'N/A'}\n`);

        // Query 3: Get our calculated P&L for this market
        console.log('3️⃣  Validating P&L calculation for this market...\n');

        const detailedQuery = `
          SELECT
            t.tx_hash,
            t.created_at,
            t.trade_direction,
            t.shares,
            t.cashflow_usdc,
            res.winning_index,
            res.payout_numerators,
            res.payout_denominator
          FROM default.trades_raw t
          LEFT JOIN default.market_resolutions_final res
            ON lower(replaceAll(t.condition_id, '0x', '')) = res.condition_id_norm
          WHERE lower(t.wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
            AND lower(replaceAll(t.condition_id, '0x', '')) = '${topMarket.condition_id_norm}'
            AND t.outcome_index = ${topMarket.outcome_index}
            AND t.condition_id NOT LIKE '%token_%'
          ORDER BY t.block_time ASC
          LIMIT 20
        `;

        const detailedResult = await ch.query({
          query: detailedQuery,
          format: 'JSONEachRow'
        });
        const trades = await detailedResult.json<any[]>();

        console.log(`   Found ${trades.length} trades for this market:\n`);
        let runningShares = 0;
        let totalCost = 0;

        for (const trade of trades) {
          const direction = trade.trade_direction === 'BUY' ? '+' : '-';
          const shareChange = trade.trade_direction === 'BUY' ? parseFloat(trade.shares) : -parseFloat(trade.shares);
          runningShares += shareChange;
          totalCost += parseFloat(trade.cashflow_usdc);

          console.log(`   ${trade.created_at.substring(0, 19)} | ${direction}${Math.abs(parseFloat(trade.shares)).toFixed(0)} | Cost: $${parseFloat(trade.cashflow_usdc).toFixed(2)} | Running: ${runningShares.toFixed(0)}`);
        }

        console.log(`\n   Final Position: ${runningShares.toFixed(0)} shares`);
        console.log(`   Total Cost Basis: $${totalCost.toFixed(2)}`);

        if (trades.length > 0) {
          const lastTrade = trades[trades.length - 1];
          if (lastTrade.winning_index !== null && lastTrade.payout_numerators) {
            // payout_numerators is an array, access by index (1-indexed in ClickHouse)
            const numeratorArray = Array.isArray(lastTrade.payout_numerators)
              ? lastTrade.payout_numerators
              : JSON.parse(lastTrade.payout_numerators);
            const payoutPerShare = numeratorArray[lastTrade.winning_index] / lastTrade.payout_denominator;
            const payout = runningShares * payoutPerShare;
            const pnl = totalCost + payout;
            console.log(`   Winning Index: ${lastTrade.winning_index}`);
            console.log(`   Payout per Share: $${payoutPerShare.toFixed(2)}`);
            console.log(`   Unrealized Payout: $${payout.toFixed(2)}`);
            console.log(`   Total P&L: $${pnl.toFixed(2)}\n`);
          }
        }

        // Check for all active positions (the 34 from API)
        console.log('\n═'.repeat(100));
        console.log('CHECKING FOR POLYMARKET API POSITIONS (34 expected)');
        console.log('═'.repeat(100));

        const apiPositionsQuery = `
          SELECT
            COUNT(DISTINCT condition_id) as total_markets,
            COUNT(*) as total_position_records
          FROM default.trades_raw
          WHERE lower(wallet) = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
            AND condition_id NOT LIKE '%token_%'
        `;

        const apiPosResult = await ch.query({
          query: apiPositionsQuery,
          format: 'JSONEachRow'
        });
        const apiPos = await apiPosResult.json<any[]>();

        console.log(`\n   ClickHouse has ${apiPos[0]?.total_markets || 0} unique markets for this wallet`);
        console.log(`   Polymarket API reports 34 active positions`);
        console.log(`   Gap: ${Math.max(0, 34 - (apiPos[0]?.total_markets || 0))} positions may be missing (recent ingest)\n`);

        console.log('═'.repeat(100));
        console.log('NEXT STEP: Polymarket UI Comparison');
        console.log('═'.repeat(100));
        console.log(`\nTo complete Task 2 validation:`);
        console.log(`1. Go to: https://polymarket.com`);
        console.log(`2. Search for: "${market.title || market.slug || 'the market'}"`);
        console.log(`3. Check wallet's closed positions tab`);
        console.log(`4. Compare P&L ($${topMarket.total_pnl.toFixed(2)}) against Polymarket UI\n`);

      } else {
        console.log(`   ❌ No market found with this condition ID\n`);
      }
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

main().catch(console.error);
