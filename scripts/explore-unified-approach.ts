#!/usr/bin/env npx tsx
/**
 * Explore a truly unified PnL approach
 *
 * Key insight: The issue is BUNDLED transactions where split + trade happen atomically.
 *
 * Approach: For each transaction, detect if it's bundled and handle appropriately:
 * - If tx has proxy split + CLOB trade: Only count the NET effect
 * - If tx has only CLOB trade: Count normally
 * - If tx has only direct CTF event: Count normally
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
const TAKER_HEAVY = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';

async function analyzeWallet(wallet: string, name: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`Analyzing: ${name}`);
  console.log('='.repeat(70));

  // Get all transactions with their components
  const query = `
    WITH
    -- All CLOB trades by tx
    clob_trades AS (
      SELECT
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
        sumIf(token_amount, side = 'buy') / 1e6 as buy_tokens,
        sumIf(token_amount, side = 'sell') / 1e6 as sell_tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND is_deleted = 0
      GROUP BY tx_hash
    ),
    -- All proxy splits by tx
    proxy_splits AS (
      SELECT
        lower(tx_hash) as tx_hash,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_amount
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_type = 'PositionSplit'
        AND lower(user_address) != '${wallet}'
      GROUP BY tx_hash
    )
    SELECT
      c.tx_hash,
      c.buy_usdc,
      c.sell_usdc,
      c.buy_tokens,
      c.sell_tokens,
      coalesce(p.split_amount, 0) as split_amount,
      CASE
        WHEN p.split_amount > 0 AND (c.buy_usdc > 0 OR c.sell_usdc > 0) THEN 'bundled'
        WHEN p.split_amount > 0 THEN 'split_only'
        ELSE 'trade_only'
      END as tx_type
    FROM clob_trades c
    LEFT JOIN proxy_splits p ON c.tx_hash = p.tx_hash
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const txs = (await result.json()) as any[];

  // Categorize transactions
  const bundled = txs.filter(t => t.tx_type === 'bundled');
  const tradeOnly = txs.filter(t => t.tx_type === 'trade_only');
  const splitOnly = txs.filter(t => t.tx_type === 'split_only');

  console.log(`\nTransaction breakdown:`);
  console.log(`  Bundled (split + trade): ${bundled.length}`);
  console.log(`  Trade only: ${tradeOnly.length}`);
  console.log(`  Split only: ${splitOnly.length}`);

  // For bundled transactions, analyze the pattern
  let bundledBuyUsdc = 0, bundledSellUsdc = 0, bundledSplits = 0;
  for (const t of bundled) {
    bundledBuyUsdc += t.buy_usdc;
    bundledSellUsdc += t.sell_usdc;
    bundledSplits += t.split_amount;
  }

  console.log(`\nBundled transaction totals:`);
  console.log(`  Buy USDC: $${bundledBuyUsdc.toLocaleString()}`);
  console.log(`  Sell USDC: $${bundledSellUsdc.toLocaleString()}`);
  console.log(`  Split amount: $${bundledSplits.toLocaleString()}`);
  console.log(`  Net trade: $${(bundledSellUsdc - bundledBuyUsdc).toLocaleString()}`);

  // Trade-only totals
  let tradeOnlyBuy = 0, tradeOnlySell = 0;
  for (const t of tradeOnly) {
    tradeOnlyBuy += t.buy_usdc;
    tradeOnlySell += t.sell_usdc;
  }

  console.log(`\nTrade-only totals:`);
  console.log(`  Buy: $${tradeOnlyBuy.toLocaleString()}`);
  console.log(`  Sell: $${tradeOnlySell.toLocaleString()}`);

  // Key insight: In bundled transactions, what's the relationship between
  // split amount and trade amounts?
  console.log(`\n--- Key Analysis ---`);

  // Sample a few bundled transactions
  console.log(`\nSample bundled transactions:`);
  for (const t of bundled.slice(0, 3)) {
    const netTrade = t.sell_usdc - t.buy_usdc;
    console.log(`  TX: ${t.tx_hash.slice(0, 16)}...`);
    console.log(`    Split: $${t.split_amount.toFixed(2)}`);
    console.log(`    Buy: $${t.buy_usdc.toFixed(2)}, Sell: $${t.sell_usdc.toFixed(2)}`);
    console.log(`    Net trade: $${netTrade.toFixed(2)}`);
    console.log(`    Split - Net = $${(t.split_amount - netTrade).toFixed(2)} (tokens retained)`);
  }

  // The unified approach:
  // For bundled txs: count (sell - buy) as cash flow, DON'T add split separately
  // For trade-only txs: count normally
  // This avoids double-counting while capturing all trades

  console.log(`\n--- Unified Calculation ---`);

  // Total USDC in/out
  let totalBuyUsdc = 0, totalSellUsdc = 0;
  for (const t of txs) {
    totalBuyUsdc += t.buy_usdc;
    totalSellUsdc += t.sell_usdc;
  }

  console.log(`All trades (no split adjustment):`);
  console.log(`  Buy: $${totalBuyUsdc.toLocaleString()}`);
  console.log(`  Sell: $${totalSellUsdc.toLocaleString()}`);
  console.log(`  Net: $${(totalSellUsdc - totalBuyUsdc).toLocaleString()}`);
}

async function main() {
  await analyzeWallet(SPLIT_HEAVY, 'Split-Heavy (multi-market)');
  await analyzeWallet(TAKER_HEAVY, 'Taker-Heavy (single-market)');

  console.log('\n' + '='.repeat(70));
  console.log('UNIFIED APPROACH HYPOTHESIS');
  console.log('='.repeat(70));
  console.log(`
The key insight: DON'T add proxy splits as separate USDC out.

Instead, just use CLOB trades directly:
  PnL = (sell USDC) - (buy USDC) + (remaining token value)

This works because:
1. For bundled txs: The buy/sell already reflects the NET position
2. For trade-only txs: Normal cost basis
3. No double-counting of split collateral

The challenge: We still need token inventory to calculate remaining value.
For this, we CAN use proxy splits to track token creation.
  `);
}

main().catch(console.error);
