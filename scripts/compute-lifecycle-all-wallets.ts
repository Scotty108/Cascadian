#!/usr/bin/env npx tsx
/**
 * FIFO Position Lifecycle - ALL WALLETS
 *
 * Runs lifecycle calculations for ALL wallets in batches.
 * Uses optimized bulk approach: fetch all trades, group in-memory, run FIFO.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  request_timeout: 600000,
});

interface Trade {
  wallet: string;
  market_cid: string;
  outcome: number;
  ts: string;
  dir: 'BUY' | 'SELL';
  qty: number;
  px: number;
}

let lotCounter = 0n;

function fifoLifecycle(wallet: string, marketCid: string, outcome: number, trades: Trade[]) {
  type Lot = { id: bigint; openTs: string; qty: number; avgPx: number };
  const open: Lot[] = [];
  const closedRows: any[] = [];
  let openLot: any = null;

  const pushBuy = (ts: string, qty: number, px: number) => {
    open.push({ id: ++lotCounter, openTs: ts, qty, avgPx: px });
  };

  const closeAgainst = (ts: string, sellQty: number, sellPx: number) => {
    while (sellQty > 0 && open.length) {
      const lot = open[0];
      const use = Math.min(sellQty, lot.qty);
      const realized = use * (sellPx - lot.avgPx);
      const holdSec = Math.max(0, (new Date(ts).getTime() - new Date(lot.openTs).getTime()) / 1000);
      const holdDays = holdSec / 86400;
      const durationCategory = holdDays < 1 ? 'INTRADAY' : holdDays < 7 ? 'SHORT_TERM' : holdDays < 30 ? 'MEDIUM_TERM' : 'LONG_TERM';

      closedRows.push({
        wallet, cid_hex: marketCid, outcome, lot_id: Number(lot.id),
        opened_at: lot.openTs, closed_at: ts, hold_seconds: Math.round(holdSec), hold_days: holdDays,
        entry_qty: use, exit_qty: use, entry_avg_price: lot.avgPx, exit_avg_price: sellPx,
        realized_pnl: realized, duration_category: durationCategory, position_status: 'CLOSED',
      });

      lot.qty -= use;
      sellQty -= use;
      if (lot.qty <= 1e-9) open.shift();
    }
  };

  for (const t of trades) {
    if (t.dir === 'BUY') pushBuy(t.ts, t.qty, t.px);
    else closeAgainst(t.ts, t.qty, t.px);
  }

  if (open.length) {
    const totalQty = open.reduce((s, l) => s + l.qty, 0);
    const costUsd = open.reduce((s, l) => s + l.qty * l.avgPx, 0);
    const firstTs = open[0].openTs;
    const holdSec = Math.max(0, (Date.now() - new Date(firstTs).getTime()) / 1000);
    const holdDays = holdSec / 86400;
    const durationCategory = holdDays < 1 ? 'INTRADAY' : holdDays < 7 ? 'SHORT_TERM' : holdDays < 30 ? 'MEDIUM_TERM' : 'LONG_TERM';

    openLot = {
      wallet, cid_hex: marketCid, outcome, lot_id: Number(++lotCounter),
      opened_at: firstTs, closed_at: null, hold_seconds: Math.round(holdSec), hold_days: holdDays,
      entry_qty: totalQty, exit_qty: 0, entry_avg_price: costUsd / Math.max(totalQty, 1e-9),
      exit_avg_price: null, realized_pnl: 0, duration_category: durationCategory, position_status: 'OPEN',
    };
  }

  return { closedRows, openLot };
}

async function main() {
  const startTime = Date.now();
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIFO POSITION LIFECYCLE - ALL WALLETS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Clear existing data
  console.log('Step 1: Clearing existing data...');
  await ch.command({ query: 'TRUNCATE TABLE cascadian_clean.position_lifecycle' });
  await ch.command({ query: 'TRUNCATE TABLE cascadian_clean.wallet_time_metrics' });
  console.log('✓ Tables cleared\n');

  // Fetch ALL trades in one query
  console.log('Step 2: Fetching ALL trades (this will take 1-2 minutes)...');
  const tradesResult = await ch.query({
    query: `
      SELECT
        lower(wallet_address_norm) AS wallet,
        concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
        toInt32(outcome_index) AS outcome,
        timestamp AS ts,
        trade_direction AS dir,
        toFloat64(shares) AS qty,
        toFloat64(entry_price) AS px
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND outcome_index >= 0
      ORDER BY wallet, market_cid, outcome, timestamp
    `,
    format: 'JSONEachRow',
  });

  const allTrades = await tradesResult.json<Trade[]>();
  console.log(`✓ Fetched ${allTrades.length.toLocaleString()} trades\n`);

  // Group by wallet+market+outcome
  console.log('Step 3: Grouping by position...');
  const groups = new Map<string, Trade[]>();
  for (const trade of allTrades) {
    const key = `${trade.wallet}|${trade.market_cid}|${trade.outcome}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }
  console.log(`✓ Grouped into ${groups.size.toLocaleString()} positions\n`);

  // Process FIFO
  console.log('Step 4: Running FIFO (this will take 5-10 minutes)...');
  const allClosedRows: any[] = [];
  const allOpenRows: any[] = [];
  let processed = 0;

  for (const [key, trades] of groups.entries()) {
    const [wallet, marketCid, outcomeStr] = key.split('|');
    const outcome = parseInt(outcomeStr);
    const result = fifoLifecycle(wallet, marketCid, outcome, trades);
    if (result.closedRows.length > 0) allClosedRows.push(...result.closedRows);
    if (result.openLot) allOpenRows.push(result.openLot);

    processed++;
    if (processed % 10000 === 0) {
      const pct = ((processed / groups.size) * 100).toFixed(1);
      process.stdout.write(`\r  Processed ${processed.toLocaleString()} / ${groups.size.toLocaleString()} (${pct}%)...`);
    }
  }

  console.log(`\n✓ Processed ${processed.toLocaleString()} positions\n`);
  console.log(`  Closed lots: ${allClosedRows.length.toLocaleString()}`);
  console.log(`  Open lots: ${allOpenRows.length.toLocaleString()}\n`);

  // Insert to position_lifecycle
  console.log('Step 5: Inserting lifecycle data...');
  const allRows = [...allClosedRows, ...allOpenRows];

  if (allRows.length > 0) {
    const batchSize = 50000;
    let inserted = 0;

    for (let i = 0; i < allRows.length; i += batchSize) {
      const batch = allRows.slice(i, i + batchSize);
      const values = batch.map(r => {
        const closedAt = r.closed_at ? `'${r.closed_at}'` : 'NULL';
        const exitAvgPrice = r.exit_avg_price !== null ? r.exit_avg_price : 'NULL';
        return `('${r.wallet}','${r.cid_hex}',${r.outcome},${r.lot_id},'${r.opened_at}',${closedAt},${r.hold_seconds},${r.hold_days},${r.entry_qty},${r.exit_qty},${r.entry_avg_price},${exitAvgPrice},${r.realized_pnl},'${r.duration_category}','${r.position_status}',now())`;
      }).join(',');

      await ch.command({
        query: `INSERT INTO cascadian_clean.position_lifecycle (wallet, market_cid, outcome, lot_id, opened_at, closed_at, hold_seconds, hold_days, entry_qty, exit_qty, entry_avg_price, exit_avg_price, realized_pnl, duration_category, position_status, created_at) VALUES ${values}`
      });

      inserted += batch.length;
      const pct = ((inserted / allRows.length) * 100).toFixed(1);
      process.stdout.write(`\r  Inserted ${inserted.toLocaleString()} / ${allRows.length.toLocaleString()} (${pct}%)...`);
    }
    console.log(' Done!\n');
  }

  // Aggregate to wallet_time_metrics
  console.log('Step 6: Building wallet_time_metrics...');
  await ch.command({
    query: `
      INSERT INTO cascadian_clean.wallet_time_metrics
      SELECT wallet, count() AS positions_total, countIf(position_status = 'CLOSED') AS positions_closed,
        countIf(position_status = 'OPEN') AS positions_open,
        avg(hold_seconds) / 3600 AS avg_hold_hours, quantile(0.5)(hold_seconds) / 3600 AS median_hold_hours,
        max(hold_seconds) / 3600 AS max_hold_hours, min(hold_seconds) / 3600 AS min_hold_hours,
        countIf(position_status = 'CLOSED' AND duration_category = 'INTRADAY') / greatest(positions_closed, 1) * 100 AS pct_held_lt_1d,
        countIf(position_status = 'CLOSED' AND duration_category IN ('SHORT_TERM','MEDIUM_TERM','LONG_TERM')) / greatest(positions_closed, 1) * 100 AS pct_held_1_7d,
        countIf(position_status = 'CLOSED' AND hold_days >= 7) / greatest(positions_closed, 1) * 100 AS pct_held_gt_7d,
        countIf(position_status = 'CLOSED' AND hold_days >= 30) / greatest(positions_closed, 1) * 100 AS pct_held_gt_30d,
        countIf(duration_category = 'INTRADAY') AS count_intraday, countIf(duration_category = 'SHORT_TERM') AS count_short_term,
        countIf(duration_category = 'MEDIUM_TERM') AS count_medium_term, countIf(duration_category = 'LONG_TERM') AS count_long_term,
        sumIf(realized_pnl, duration_category = 'INTRADAY') AS intraday_pnl, sumIf(realized_pnl, duration_category = 'SHORT_TERM') AS short_term_pnl,
        sumIf(realized_pnl, duration_category = 'MEDIUM_TERM') AS medium_term_pnl, sumIf(realized_pnl, duration_category = 'LONG_TERM') AS long_term_pnl,
        sumIf(entry_qty * entry_avg_price, duration_category = 'INTRADAY') AS intraday_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'SHORT_TERM') AS short_term_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'MEDIUM_TERM') AS medium_term_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'LONG_TERM') AS long_term_volume_usd,
        now() AS updated_at
      FROM cascadian_clean.position_lifecycle GROUP BY wallet
    `,
  });
  console.log('✓ Wallet metrics aggregated\n');

  // Summary stats
  const walletCount = await ch.query({
    query: 'SELECT count() as cnt FROM cascadian_clean.wallet_time_metrics',
    format: 'JSONEachRow',
  });
  const wc = await walletCount.json<any[]>();

  const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Trades processed:        ${allTrades.length.toLocaleString()}`);
  console.log(`Positions analyzed:      ${groups.size.toLocaleString()}`);
  console.log(`Lifecycle lots created:  ${allRows.length.toLocaleString()}`);
  console.log(`Wallets with metrics:    ${wc[0].cnt.toLocaleString()}`);
  console.log(`Elapsed time:            ${elapsed} minutes`);
  console.log('');
  console.log('✅ COMPLETE - ALL WALLETS PROCESSED');
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n\n❌ FATAL ERROR:', err);
  process.exit(1);
});
