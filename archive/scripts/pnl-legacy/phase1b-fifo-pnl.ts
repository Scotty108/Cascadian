#!/usr/bin/env npx tsx
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PHASE 1B: EXACT FIFO P&L MATCHER
 * ═══════════════════════════════════════════════════════════════════════════════
 * Creates a ledger table with one row per closed lot for precise FIFO matching.
 * This matches "Closed positions" exactly as shown in Polymarket UI.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

type Key = string; // wallet|market_cid|outcome

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

interface Trade {
  wallet: string;
  market_cid: string;
  outcome: number;
  ts: string;
  d_shares: number;
  d_cash: number;
  fee: number;
}

interface Lot {
  remain: number;
  price: number;
  ts: Date;
  fee: number;
}

interface RealizedLot {
  wallet: string;
  market_cid: string;
  outcome: number;
  open_ts: string;
  close_ts: string;
  qty: number;
  avg_entry: number;
  avg_exit: number;
  fees_usd: number;
  realized_pnl_usd: number;
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 1B: EXACT FIFO P&L MATCHER');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Create table schema
  console.log('Creating table schema...');
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS cascadian_clean.wallet_trading_pnl_fifo
      (
        wallet LowCardinality(String),
        market_cid String,
        outcome Int32,
        open_ts DateTime,
        close_ts DateTime,
        qty Float64,
        avg_entry Float64,
        avg_exit Float64,
        fees_usd Float64,
        realized_pnl_usd Float64
      ) ENGINE = ReplacingMergeTree()
      ORDER BY (wallet, market_cid, outcome, close_ts);
    `
  });
  console.log('✓ Table created');
  console.log('');

  // Step 2: Stream trades ordered by wallet, market, outcome, timestamp
  console.log('Fetching trades...');
  const rows = await ch.query({
    query: `
      SELECT
        lower(wallet_address_norm) AS wallet,
        concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
        toInt32(outcome_index) AS outcome,
        toDateTime(timestamp) AS ts,
        /* Sign convention: BUY adds shares, SELL subtracts */
        if(trade_direction='BUY', shares, -shares) AS d_shares,
        /* Cash: BUY pays (negative), SELL receives (positive) */
        if(trade_direction='BUY', -usd_value, usd_value) AS d_cash,
        0.0 AS fee
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND outcome_index >= 0
      ORDER BY wallet, market_cid, outcome, ts
    `,
    format: 'JSONEachRow'
  });

  const data = await rows.json<Trade[]>();
  console.log(`✓ Fetched ${data.length.toLocaleString()} trades`);
  console.log('');

  // Step 3: FIFO matching per wallet+market+outcome
  console.log('Processing FIFO matches...');
  const q = new Map<Key, { qty: number; lots: Lot[] }>();

  function keyOf(w: string, m: string, o: number): Key {
    return `${w}|${m}|${o}`;
  }

  const outRows: RealizedLot[] = [];
  let processedCount = 0;
  const logInterval = 10000;

  for (const r of data) {
    processedCount++;
    if (processedCount % logInterval === 0) {
      console.log(`  Processed ${processedCount.toLocaleString()} / ${data.length.toLocaleString()} trades...`);
    }

    const k = keyOf(r.wallet, r.market_cid, r.outcome);
    let st = q.get(k);
    if (!st) {
      st = { qty: 0, lots: [] };
      q.set(k, st);
    }

    if (r.d_shares > 0) {
      // BUY: enqueue lot at entry price
      const entryPrice = r.d_cash !== 0 ? -r.d_cash / r.d_shares : 0; // positive price
      st.lots.push({
        remain: r.d_shares,
        price: entryPrice,
        ts: new Date(r.ts),
        fee: r.fee,
      });
      st.qty += r.d_shares;
    } else if (r.d_shares < 0) {
      // SELL: match against oldest lots (FIFO)
      let toSell = -r.d_shares;
      const exitPrice = r.d_cash !== 0 ? r.d_cash / toSell : 0;
      let fees = r.fee;

      while (toSell > 0.0001 && st.lots.length > 0) {
        const lot = st.lots[0];
        const take = Math.min(lot.remain, toSell);
        const realized = (exitPrice - lot.price) * take;

        outRows.push({
          wallet: r.wallet,
          market_cid: r.market_cid,
          outcome: r.outcome,
          open_ts: lot.ts.toISOString().slice(0, 19).replace('T', ' '),
          close_ts: new Date(r.ts).toISOString().slice(0, 19).replace('T', ' '),
          qty: take,
          avg_entry: lot.price,
          avg_exit: exitPrice,
          fees_usd: fees,
          realized_pnl_usd: realized - fees,
        });

        lot.remain -= take;
        st.qty -= take;
        toSell -= take;

        if (lot.remain <= 0.0001) {
          st.lots.shift();
        }

        fees = 0; // Assign fees once per sell
      }
    }
  }

  console.log(`✓ Processed all trades`);
  console.log(`✓ Generated ${outRows.length.toLocaleString()} realized FIFO lots`);
  console.log('');

  // Step 4: Insert realized lots in batches
  if (outRows.length > 0) {
    console.log('Inserting realized lots...');
    const batchSize = 10000;
    let inserted = 0;

    for (let i = 0; i < outRows.length; i += batchSize) {
      const batch = outRows.slice(i, i + batchSize);
      const values = batch
        .map(
          (o) =>
            `('${o.wallet}','${o.market_cid}',${o.outcome},'${o.open_ts}','${o.close_ts}',${o.qty},${o.avg_entry},${o.avg_exit},${o.fees_usd},${o.realized_pnl_usd})`
        )
        .join(',\n');

      await ch.command({
        query: `
          INSERT INTO cascadian_clean.wallet_trading_pnl_fifo
          (wallet, market_cid, outcome, open_ts, close_ts, qty, avg_entry, avg_exit, fees_usd, realized_pnl_usd)
          VALUES ${values}
        `,
      });

      inserted += batch.length;
      console.log(`  Inserted ${inserted.toLocaleString()} / ${outRows.length.toLocaleString()} lots...`);
    }

    console.log('✓ All lots inserted');
  }

  // Step 5: Create aggregation view
  console.log('');
  console.log('Creating aggregation view...');
  await ch.command({
    query: `
      CREATE OR REPLACE VIEW cascadian_clean.vw_trading_pnl_fifo AS
      SELECT
        wallet,
        market_cid,
        outcome,
        sum(qty) AS total_qty_closed,
        sum(realized_pnl_usd) AS realized_pnl_usd,
        count(*) AS num_lots
      FROM cascadian_clean.wallet_trading_pnl_fifo
      GROUP BY wallet, market_cid, outcome;
    `
  });
  console.log('✓ View created');
  console.log('');

  // Step 6: Summary statistics
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const summary = await ch.query({
    query: `
      SELECT
        count(*) AS total_lots,
        sum(realized_pnl_usd) AS total_pnl,
        uniqExact(wallet) AS unique_wallets,
        uniqExact(market_cid) AS unique_markets
      FROM cascadian_clean.wallet_trading_pnl_fifo
    `,
    format: 'JSONEachRow',
  });

  const stats = await summary.json<any[]>();
  if (stats.length > 0) {
    const s = stats[0];
    console.log(`Total realized lots: ${parseInt(s.total_lots).toLocaleString()}`);
    console.log(`Total realized P&L: $${parseFloat(s.total_pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`Unique wallets: ${parseInt(s.unique_wallets).toLocaleString()}`);
    console.log(`Unique markets: ${parseInt(s.unique_markets).toLocaleString()}`);
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 1B COMPLETE');
  console.log('═'.repeat(80));
  console.log('');

  await ch.close();
}

main().catch(console.error);
