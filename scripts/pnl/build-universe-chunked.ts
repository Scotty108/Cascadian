#!/usr/bin/env npx tsx
/**
 * Build Universe-Wide PnL - Chunked Approach V2
 *
 * Process all 1.7M wallets in chunks using temp table approach.
 * Uses INSERT into temp table instead of IN clause to avoid query size limits.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const TOKEN_MAP_TABLE = 'pm_token_to_condition_map_v5';
const RESOLUTIONS_TABLE = 'pm_condition_resolutions';
const TRADER_EVENTS_TABLE = 'pm_trader_events_v2';
const OUTPUT_TABLE = 'pm_wallet_pnl_universe_v1';
const TEMP_WALLET_TABLE = 'tmp_chunk_wallets';

const CHUNK_SIZE = 2000; // Smaller chunks for better progress tracking
const MIN_PNL_FINAL = 500;  // Final filter
const PROGRESS_INTERVAL = 10; // Report progress every N chunks

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('BUILD UNIVERSE PNL - CHUNKED APPROACH V2 (TEMP TABLE)');
  console.log('='.repeat(80));
  const startTime = Date.now();

  // Step 1: Get all distinct wallets (simpler query, no heavy aggregation)
  console.log('Step 1: Getting all distinct wallets...');
  const walletsQ = await clickhouse.query({
    query: `SELECT DISTINCT lower(trader_wallet) as wallet FROM ${TRADER_EVENTS_TABLE}`,
    format: 'JSONEachRow'
  });
  const walletRows = await walletsQ.json() as any[];
  const wallets = walletRows.map(w => w.wallet);
  console.log(`  Found ${wallets.length.toLocaleString()} wallets total`);

  // Step 2: Create output table and temp table
  console.log('\nStep 2: Creating output table and temp table...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${OUTPUT_TABLE}` });
  await clickhouse.command({
    query: `
      CREATE TABLE ${OUTPUT_TABLE} (
        wallet String,
        polymarket_url String,
        realized_pnl Float64,
        capital_deployed Float64,
        total_return Float64,
        n_markets UInt32,
        win_count UInt32,
        loss_count UInt32,
        win_rate Float64,
        roi_pct Float64,
        first_trade_at DateTime,
        last_trade_at DateTime,
        days_active UInt32,
        cagr Float64,
        computed_at DateTime DEFAULT now()
      ) ENGINE = MergeTree() ORDER BY (realized_pnl, wallet)
    `
  });

  // Create temp table for chunk wallets
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_WALLET_TABLE}` });
  await clickhouse.command({
    query: `CREATE TABLE ${TEMP_WALLET_TABLE} (wallet String) ENGINE = Memory`
  });

  // Step 3: Load resolutions
  console.log('\nStep 3: Loading resolutions...');
  const resQ = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        toUInt8(JSONExtractInt(payout_numerators, 1) > 0) as payout_0,
        toUInt8(JSONExtractInt(payout_numerators, 2) > 0) as payout_1
      FROM ${RESOLUTIONS_TABLE}
    `,
    format: 'JSONEachRow'
  });
  const resolutions = new Map<string, { payout_0: number; payout_1: number }>();
  for (const r of await resQ.json() as any[]) {
    resolutions.set(r.condition_id, { payout_0: r.payout_0, payout_1: r.payout_1 });
  }
  console.log(`  Loaded ${resolutions.size.toLocaleString()} resolutions`);

  // Step 4: Process in chunks
  console.log('\nStep 4: Processing wallets in chunks...');
  let processed = 0;
  let inserted = 0;

  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    const chunk = wallets.slice(i, Math.min(i + CHUNK_SIZE, wallets.length));

    // Insert chunk wallets into temp table (truncate first)
    await clickhouse.command({ query: `TRUNCATE TABLE ${TEMP_WALLET_TABLE}` });
    await clickhouse.insert({
      table: TEMP_WALLET_TABLE,
      values: chunk.map(w => ({ wallet: w })),
      format: 'JSONEachRow'
    });

    // Get deduped events for this chunk using INNER JOIN against temp table
    const eventsQ = await clickhouse.query({
      query: `
        SELECT
          d.wallet,
          m.condition_id,
          m.outcome_index,
          d.side,
          d.usdc_amount / 1e6 as usdc,
          d.token_amount / 1e6 as tokens,
          d.trade_time
        FROM (
          SELECT
            e.event_id,
            lower(any(e.trader_wallet)) as wallet,
            any(e.trade_time) as trade_time,
            any(e.token_id) as token_id,
            any(e.side) as side,
            any(e.usdc_amount) as usdc_amount,
            any(e.token_amount) as token_amount
          FROM ${TRADER_EVENTS_TABLE} e
          INNER JOIN ${TEMP_WALLET_TABLE} t ON lower(e.trader_wallet) = t.wallet
          GROUP BY e.event_id
        ) d
        JOIN ${TOKEN_MAP_TABLE} m ON d.token_id = m.token_id_dec
      `,
      format: 'JSONEachRow'
    });
    const events = await eventsQ.json() as any[];

    // Group by wallet and compute metrics
    const walletData = new Map<string, {
      positions: Map<string, { buy_usdc: number; sell_usdc: number; buy_tokens: number; sell_tokens: number; condition_id: string; outcome_index: number }>;
      first_trade: Date;
      last_trade: Date;
    }>();

    for (const e of events) {
      if (!walletData.has(e.wallet)) {
        walletData.set(e.wallet, {
          positions: new Map(),
          first_trade: new Date(e.trade_time),
          last_trade: new Date(e.trade_time),
        });
      }
      const wd = walletData.get(e.wallet)!;
      const tradeTime = new Date(e.trade_time);
      if (tradeTime < wd.first_trade) wd.first_trade = tradeTime;
      if (tradeTime > wd.last_trade) wd.last_trade = tradeTime;

      const key = `${e.condition_id}_${e.outcome_index}`;
      if (!wd.positions.has(key)) {
        wd.positions.set(key, { buy_usdc: 0, sell_usdc: 0, buy_tokens: 0, sell_tokens: 0, condition_id: e.condition_id, outcome_index: e.outcome_index });
      }
      const pos = wd.positions.get(key)!;
      if (e.side === 'buy') {
        pos.buy_usdc += e.usdc;
        pos.buy_tokens += e.tokens;
      } else {
        pos.sell_usdc += e.usdc;
        pos.sell_tokens += e.tokens;
      }
    }

    // Compute PnL for each wallet
    const results: any[] = [];
    for (const [wallet, wd] of walletData) {
      let totalBuyUsdc = 0;
      let sellProfit = 0;
      let redemptionProfit = 0;
      let resolutionLoss = 0;
      const marketPnL = new Map<string, number>();

      for (const [, pos] of wd.positions) {
        if (pos.buy_tokens === 0) continue;
        totalBuyUsdc += pos.buy_usdc;
        const avgBuyPrice = pos.buy_usdc / pos.buy_tokens;
        const netTokens = pos.buy_tokens - pos.sell_tokens;
        let posPnL = 0;

        // Sell profit (clamped)
        if (pos.sell_tokens > 0) {
          const ownedSold = Math.min(pos.buy_tokens, pos.sell_tokens);
          const proportion = ownedSold / pos.sell_tokens;
          const proceeds = pos.sell_usdc * proportion;
          const cost = ownedSold * avgBuyPrice;
          const sp = proceeds - cost;
          sellProfit += sp;
          posPnL += sp;
        }

        // Resolution
        if (netTokens > 0) {
          const res = resolutions.get(pos.condition_id.toLowerCase());
          if (res) {
            const payout = pos.outcome_index === 0 ? res.payout_0 : res.payout_1;
            const cost = netTokens * avgBuyPrice;
            if (payout > 0) {
              const rp = netTokens * payout - cost;
              redemptionProfit += rp;
              posPnL += rp;
            } else {
              resolutionLoss -= cost;
              posPnL -= cost;
            }
          }
        }

        const cid = pos.condition_id.toLowerCase();
        marketPnL.set(cid, (marketPnL.get(cid) || 0) + posPnL);
      }

      const realizedPnL = sellProfit + redemptionProfit + resolutionLoss;
      if (realizedPnL < MIN_PNL_FINAL) continue;

      let winCount = 0, lossCount = 0;
      for (const [cid, pnl] of marketPnL) {
        if (resolutions.has(cid)) {
          if (pnl > 0) winCount++;
          else if (pnl < 0) lossCount++;
        }
      }

      const daysActive = Math.max(1, Math.ceil((wd.last_trade.getTime() - wd.first_trade.getTime()) / (1000 * 60 * 60 * 24)) + 1);
      const totalReturn = totalBuyUsdc > 0 ? realizedPnL / totalBuyUsdc : 0;
      const cagr = totalBuyUsdc > 0 && daysActive > 0 ? Math.pow(1 + totalReturn, 365 / daysActive) - 1 : 0;

      results.push({
        wallet,
        polymarket_url: `https://polymarket.com/profile/${wallet}`,
        realized_pnl: realizedPnL,
        capital_deployed: totalBuyUsdc,
        total_return: totalReturn,
        n_markets: wd.positions.size,
        win_count: winCount,
        loss_count: lossCount,
        win_rate: (winCount + lossCount) > 0 ? winCount / (winCount + lossCount) : 0,
        roi_pct: totalReturn * 100,
        first_trade_at: wd.first_trade.toISOString().replace('T', ' ').slice(0, 19),
        last_trade_at: wd.last_trade.toISOString().replace('T', ' ').slice(0, 19),
        days_active: daysActive,
        cagr: isFinite(cagr) ? cagr : 0,
      });
    }

    if (results.length > 0) {
      await clickhouse.insert({ table: OUTPUT_TABLE, values: results, format: 'JSONEachRow' });
      inserted += results.length;
    }
    processed += chunk.length;
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(wallets.length / CHUNK_SIZE);
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const pctComplete = ((processed / wallets.length) * 100).toFixed(1);
    if (chunkNum % PROGRESS_INTERVAL === 0 || chunkNum === 1 || processed === wallets.length) {
      console.log(`  [${elapsed}m] Chunk ${chunkNum}/${totalChunks} (${pctComplete}%) - ${processed.toLocaleString()}/${wallets.length.toLocaleString()} wallets, ${inserted.toLocaleString()} inserted w/pnl>=$${MIN_PNL_FINAL}`);
    }
  }

  // Summary
  console.log('\nStep 5: Summary...');
  const summaryQ = await clickhouse.query({
    query: `SELECT count() as cnt, round(avg(realized_pnl), 2) as avg, round(max(realized_pnl), 2) as max FROM ${OUTPUT_TABLE}`,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQ.json() as any[])[0];
  console.log(`  Total wallets with pnl >= $${MIN_PNL_FINAL}: ${Number(summary.cnt).toLocaleString()}`);
  console.log(`  Avg PnL: $${summary.avg}, Max: $${summary.max}`);

  // Export
  console.log('\nStep 6: Exporting CSV...');
  const exportQ = await clickhouse.query({
    query: `SELECT * FROM ${OUTPUT_TABLE} ORDER BY realized_pnl DESC`,
    format: 'CSVWithNames'
  });
  const csv = await exportQ.text();
  const filename = `tmp/universe_pnl500_plus_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
  fs.writeFileSync(filename, csv);
  console.log(`  Exported to ${filename}`);

  // Cleanup temp table
  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${TEMP_WALLET_TABLE}` });

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nCompleted in ${elapsed} minutes`);

  await clickhouse.close();
}

main().catch(console.error);
