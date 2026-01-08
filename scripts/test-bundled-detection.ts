#!/usr/bin/env npx tsx
/**
 * New approach: Detect bundled transactions and handle them correctly
 *
 * For bundled transactions (split + trade in same tx):
 * - Count the SPLIT as USDC out
 * - Count the SELL as USDC in
 * - DON'T count the BUY (it's the return from selling the split)
 *
 * For non-bundled:
 * - Count buys and sells normally
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
const SPLIT_HEAVY_UI = -115409.28;

const TAKER_HEAVY = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';
const TAKER_HEAVY_UI = -1129;

async function computeBundledAware(wallet: string): Promise<{
  pnl: number;
  bundledTxCount: number;
  nonBundledTxCount: number;
}> {
  // Step 1: Get all wallet tx hashes
  const txQuery = `
    SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${wallet}'
      AND is_deleted = 0
  `;

  const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
  const txHashes = ((await txResult.json()) as any[]).map(r => r.tx_hash);

  // Process in batches
  const BATCH_SIZE = 200;
  let totalUsdcOut = 0;
  let totalUsdcIn = 0;
  let bundledTxCount = 0;
  let nonBundledTxCount = 0;

  for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
    const batch = txHashes.slice(i, i + BATCH_SIZE);
    const txList = batch.map(h => `'${h}'`).join(',');

    // Get trades for this batch
    const tradeQuery = `
      SELECT
        lower(concat('0x', hex(transaction_hash))) as tx_hash,
        side,
        sum(usdc_amount) / 1e6 as usdc,
        sum(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND is_deleted = 0
        AND lower(concat('0x', hex(transaction_hash))) IN (${txList})
      GROUP BY tx_hash, side
    `;

    const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
    const trades = (await tradeResult.json()) as any[];

    // Get splits for this batch (proxy)
    const splitQuery = `
      SELECT
        lower(tx_hash) as tx_hash,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as split_amount
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND lower(tx_hash) IN (${txList})
        AND event_type = 'PositionSplit'
      GROUP BY tx_hash
    `;

    const splitResult = await clickhouse.query({ query: splitQuery, format: 'JSONEachRow' });
    const splits = (await splitResult.json()) as any[];
    const splitMap = new Map(splits.map(s => [s.tx_hash, s.split_amount]));

    // Group trades by tx
    const tradesByTx = new Map<string, { buyUsdc: number; sellUsdc: number }>();
    for (const t of trades) {
      const entry = tradesByTx.get(t.tx_hash) || { buyUsdc: 0, sellUsdc: 0 };
      if (t.side === 'buy') entry.buyUsdc += t.usdc;
      else entry.sellUsdc += t.usdc;
      tradesByTx.set(t.tx_hash, entry);
    }

    // Process each transaction
    for (const txHash of batch) {
      const split = splitMap.get(txHash) || 0;
      const trade = tradesByTx.get(txHash) || { buyUsdc: 0, sellUsdc: 0 };

      if (split > 0) {
        // Bundled transaction
        bundledTxCount++;

        // USDC out = split collateral (NOT buy, which is return from selling split)
        totalUsdcOut += split;

        // USDC in = sell proceeds
        totalUsdcIn += trade.sellUsdc;

        // Note: We ignore trade.buyUsdc because it's the return from selling
        // the unwanted side of the split
      } else {
        // Non-bundled transaction
        nonBundledTxCount++;

        // Normal accounting
        totalUsdcOut += trade.buyUsdc;
        totalUsdcIn += trade.sellUsdc;
      }
    }
  }

  // Add direct CTF events (merges, redemptions)
  const ctfQuery = `
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as amount
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = '${wallet}'
      AND event_type IN ('PositionsMerge', 'PayoutRedemption')
    GROUP BY event_type
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = (await ctfResult.json()) as any[];

  for (const e of ctfEvents) {
    totalUsdcIn += e.amount;
  }

  // CRITICAL: Need to add remaining token value!
  // Cash-only PnL is incomplete - need unrealized gains/losses

  const cashPnl = totalUsdcIn - totalUsdcOut;

  return { pnl: cashPnl, bundledTxCount, nonBundledTxCount };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Bundled-Aware Approach');
  console.log('Bundled tx: count split as USDC out, ignore buy');
  console.log('Non-bundled tx: count buy/sell normally');
  console.log('='.repeat(70));

  const splitResult = await computeBundledAware(SPLIT_HEAVY);
  const splitError = Math.abs(splitResult.pnl - SPLIT_HEAVY_UI) / Math.abs(SPLIT_HEAVY_UI) * 100;

  console.log('\nSplit-Heavy wallet:');
  console.log(`  Bundled txs: ${splitResult.bundledTxCount}`);
  console.log(`  Non-bundled txs: ${splitResult.nonBundledTxCount}`);
  console.log(`  Calculated PnL: $${splitResult.pnl.toLocaleString()}`);
  console.log(`  UI PnL: $${SPLIT_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${splitError.toFixed(2)}%`);

  const takerResult = await computeBundledAware(TAKER_HEAVY);
  const takerError = Math.abs(takerResult.pnl - TAKER_HEAVY_UI) / Math.abs(TAKER_HEAVY_UI) * 100;

  console.log('\nTaker-Heavy wallet:');
  console.log(`  Bundled txs: ${takerResult.bundledTxCount}`);
  console.log(`  Non-bundled txs: ${takerResult.nonBundledTxCount}`);
  console.log(`  Calculated PnL: $${takerResult.pnl.toLocaleString()}`);
  console.log(`  UI PnL: $${TAKER_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${takerError.toFixed(2)}%`);

  console.log('\n' + '='.repeat(70));
  console.log(`Split-heavy: ${splitError < 5 ? 'PASS' : 'FAIL'} (${splitError.toFixed(2)}% error)`);
  console.log(`Taker-heavy: ${takerError < 5 ? 'PASS' : 'FAIL'} (${takerError.toFixed(2)}% error)`);
}

main().catch(console.error);
