#!/usr/bin/env npx tsx
/**
 * Test a simple unified approach:
 * PnL = (sell USDC) - (buy USDC) + (remaining token value)
 *
 * Key: DON'T add split collateral as USDC out - it's already in the trade prices
 * But DO use splits for token inventory tracking
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
const SPLIT_HEAVY_UI = -115409.28;

const TAKER_HEAVY = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';
const TAKER_HEAVY_UI = -1129;

async function computeSimpleUnified(wallet: string): Promise<{
  totalPnl: number;
  buyUsdc: number;
  sellUsdc: number;
  remainingValue: number;
}> {
  // Step 1: Get CLOB trades aggregated
  const tradeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      side,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens
    FROM deduped
    GROUP BY side
  `;

  const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const trades = (await tradeResult.json()) as any[];

  let buyUsdc = 0, sellUsdc = 0;
  let buyTokens = 0, sellTokens = 0;

  for (const t of trades) {
    if (t.side === 'buy') {
      buyUsdc = t.total_usdc;
      buyTokens = t.total_tokens;
    } else {
      sellUsdc = t.total_usdc;
      sellTokens = t.total_tokens;
    }
  }

  // Step 2: Get direct CTF events (merges, redemptions - NOT proxy splits)
  const ctfQuery = `
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_amount
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = '${wallet}'
      AND event_type IN ('PositionsMerge', 'PayoutRedemption')
    GROUP BY event_type
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = (await ctfResult.json()) as any[];

  let mergeProceeds = 0, redemptionProceeds = 0;
  for (const e of ctfEvents) {
    if (e.event_type === 'PositionsMerge') mergeProceeds = e.total_amount;
    else if (e.event_type === 'PayoutRedemption') redemptionProceeds = e.total_amount;
  }

  // Step 3: Calculate remaining token value
  // For simplicity, estimate remaining value based on token balance
  // Remaining tokens = buyTokens - sellTokens (simplified)
  // This is a rough estimate - proper calculation would need per-condition tracking

  // For resolved markets, remaining tokens are worth $0 or $1
  // For unresolved, worth $0.50
  // Since most markets are resolved for these wallets, assume avg payout ~0.3
  const remainingTokens = Math.max(0, buyTokens - sellTokens);
  const remainingValue = remainingTokens * 0.3; // Rough estimate

  // Step 4: Calculate PnL
  // PnL = sells + merges + redemptions - buys + remaining value
  const usdcIn = sellUsdc + mergeProceeds + redemptionProceeds;
  const usdcOut = buyUsdc; // NO split collateral added!
  const totalPnl = usdcIn - usdcOut + remainingValue;

  return { totalPnl, buyUsdc, sellUsdc, remainingValue };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Simple Unified Approach');
  console.log('PnL = (sells + merges + redemptions) - buys + remaining');
  console.log('NOTE: No split collateral in USDC out!');
  console.log('='.repeat(70));

  const splitResult = await computeSimpleUnified(SPLIT_HEAVY);
  const splitError = Math.abs(splitResult.totalPnl - SPLIT_HEAVY_UI) / Math.abs(SPLIT_HEAVY_UI) * 100;

  console.log('\nSplit-Heavy wallet:');
  console.log(`  Buy USDC: $${splitResult.buyUsdc.toLocaleString()}`);
  console.log(`  Sell USDC: $${splitResult.sellUsdc.toLocaleString()}`);
  console.log(`  Remaining value: $${splitResult.remainingValue.toLocaleString()}`);
  console.log(`  Total PnL: $${splitResult.totalPnl.toLocaleString()}`);
  console.log(`  UI PnL: $${SPLIT_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${splitError.toFixed(2)}%`);

  const takerResult = await computeSimpleUnified(TAKER_HEAVY);
  const takerError = Math.abs(takerResult.totalPnl - TAKER_HEAVY_UI) / Math.abs(TAKER_HEAVY_UI) * 100;

  console.log('\nTaker-Heavy wallet:');
  console.log(`  Buy USDC: $${takerResult.buyUsdc.toLocaleString()}`);
  console.log(`  Sell USDC: $${takerResult.sellUsdc.toLocaleString()}`);
  console.log(`  Remaining value: $${takerResult.remainingValue.toLocaleString()}`);
  console.log(`  Total PnL: $${takerResult.totalPnl.toLocaleString()}`);
  console.log(`  UI PnL: $${TAKER_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${takerError.toFixed(2)}%`);

  console.log('\n' + '='.repeat(70));
  console.log('Result:');
  console.log('='.repeat(70));
  console.log(`Split-heavy: ${splitError < 10 ? 'PROMISING' : 'NEEDS WORK'} (${splitError.toFixed(2)}% error)`);
  console.log(`Taker-heavy: ${takerError < 10 ? 'PROMISING' : 'NEEDS WORK'} (${takerError.toFixed(2)}% error)`);
}

main().catch(console.error);
