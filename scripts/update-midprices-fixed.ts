#!/usr/bin/env npx tsx
/**
 * FIXED Midprice Fetcher
 *
 * Fetches current midprices for all open positions and populates the database.
 * Shows progress, handles errors, and integrates with existing CLOB API.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 300000,
});

interface OpenPosition {
  market_cid: string;
  outcome: number;
}

// Convert condition_id + outcome to token_id (Polymarket format)
function getTokenId(marketCid: string, outcome: number): string {
  const hex = marketCid.replace(/^0x/i, '');
  const base = hex.slice(0, 62) + outcome.toString(16).padStart(2, '0');
  return base.toLowerCase();
}

async function fetchOrderBook(tokenId: string): Promise<{ mid: number; bid: number; ask: number } | null> {
  try {
    // Match the format used in /api/polymarket/order-book/[marketId]/route.ts
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`, {
      headers: { 'User-Agent': 'Cascadian/1.0' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!res.ok) {
      if (res.status === 404) {
        // Market not found on CLOB - return default
        return { mid: 0.5, bid: 0, ask: 1 };
      }
      return null;
    }

    const book = await res.json() as any;
    const bid = book?.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
    const ask = book?.asks?.[0]?.price ? parseFloat(book.asks[0].price) : 1;
    const mid = (bid + ask) / 2;

    return { mid, bid, ask };
  } catch (err: any) {
    if (err.name === 'TimeoutError') {
      console.error(`  Timeout fetching ${tokenId.substring(0, 12)}...`);
    }
    return null;
  }
}

async function main() {
  const startTime = Date.now();
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('MIDPRICE FETCHER - FIXED VERSION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Get all unique open positions
  console.log('Step 1: Finding open positions...');
  const positions = await ch.query({
    query: `
      SELECT DISTINCT
        market_cid,
        outcome
      FROM (
        SELECT
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction='BUY', toFloat64(shares), -toFloat64(shares)), 1) AS net_shares
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY market_cid, outcome
      )
      WHERE abs(net_shares) >= 0.01
      ORDER BY market_cid, outcome
    `,
    format: 'JSONEachRow',
  });

  const openPositions = await positions.json<OpenPosition[]>();
  console.log(`✓ Found ${openPositions.length.toLocaleString()} open positions to price\n`);

  if (openPositions.length === 0) {
    console.log('No open positions. Exiting.');
    await ch.close();
    return;
  }

  // Fetch prices with progress tracking
  console.log('Step 2: Fetching midprices from Polymarket CLOB...');
  const prices: Array<{ market_cid: string; outcome: number; mid: number; bid: number; ask: number }> = [];
  let fetched = 0;
  let failed = 0;

  const batchSize = 100;
  const totalBatches = Math.ceil(openPositions.length / batchSize);

  for (let i = 0; i < openPositions.length; i += batchSize) {
    const batch = openPositions.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${fetched + failed}/${openPositions.length})...`);

    const results = await Promise.allSettled(
      batch.map(async (pos) => {
        const tokenId = getTokenId(pos.market_cid, pos.outcome);
        const price = await fetchOrderBook(tokenId);

        if (price) {
          return {
            market_cid: pos.market_cid,
            outcome: pos.outcome,
            mid: price.mid,
            bid: price.bid,
            ask: price.ask,
          };
        }
        return null;
      })
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    prices.push(...successful);
    fetched += successful.length;
    failed += results.length - successful.length;

    console.log(` ${successful.length}/${results.length} success`);

    // Small delay between batches
    if (i + batchSize < openPositions.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`\n✓ Fetched ${fetched.toLocaleString()} prices (${failed} failed)\n`);

  // Insert to database
  if (prices.length > 0) {
    console.log('Step 3: Inserting prices to database...');

    const insertBatchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < prices.length; i += insertBatchSize) {
      const batch = prices.slice(i, i + insertBatchSize);
      const values = batch.map(p =>
        `('${p.market_cid}',${p.outcome},${p.mid},${p.bid},${p.ask},now())`
      ).join(',');

      await ch.command({
        query: `
          INSERT INTO cascadian_clean.midprices_latest
          (market_cid, outcome, midprice, best_bid, best_ask, updated_at)
          VALUES ${values}
        `
      });

      inserted += batch.length;
      process.stdout.write(`\r  Inserted ${inserted.toLocaleString()} / ${prices.length.toLocaleString()} prices...`);
    }

    console.log(' Done!\n');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total positions:     ${openPositions.length.toLocaleString()}`);
  console.log(`Prices fetched:      ${fetched.toLocaleString()} (${((fetched/openPositions.length)*100).toFixed(1)}%)`);
  console.log(`Failed to fetch:     ${failed.toLocaleString()}`);
  console.log(`Inserted to DB:      ${prices.length.toLocaleString()}`);
  console.log(`Elapsed time:        ${elapsed}s`);
  console.log(`Fetch rate:          ${(fetched / parseFloat(elapsed)).toFixed(1)} prices/sec`);
  console.log('');
  console.log('✅ COMPLETE');
  console.log('');
  console.log('Next: Run `npx tsx compare-all-wallets.ts` to see corrected P&L');
  console.log('');

  await ch.close();
}

main().catch(err => {
  console.error('\n\n❌ FATAL ERROR:', err);
  process.exit(1);
});
