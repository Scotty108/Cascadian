#!/usr/bin/env npx tsx
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 2: MIDPRICE REFRESHER
 * ═══════════════════════════════════════════════════════════════════════════════
 * Fetches current midprices from Polymarket CLOB API for all open positions.
 * Run this on a cron every 2-5 minutes to keep unrealized P&L up to date.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface OpenPosition {
  market_cid: string;
  outcome: number;
}

interface OrderBook {
  bids?: Array<{ price: string }>;
  asks?: Array<{ price: string }>;
}

function tokenIdFrom(marketCid: string, outcome: number): string {
  const hex = marketCid.replace(/^0x/i, '');
  // Take first 62 hex chars + outcome as 2-char hex
  const base = hex.slice(0, 62) + outcome.toString(16).padStart(2, '0');
  return '0x' + base.toLowerCase();
}

async function fetchMid(
  marketCid: string,
  outcome: number
): Promise<{ mid: number; bid: number; ask: number } | null> {
  try {
    const tokenId = tokenIdFrom(marketCid, outcome);
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);

    if (!res.ok) {
      return null;
    }

    const book = (await res.json()) as OrderBook;
    const bid = book?.bids?.[0]?.price ? parseFloat(book.bids[0].price) : 0;
    const ask = book?.asks?.[0]?.price ? parseFloat(book.asks[0].price) : 1;
    const mid = (bid + ask) / 2;

    return { mid, bid, ask };
  } catch (err) {
    console.error(`Error fetching ${marketCid}[${outcome}]:`, err);
    return null;
  }
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 2: MIDPRICE REFRESHER');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Get all open positions needing prices
  console.log('Fetching open positions...');
  const toUpdate = await ch.query({
    query: `
      SELECT DISTINCT market_cid, outcome
      FROM (
        SELECT
          lower(wallet_address_norm) AS wallet,
          concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
          toInt32(outcome_index) AS outcome,
          sumIf(if(trade_direction='BUY', shares, -shares), 1) AS pos
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != ''
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND outcome_index >= 0
        GROUP BY wallet, market_cid, outcome
      )
      WHERE abs(pos) >= 0.01
      ORDER BY market_cid, outcome
      LIMIT 10000
    `,
    format: 'JSONEachRow',
  });

  const list = await toUpdate.json<OpenPosition[]>();
  console.log(`✓ Found ${list.length.toLocaleString()} open positions to price`);
  console.log('');

  if (list.length === 0) {
    console.log('No open positions found. Exiting.');
    await ch.close();
    return;
  }

  // Step 2: Fetch midprices from Polymarket CLOB
  console.log('Fetching midprices from Polymarket CLOB...');
  const rows: string[] = [];
  let fetched = 0;
  let failed = 0;
  const logInterval = 100;

  for (const r of list) {
    const p = await fetchMid(r.market_cid, r.outcome);

    if (p) {
      rows.push(
        `('${r.market_cid}',${r.outcome},${p.mid},${p.bid},${p.ask},now())`
      );
      fetched++;
    } else {
      failed++;
    }

    if ((fetched + failed) % logInterval === 0) {
      console.log(
        `  Progress: ${fetched + failed} / ${list.length} (${fetched} success, ${failed} failed)`
      );
    }

    // Rate limiting: 10ms delay between requests
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  console.log(`✓ Fetched ${fetched.toLocaleString()} midprices`);
  console.log(`✗ Failed to fetch ${failed.toLocaleString()} midprices`);
  console.log('');

  // Step 3: Insert midprices in batches
  if (rows.length > 0) {
    console.log('Inserting midprices...');
    const batchSize = 1000;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await ch.command({
        query: `
          INSERT INTO cascadian_clean.midprices_latest
          (market_cid, outcome, midprice, best_bid, best_ask, updated_at)
          VALUES ${batch.join(',')}
        `,
      });

      inserted += batch.length;
      console.log(`  Inserted ${inserted.toLocaleString()} / ${rows.length.toLocaleString()} prices...`);
    }

    console.log('✓ All prices inserted');
  }

  // Step 4: Summary statistics
  console.log('');
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const summary = await ch.query({
    query: `
      SELECT
        count(*) AS total_prices,
        uniqExact(market_cid) AS unique_markets,
        min(updated_at) AS oldest_update,
        max(updated_at) AS newest_update
      FROM cascadian_clean.midprices_latest
    `,
    format: 'JSONEachRow',
  });

  const stats = await summary.json<any[]>();
  if (stats.length > 0) {
    const s = stats[0];
    console.log(`Total prices stored: ${parseInt(s.total_prices).toLocaleString()}`);
    console.log(`Unique markets: ${parseInt(s.unique_markets).toLocaleString()}`);
    console.log(`Oldest update: ${s.oldest_update}`);
    console.log(`Newest update: ${s.newest_update}`);
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 2 REFRESH COMPLETE');
  console.log('═'.repeat(80));
  console.log('');
  console.log('💡 TIP: Run this script on a cron every 2-5 minutes to keep prices fresh');
  console.log('');

  await ch.close();
}

main().catch(console.error);
