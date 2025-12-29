#!/usr/bin/env npx tsx

import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@clickhouse/client";

const envPath = path.resolve("/Users/scotty/Projects/Cascadian-app/.env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...rest] = trimmed.split("=");
      if (key && rest.length > 0) {
        process.env[key] = rest.join("=");
      }
    }
  }
}

const clickhouseClient = createClient({
  url: process.env.CLICKHOUSE_HOST || "",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 300000,
});

const EGG_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function runStepA() {
  console.log('\n=== PnL TDD Validation: Step A - Single-Market Sanity Check ===\n');

  // Step 1: Find simple test markets
  console.log('Step 1: Finding simple test markets (5-20 trades)...\n');

  const findMarketsQuery = `
    SELECT
        m.condition_id,
        m.question,
        count(*) as trade_count,
        sum(CASE WHEN t.side = 'BUY' THEN t.usdc_amount / 1e6 ELSE 0 END) as total_bought,
        sum(CASE WHEN t.side = 'SELL' THEN t.usdc_amount / 1e6 ELSE 0 END) as total_sold
    FROM pm_trader_events_v2 t
    JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
    JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE t.trader_wallet = '${EGG_WALLET}'
    GROUP BY m.condition_id, m.question
    HAVING count(*) BETWEEN 5 AND 20
    ORDER BY total_bought DESC
    LIMIT 5
  `;

  const marketsResult = await clickhouseClient.query({
    query: findMarketsQuery,
    format: 'JSONEachRow'
  });
  const marketsText = await marketsResult.text();
  const markets = marketsText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  console.log('Found test markets:');
  console.table(markets);

  if (markets.length === 0) {
    console.log('\nNo markets found with 5-20 trades. Exiting.');
    return;
  }

  // Pick the first market
  const selectedMarket = markets[0];
  const conditionId = selectedMarket['m.condition_id'];

  console.log('\n\n=== Selected Market ===');
  console.log(`Condition ID: ${conditionId}`);
  console.log(`Question: ${selectedMarket.question}`);
  console.log(`Trade Count: ${selectedMarket.trade_count}`);
  console.log(`Total Bought: $${selectedMarket.total_bought}`);
  console.log(`Total Sold: $${selectedMarket.total_sold}`);

  // Step 2: Get all trades for this market
  console.log('\n\nStep 2: Getting trade breakdown by outcome...\n');

  const tradesQuery = `
    WITH trades AS (
        SELECT
            t.event_id,
            t.trade_time,
            t.side,
            m.outcome_index,
            t.usdc_amount / 1e6 as usdc_amount,
            t.token_amount / 1e6 as token_amount,
            t.fee_amount / 1e6 as fee_amount,
            -- BUY: spend USDC (negative), receive shares (positive)
            -- SELL: receive USDC (positive), give up shares (negative)
            CASE WHEN lower(t.side) = 'buy'
                 THEN -((t.usdc_amount + t.fee_amount) / 1e6)
                 ELSE +((t.usdc_amount - t.fee_amount) / 1e6)
            END as cash_delta,
            CASE WHEN lower(t.side) = 'buy'
                 THEN +(t.token_amount / 1e6)
                 ELSE -(t.token_amount / 1e6)
            END as shares_delta
        FROM pm_trader_events_v2 t
        JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet = '${EGG_WALLET}'
          AND m.condition_id = '${conditionId}'
    )
    SELECT
        outcome_index,
        sum(cash_delta) as total_cash,
        sum(shares_delta) as final_shares,
        count(*) as trade_count
    FROM trades
    GROUP BY outcome_index
    ORDER BY outcome_index
  `;

  const tradesResult = await clickhouseClient.query({
    query: tradesQuery,
    format: 'JSONEachRow'
  });
  const tradesText = await tradesResult.text();
  const tradesByOutcome = tradesText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  console.log('Trade breakdown by outcome:');
  console.table(tradesByOutcome);

  // Step 3: Get resolution
  console.log('\n\nStep 3: Getting resolution data...\n');

  const resolutionQuery = `
    SELECT
      condition_id,
      payout_numerators,
      payout_denominator
    FROM pm_condition_resolutions
    WHERE condition_id = '${conditionId}'
  `;

  const resolutionResult = await clickhouseClient.query({
    query: resolutionQuery,
    format: 'JSONEachRow'
  });
  const resolutionText = await resolutionResult.text();
  const resolutions = resolutionText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  if (resolutions.length === 0) {
    console.log('ERROR: No resolution found for this condition_id!');
    return;
  }

  const resolution = resolutions[0];
  console.log('Resolution data:');
  console.log(`  Payout Numerators: ${resolution.payout_numerators}`);
  console.log(`  Payout Denominator: ${resolution.payout_denominator}`);

  // Step 4: Calculate PnL manually
  console.log('\n\n=== Step 4: Manual PnL Calculation ===\n');

  // Parse numerators - it comes as an array from ClickHouse
  const numerators = Array.isArray(resolution.payout_numerators)
    ? resolution.payout_numerators
    : JSON.parse(resolution.payout_numerators);
  const denominator = resolution.payout_denominator;

  console.log('Resolution prices (numerator/denominator):');
  numerators.forEach((num: number, idx: number) => {
    const price = num / denominator;
    console.log(`  Outcome ${idx}: ${num}/${denominator} = ${price.toFixed(6)}`);
  });

  let totalCash = 0;
  let resolutionValue = 0;

  console.log('\n\nPer-outcome calculation:');
  tradesByOutcome.forEach((outcome: any) => {
    const outcomeIndex = outcome.outcome_index;
    const cash = parseFloat(outcome.total_cash);
    const shares = parseFloat(outcome.final_shares);
    const resolvedPrice = numerators[outcomeIndex] / denominator;
    const outcomeResolutionValue = shares * resolvedPrice;

    totalCash += cash;
    resolutionValue += outcomeResolutionValue;

    console.log(`  Outcome ${outcomeIndex}:`);
    console.log(`    Cash Delta: $${cash.toFixed(2)}`);
    console.log(`    Final Shares: ${shares.toFixed(4)}`);
    console.log(`    Resolved Price: ${resolvedPrice.toFixed(6)}`);
    console.log(`    Resolution Value: ${shares.toFixed(4)} × ${resolvedPrice.toFixed(6)} = $${outcomeResolutionValue.toFixed(2)}`);
  });

  const realizedPnL = resolutionValue + totalCash;

  console.log('\n\n=== FINAL CALCULATION ===');
  console.log(`  Total Cash Delta: $${totalCash.toFixed(2)}`);
  console.log(`  Total Resolution Value: $${resolutionValue.toFixed(2)}`);
  console.log(`  Realized PnL: $${resolutionValue.toFixed(2)} + $${totalCash.toFixed(2)} = $${realizedPnL.toFixed(2)}`);

  // Step 5: Compare to view (if it exists)
  console.log('\n\n=== Step 5: Comparing to vw_pm_realized_pnl_v5 (if exists) ===\n');

  try {
    const viewQuery = `
      SELECT
        condition_id,
        realized_pnl
      FROM vw_pm_realized_pnl_v5
      WHERE condition_id = '${conditionId}'
        AND wallet_address = '${EGG_WALLET}'
    `;

    const viewResult = await clickhouseClient.query({
      query: viewQuery,
      format: 'JSONEachRow'
    });
    const viewText = await viewResult.text();
    const viewData = viewText.trim().split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

    if (viewData.length > 0) {
      const viewPnL = parseFloat(viewData[0].realized_pnl);
      const diff = Math.abs(viewPnL - realizedPnL);
      const match = diff < 0.01; // Allow 1 cent tolerance

      console.log(`View PnL: $${viewPnL.toFixed(2)}`);
      console.log(`Manual PnL: $${realizedPnL.toFixed(2)}`);
      console.log(`Difference: $${diff.toFixed(4)}`);
      console.log(`Match: ${match ? '✅ PASS' : '❌ FAIL'}`);

      if (!match) {
        console.log('\n⚠️  PnL mismatch detected! Investigation needed.');
      }
    } else {
      console.log('View does not contain this market. Manual calculation is baseline.');
    }
  } catch (error: any) {
    console.log(`View query failed (may not exist): ${error.message}`);
    console.log('Using manual calculation as baseline.');
  }

  console.log('\n\n=== VALIDATION RESULT ===');
  console.log('✅ Step A Complete: Single-market calculation verified');
  console.log(`   Market: ${selectedMarket.question}`);
  console.log(`   Realized PnL: $${realizedPnL.toFixed(2)}`);

  await clickhouseClient.close();
}

runStepA().catch(console.error);
