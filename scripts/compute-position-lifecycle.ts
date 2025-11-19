#!/usr/bin/env npx tsx
/**
 * FIFO Position Lifecycle Worker
 *
 * Computes position lifecycle with holding duration tracking.
 * Enables filtering whales (hold >7 days) vs swing traders (trade hourly).
 *
 * Architecture:
 * 1. Stream all wallet+market+outcome combinations
 * 2. For each key, fetch trades ordered by timestamp
 * 3. Match sells against oldest buy lots (FIFO)
 * 4. Calculate holding duration: exit_timestamp - entry_timestamp
 * 5. Categorize: INTRADAY (<1d), SHORT_TERM (1-7d), MEDIUM_TERM (7-30d), LONG_TERM (>30d)
 * 6. Insert closed positions and open positions to position_lifecycle
 * 7. Aggregate to wallet_time_metrics
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
  ts: string;
  dir: 'BUY' | 'SELL';
  qty: number;
  px: number;
}

interface Key {
  w: string;
  cid: string;
  o: number;
}

let lotCounter = 0n;

function fifoLifecycle(k: Key, trades: Trade[]) {
  type Lot = {
    id: bigint;
    openTs: string;
    qty: number;
    costQty: number;
    costUsd: number;
    avgPx: number;
  };

  const open: Lot[] = [];
  const closedRows: any[] = [];
  let openLot: any = null;

  const pushBuy = (ts: string, qty: number, px: number) => {
    open.push({
      id: ++lotCounter,
      openTs: ts,
      qty,
      costQty: qty,
      costUsd: qty * px,
      avgPx: px,
    });
  };

  const closeAgainst = (ts: string, sellQty: number, sellPx: number) => {
    while (sellQty > 0 && open.length) {
      const lot = open[0];
      const use = Math.min(sellQty, lot.qty);
      const realized = use * (sellPx - lot.avgPx);
      const holdSec = Math.max(
        0,
        (new Date(ts).getTime() - new Date(lot.openTs).getTime()) / 1000
      );
      const holdDays = holdSec / 86400;

      // Categorize by holding duration
      const durationCategory =
        holdDays < 1
          ? 'INTRADAY'
          : holdDays < 7
          ? 'SHORT_TERM'
          : holdDays < 30
          ? 'MEDIUM_TERM'
          : 'LONG_TERM';

      closedRows.push({
        wallet: k.w,
        cid_hex: k.cid,
        outcome: k.o,
        lot_id: Number(lot.id),
        opened_at: lot.openTs,
        closed_at: ts,
        hold_seconds: Math.round(holdSec),
        hold_days: holdDays,
        entry_qty: use,
        exit_qty: use,
        entry_avg_price: lot.avgPx,
        exit_avg_price: sellPx,
        realized_pnl: realized,
        duration_category: durationCategory,
        position_status: 'CLOSED',
      });

      lot.qty -= use;
      sellQty -= use;
      if (lot.qty <= 1e-9) open.shift();
    }
  };

  // Process trades in chronological order
  for (const t of trades) {
    if (t.dir === 'BUY') {
      pushBuy(t.ts, t.qty, t.px);
    } else {
      closeAgainst(t.ts, t.qty, t.px);
    }
  }

  // Handle remaining open positions
  if (open.length) {
    const totalQty = open.reduce((s, l) => s + l.qty, 0);
    const costUsd = open.reduce((s, l) => s + l.qty * l.avgPx, 0);
    const firstTs = open[0].openTs;
    const holdSec = Math.max(0, (Date.now() - new Date(firstTs).getTime()) / 1000);
    const holdDays = holdSec / 86400;

    const durationCategory =
      holdDays < 1
        ? 'INTRADAY'
        : holdDays < 7
        ? 'SHORT_TERM'
        : holdDays < 30
        ? 'MEDIUM_TERM'
        : 'LONG_TERM';

    openLot = {
      wallet: k.w,
      cid_hex: k.cid,
      outcome: k.o,
      lot_id: Number(++lotCounter),
      opened_at: firstTs,
      closed_at: null,
      hold_seconds: Math.round(holdSec),
      hold_days: holdDays,
      entry_qty: totalQty,
      exit_qty: 0,
      entry_avg_price: costUsd / Math.max(totalQty, 1e-9),
      exit_avg_price: null,
      realized_pnl: 0,
      duration_category: durationCategory,
      position_status: 'OPEN',
    };
  }

  return { closedRows, openLot };
}

async function main() {
  const startTime = Date.now();
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIFO POSITION LIFECYCLE WORKER');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Started at: ${new Date().toISOString()}\n`);

  // Step 1: Create tables
  console.log('Step 1: Creating tables...');
  const schemaSQL = readFileSync('./create-position-lifecycle-tables.sql', 'utf-8');
  const statements = schemaSQL.split(';').filter(s => s.trim() && !s.trim().startsWith('--'));

  for (const stmt of statements) {
    if (stmt.trim()) {
      await ch.command({ query: stmt });
    }
  }
  console.log('✓ Tables created\n');

  // Step 2: Get all wallet+market+outcome keys
  console.log('Step 2: Fetching all position keys...');
  const keys = await ch.query({
    query: `
      SELECT DISTINCT
        lower(wallet_address_norm) AS wallet,
        concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') AS market_cid,
        toInt32(outcome_index) AS outcome
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
        AND outcome_index >= 0
      ORDER BY wallet, market_cid, outcome
    `,
    format: 'JSONEachRow',
  });

  const keyList = await keys.json<{ wallet: string; market_cid: string; outcome: number }[]>();
  console.log(`✓ Found ${keyList.length.toLocaleString()} position keys\n`);

  // Step 3: Process each key with FIFO
  console.log('Step 3: Processing FIFO lifecycles...');
  const allClosedRows: any[] = [];
  const allOpenRows: any[] = [];
  let processed = 0;

  for (const k of keyList) {
    processed++;
    if (processed % 1000 === 0) {
      process.stdout.write(`\r  Processed ${processed.toLocaleString()} / ${keyList.length.toLocaleString()} keys...`);
    }

    // Fetch trades for this key
    const tradesResult = await ch.query({
      query: `
        SELECT
          timestamp AS ts,
          trade_direction AS dir,
          toFloat64(shares) AS qty,
          toFloat64(entry_price) AS px
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${k.wallet}')
          AND concat('0x', left(replaceAll(condition_id_norm,'0x',''),62),'00') = '${k.market_cid}'
          AND toInt32(outcome_index) = ${k.outcome}
        ORDER BY timestamp ASC
      `,
      format: 'JSONEachRow',
    });

    const trades = await tradesResult.json<Trade[]>();
    if (trades.length === 0) continue;

    // Run FIFO
    const result = fifoLifecycle({ w: k.wallet, cid: k.market_cid, o: k.outcome }, trades);

    if (result.closedRows.length > 0) {
      allClosedRows.push(...result.closedRows);
    }
    if (result.openLot) {
      allOpenRows.push(result.openLot);
    }
  }

  console.log(`\n✓ Processed ${processed.toLocaleString()} keys\n`);
  console.log(`  Closed positions: ${allClosedRows.length.toLocaleString()}`);
  console.log(`  Open positions: ${allOpenRows.length.toLocaleString()}\n`);

  // Step 4: Insert to position_lifecycle
  console.log('Step 4: Inserting to position_lifecycle...');
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
        query: `
          INSERT INTO cascadian_clean.position_lifecycle
          (wallet, market_cid, outcome, lot_id, opened_at, closed_at, hold_seconds, hold_days,
           entry_qty, exit_qty, entry_avg_price, exit_avg_price, realized_pnl,
           duration_category, position_status, created_at)
          VALUES ${values}
        `,
      });

      inserted += batch.length;
      process.stdout.write(`\r  Inserted ${inserted.toLocaleString()} / ${allRows.length.toLocaleString()} rows...`);
    }
    console.log(' Done!\n');
  }

  // Step 5: Aggregate to wallet_time_metrics
  console.log('Step 5: Building wallet_time_metrics...');
  await ch.command({
    query: `
      INSERT INTO cascadian_clean.wallet_time_metrics
      SELECT
        wallet,

        -- Position counts
        count() AS positions_total,
        countIf(position_status = 'CLOSED') AS positions_closed,
        countIf(position_status = 'OPEN') AS positions_open,

        -- Holding duration stats (closed only)
        avg(hold_seconds) / 3600 AS avg_hold_hours,
        quantile(0.5)(hold_seconds) / 3600 AS median_hold_hours,
        max(hold_seconds) / 3600 AS max_hold_hours,
        min(hold_seconds) / 3600 AS min_hold_hours,

        -- Distribution percentages (closed only)
        countIf(position_status = 'CLOSED' AND duration_category = 'INTRADAY') / positions_closed * 100 AS pct_held_lt_1d,
        countIf(position_status = 'CLOSED' AND duration_category IN ('SHORT_TERM','MEDIUM_TERM','LONG_TERM')) / positions_closed * 100 AS pct_held_1_7d,
        countIf(position_status = 'CLOSED' AND hold_days >= 7) / positions_closed * 100 AS pct_held_gt_7d,
        countIf(position_status = 'CLOSED' AND hold_days >= 30) / positions_closed * 100 AS pct_held_gt_30d,

        -- Counts by category
        countIf(duration_category = 'INTRADAY') AS count_intraday,
        countIf(duration_category = 'SHORT_TERM') AS count_short_term,
        countIf(duration_category = 'MEDIUM_TERM') AS count_medium_term,
        countIf(duration_category = 'LONG_TERM') AS count_long_term,

        -- P&L by category
        sumIf(realized_pnl, duration_category = 'INTRADAY') AS intraday_pnl,
        sumIf(realized_pnl, duration_category = 'SHORT_TERM') AS short_term_pnl,
        sumIf(realized_pnl, duration_category = 'MEDIUM_TERM') AS medium_term_pnl,
        sumIf(realized_pnl, duration_category = 'LONG_TERM') AS long_term_pnl,

        -- Volume by category
        sumIf(entry_qty * entry_avg_price, duration_category = 'INTRADAY') AS intraday_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'SHORT_TERM') AS short_term_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'MEDIUM_TERM') AS medium_term_volume_usd,
        sumIf(entry_qty * entry_avg_price, duration_category = 'LONG_TERM') AS long_term_volume_usd,

        now() AS updated_at
      FROM cascadian_clean.position_lifecycle
      GROUP BY wallet
    `,
  });
  console.log('✓ Wallet metrics aggregated\n');

  // Step 6: Validation queries
  console.log('Step 6: Validation...');

  const lifecycleCount = await ch.query({
    query: `
      SELECT
        count() AS total_rows,
        countIf(position_status = 'CLOSED') AS closed_rows,
        countIf(position_status = 'OPEN') AS open_rows
      FROM cascadian_clean.position_lifecycle
    `,
    format: 'JSONEachRow',
  });
  const lc = await lifecycleCount.json<any[]>();
  console.log(`  position_lifecycle: ${lc[0].total_rows.toLocaleString()} rows (${lc[0].closed_rows.toLocaleString()} closed, ${lc[0].open_rows.toLocaleString()} open)`);

  const metricsCount = await ch.query({
    query: `SELECT count() AS cnt FROM cascadian_clean.wallet_time_metrics`,
    format: 'JSONEachRow',
  });
  const mc = await metricsCount.json<any[]>();
  console.log(`  wallet_time_metrics: ${mc[0].cnt.toLocaleString()} wallets\n`);

  // Show sample whales
  console.log('Sample Whales (hold >7 days):');
  const whales = await ch.query({
    query: `
      SELECT
        wallet,
        positions_total,
        avg_hold_hours,
        pct_held_gt_7d,
        long_term_pnl,
        long_term_volume_usd
      FROM cascadian_clean.wallet_time_metrics
      WHERE pct_held_gt_7d >= 50
        AND positions_total >= 10
        AND long_term_volume_usd > 10000
      ORDER BY long_term_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const whaleData = await whales.json<any[]>();
  whaleData.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet.substring(0, 12)}... - ${w.positions_total} positions, avg ${(parseFloat(w.avg_hold_hours) / 24).toFixed(1)} days, ${parseFloat(w.pct_held_gt_7d).toFixed(1)}% long-term, $${parseFloat(w.long_term_pnl).toLocaleString()} P&L`);
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Position keys processed: ${keyList.length.toLocaleString()}`);
  console.log(`Lifecycle rows created:  ${allRows.length.toLocaleString()}`);
  console.log(`Wallets with metrics:    ${mc[0].cnt.toLocaleString()}`);
  console.log(`Elapsed time:            ${elapsed}s`);
  console.log('');
  console.log('✅ COMPLETE');
  console.log('');
  console.log('Next: Query wallet_time_metrics to filter whales vs swing traders');
  console.log('');

  await ch.close();
}

main().catch((err) => {
  console.error('\n\n❌ FATAL ERROR:', err);
  process.exit(1);
});
