#!/usr/bin/env npx tsx
/**
 * FIFO Position Lifecycle Worker - FAST BULK VERSION
 *
 * Fetches ALL trades for audit wallets in ONE query, processes in-memory.
 * ETA: 2-5 minutes instead of 3 hours.
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

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
  type Lot = {
    id: bigint;
    openTs: string;
    qty: number;
    avgPx: number;
  };

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
  console.log('FIFO POSITION LIFECYCLE WORKER - FAST BULK VERSION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Step 1: Create tables
  console.log('Step 1: Creating tables...');
  const schemaSQL = readFileSync('./create-position-lifecycle-tables.sql', 'utf-8');
  const statements = schemaSQL.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));
  for (const stmt of statements) {
    if (stmt.trim()) await ch.command({ query: stmt });
  }
  console.log('✓ Tables created\n');

  // Step 2: Fetch ALL trades for audit wallets in ONE query
  console.log('Step 2: Fetching all trades for audit wallets (bulk)...');
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
      WHERE lower(wallet_address_norm) IN (
        '0x4ce73141dbfce41e65db3723e31059a730f0abad','0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144',
        '0x1f0a343513aa6060488fabe96960e6d1e177f7aa','0x06dcaa14f57d8a0573f5dc5940565e6de667af59',
        '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed','0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f',
        '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37','0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8',
        '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db','0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8',
        '0x662244931c392df70bd064fa91f838eea0bfd7a9','0x2e0b70d482e6b389e81dea528be57d825dd48070',
        '0x3b6fd06a595d71c70afb3f44414be1c11304340b','0xd748c701ad93cfec32a3420e10f3b08e68612125',
        '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397','0xd06f0f7719df1b3b75b607923536b3250825d4a6',
        '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8','0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
        '0x7f3c8979d0afa00007bae4747d5347122af05613','0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
        '0x8e9eedf20dfa70956d49f608a205e402d9df38e4','0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
        '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
      )
      ORDER BY wallet, market_cid, outcome, timestamp
    `,
    format: 'JSONEachRow',
  });

  const allTrades = await tradesResult.json<Trade[]>();
  console.log(`✓ Fetched ${allTrades.length.toLocaleString()} trades\n`);

  // Step 3: Group by wallet+market+outcome and process FIFO
  console.log('Step 3: Grouping and processing FIFO...');
  const groups = new Map<string, Trade[]>();
  for (const trade of allTrades) {
    const key = `${trade.wallet}|${trade.market_cid}|${trade.outcome}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(trade);
  }

  console.log(`✓ Grouped into ${groups.size.toLocaleString()} positions\n`);

  const allClosedRows: any[] = [];
  const allOpenRows: any[] = [];
  let processed = 0;

  console.log('Step 4: Running FIFO on each position...');
  for (const [key, trades] of groups.entries()) {
    const [wallet, marketCid, outcomeStr] = key.split('|');
    const outcome = parseInt(outcomeStr);
    const result = fifoLifecycle(wallet, marketCid, outcome, trades);
    if (result.closedRows.length > 0) allClosedRows.push(...result.closedRows);
    if (result.openLot) allOpenRows.push(result.openLot);

    processed++;
    if (processed % 1000 === 0) {
      process.stdout.write(`\r  Processed ${processed.toLocaleString()} / ${groups.size.toLocaleString()} positions...`);
    }
  }

  console.log(`\n✓ Processed ${processed.toLocaleString()} positions\n`);
  console.log(`  Closed lots: ${allClosedRows.length.toLocaleString()}`);
  console.log(`  Open lots: ${allOpenRows.length.toLocaleString()}\n`);

  // Step 5: Insert to position_lifecycle
  console.log('Step 5: Inserting to position_lifecycle...');
  const allRows = [...allClosedRows, ...allOpenRows];

  if (allRows.length > 0) {
    const batchSize = 10000;
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
      process.stdout.write(`\r  Inserted ${inserted.toLocaleString()} / ${allRows.length.toLocaleString()} rows...`);
    }
    console.log(' Done!\n');
  }

  // Step 6: Aggregate to wallet_time_metrics
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

  // Step 7: Sample results
  console.log('Step 7: Sample wallet metrics:');
  const sample = await ch.query({
    query: `SELECT wallet, positions_total, positions_closed, positions_open, round(avg_hold_hours / 24, 1) AS avg_hold_days, round(pct_held_gt_7d, 1) AS pct_long_term, round(pct_held_lt_1d, 1) AS pct_intraday FROM cascadian_clean.wallet_time_metrics ORDER BY positions_total DESC LIMIT 10`,
    format: 'JSONEachRow',
  });
  const sampleData = await sample.json<any[]>();
  sampleData.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet.substring(0, 12)}... - ${w.positions_total} total (${w.positions_closed} closed, ${w.positions_open} open), avg ${w.avg_hold_days} days, ${w.pct_long_term}% long-term`);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Trades fetched:          ${allTrades.length.toLocaleString()}`);
  console.log(`Positions processed:     ${groups.size.toLocaleString()}`);
  console.log(`Lifecycle rows created:  ${allRows.length.toLocaleString()}`);
  console.log(`Wallets with metrics:    ${sampleData.length}`);
  console.log(`Elapsed time:            ${elapsed}s`);
  console.log('');
  console.log('✅ COMPLETE - FAST BULK VALIDATION');
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n\n❌ FATAL ERROR:', err);
  process.exit(1);
});
