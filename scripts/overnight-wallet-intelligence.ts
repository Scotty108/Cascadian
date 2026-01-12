/**
 * Overnight Wallet Intelligence Batch Processor
 *
 * Processes 18K high-confidence wallets to compute per-trade metrics.
 * Writes progress to a log file with ETAs.
 *
 * Run: npx tsx scripts/overnight-wallet-intelligence.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { computeTradeMetrics, aggregateWalletMetrics, RawTrade, WalletTradeMetrics } from '../lib/wallet-intelligence/tradeMetrics';
import { writeFileSync, appendFileSync } from 'fs';

const PROGRESS_FILE = 'overnight-progress.log';
const BATCH_SIZE = 100; // Process 100 wallets at a time
const CONCURRENT_WALLETS = 5; // Process 5 wallets concurrently

// ============ Progress Logging ============

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  console.log(msg);
  appendFileSync(PROGRESS_FILE, line);
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ============ Database Operations ============

async function createTables() {
  log('Creating tables...');

  // Per-trade metrics table
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_trade_metrics_v1
      (
        wallet String,
        trade_id String,
        ts DateTime,
        condition_id String,
        side String,
        action String,
        qty Float64,
        price_side Float64,
        notional_usd Float64,
        fee_usd Float64,
        cost_basis_usd Nullable(Float64),
        realized_pnl_usd Nullable(Float64),
        realized_roi Nullable(Float64),
        clv_1h Nullable(Float64),
        clv_4h Nullable(Float64),
        clv_24h Nullable(Float64),
        clv_72h Nullable(Float64),
        outcome_side Nullable(UInt8),
        is_resolved UInt8,
        category String,
        event_id String,
        computed_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY (wallet, trade_id)
    `
  });

  // Wallet aggregate metrics table
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_wallet_aggregate_metrics_v1
      (
        wallet String,
        total_trades UInt32,
        buy_trades UInt32,
        sell_trades UInt32,
        resolved_trades UInt32,
        total_volume_usd Float64,
        total_fees_usd Float64,
        total_pnl_usd Float64,
        avg_trade_pnl_usd Float64,
        win_rate Float64,
        avg_win_roi Float64,
        avg_loss_roi Float64,
        avg_roi Float64,
        median_roi Float64,
        roi_p05 Float64,
        roi_p95 Float64,
        avg_clv_24h Float64,
        clv_win_rate Float64,
        unique_markets UInt32,
        unique_categories UInt32,
        computed_at DateTime DEFAULT now()
      )
      ENGINE = ReplacingMergeTree(computed_at)
      ORDER BY wallet
    `
  });

  log('Tables created.');
}

async function getWalletList(): Promise<string[]> {
  const result = await clickhouse.query({
    query: `SELECT wallet FROM pm_high_confidence_wallets ORDER BY wallet`,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as Array<{ wallet: string }>;
  return rows.map(r => r.wallet);
}

async function getResolutions(): Promise<Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>> {
  log('Loading resolutions...');
  const result = await clickhouse.query({
    query: `
      SELECT
        lower(condition_id) as condition_id,
        resolved_at,
        payout_numerators
      FROM pm_condition_resolutions
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as Array<{
    condition_id: string;
    resolved_at: string;
    payout_numerators: string;
  }>;

  const map = new Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>();
  for (const r of rows) {
    // Parse payout_numerators - stored as "[1,0]" string
    let payoutYes = 0;
    try {
      const arr = JSON.parse(r.payout_numerators);
      payoutYes = arr[0] || 0;
    } catch {}
    map.set(r.condition_id, {
      resolved_at: new Date(r.resolved_at),
      outcome_yes: payoutYes > 0 ? 1 : 0,
    });
  }
  log(`Loaded ${map.size} resolutions.`);
  return map;
}

async function getTokenMapping(): Promise<Map<string, { condition_id: string; outcome_index: number }>> {
  log('Loading token mapping...');
  const result = await clickhouse.query({
    query: `
      SELECT
        token_id_dec,
        lower(condition_id) as condition_id,
        outcome_index
      FROM pm_token_to_condition_map_current
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }>;

  const map = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const r of rows) {
    map.set(r.token_id_dec, {
      condition_id: r.condition_id,
      outcome_index: r.outcome_index,
    });
  }
  log(`Loaded ${map.size} token mappings.`);
  return map;
}

async function getWalletTrades(wallet: string, tokenMap: Map<string, { condition_id: string; outcome_index: number }>): Promise<RawTrade[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        event_id,
        trade_time,
        token_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        fee_amount / 1e6 as fee
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
      ORDER BY trade_time
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as Array<{
    event_id: string;
    trade_time: string;
    token_id: string;
    side: string;
    usdc: number;
    tokens: number;
    fee: number;
  }>;

  const trades: RawTrade[] = [];
  for (const r of rows) {
    const mapping = tokenMap.get(r.token_id);
    if (!mapping) continue;

    // Determine YES/NO side based on outcome_index
    const marketSide = mapping.outcome_index === 0 ? 'YES' : 'NO';

    // Determine BUY/SELL based on the "side" field from CLOB
    const action = r.side === 'buy' ? 'BUY' : 'SELL';

    // Calculate price
    const price_yes = r.tokens > 0 ? r.usdc / r.tokens : 0;

    trades.push({
      trade_id: r.event_id,
      ts: new Date(r.trade_time),
      wallet,
      condition_id: mapping.condition_id,
      token_id: r.token_id,
      outcome_index: mapping.outcome_index,
      side: marketSide,
      action,
      price_yes,
      qty: r.tokens,
      notional_usd: r.usdc,
      fee_usd: r.fee,
    });
  }

  return trades;
}

// Simple price lookup - derive from last trade before anchor time
const priceLookup = {
  getMidYesAt: (_conditionId: string, _ts: Date): number | null => {
    // TODO: Implement actual historical price lookup
    // For now, return null (CLV will be null)
    return null;
  }
};

async function processWallet(
  wallet: string,
  tokenMap: Map<string, { condition_id: string; outcome_index: number }>,
  resolutions: Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>
): Promise<{ trades: number; metrics: WalletTradeMetrics } | null> {
  try {
    const rawTrades = await getWalletTrades(wallet, tokenMap);
    if (!rawTrades.length) return null;

    const tradeMetrics = computeTradeMetrics(rawTrades, resolutions, priceLookup);
    const aggregateMetrics = aggregateWalletMetrics(tradeMetrics);

    // Insert trade metrics
    if (tradeMetrics.length > 0) {
      const values = tradeMetrics.map(t => ({
        wallet: t.wallet,
        trade_id: t.trade_id,
        ts: t.ts.toISOString().replace('T', ' ').replace('Z', ''),
        condition_id: t.condition_id,
        side: t.side,
        action: t.action,
        qty: t.qty,
        price_side: t.price_side,
        notional_usd: t.notional_usd,
        fee_usd: t.fee_usd,
        cost_basis_usd: t.cost_basis_usd,
        realized_pnl_usd: t.realized_pnl_usd,
        realized_roi: t.realized_roi,
        clv_1h: t.clv_1h,
        clv_4h: t.clv_4h,
        clv_24h: t.clv_24h,
        clv_72h: t.clv_72h,
        outcome_side: t.outcome_side,
        is_resolved: t.is_resolved ? 1 : 0,
        category: t.category,
        event_id: t.event_id,
      }));

      await clickhouse.insert({
        table: 'pm_wallet_trade_metrics_v1',
        values,
        format: 'JSONEachRow',
      });
    }

    // Insert aggregate metrics
    await clickhouse.insert({
      table: 'pm_wallet_aggregate_metrics_v1',
      values: [{
        wallet,
        ...aggregateMetrics,
      }],
      format: 'JSONEachRow',
    });

    return { trades: rawTrades.length, metrics: aggregateMetrics };
  } catch (err) {
    log(`ERROR processing ${wallet}: ${err}`);
    return null;
  }
}

async function processBatch(
  wallets: string[],
  tokenMap: Map<string, { condition_id: string; outcome_index: number }>,
  resolutions: Map<string, { resolved_at: Date; outcome_yes: 0 | 1 }>
): Promise<{ processed: number; trades: number; errors: number }> {
  let processed = 0;
  let totalTrades = 0;
  let errors = 0;

  // Process in small concurrent batches
  for (let i = 0; i < wallets.length; i += CONCURRENT_WALLETS) {
    const batch = wallets.slice(i, i + CONCURRENT_WALLETS);
    const results = await Promise.all(
      batch.map(w => processWallet(w, tokenMap, resolutions))
    );

    for (const result of results) {
      if (result) {
        processed++;
        totalTrades += result.trades;
      } else {
        errors++;
      }
    }
  }

  return { processed, trades: totalTrades, errors };
}

async function main() {
  writeFileSync(PROGRESS_FILE, ''); // Clear log
  const startTime = Date.now();

  log('='.repeat(60));
  log('OVERNIGHT WALLET INTELLIGENCE BATCH PROCESSOR');
  log('='.repeat(60));
  log('');
  log('NOTE: PnL calculations need validation - collecting data tonight,');
  log('will verify/fix calculations tomorrow.');
  log('');

  try {
    // Setup
    await createTables();
    const wallets = await getWalletList();
    const tokenMap = await getTokenMapping();
    const resolutions = await getResolutions();

    const totalWallets = wallets.length;
    log(`\nProcessing ${totalWallets} wallets...`);
    log(`Start time: ${new Date().toISOString()}`);

    let processedTotal = 0;
    let tradesTotal = 0;
    let errorsTotal = 0;

    // Process in batches
    for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalWallets / BATCH_SIZE);
      const batch = wallets.slice(i, i + BATCH_SIZE);
      const batchStart = Date.now();

      const result = await processBatch(batch, tokenMap, resolutions);
      processedTotal += result.processed;
      tradesTotal += result.trades;
      errorsTotal += result.errors;

      const batchDuration = Date.now() - batchStart;
      const elapsed = Date.now() - startTime;
      const progress = (i + batch.length) / totalWallets;
      const eta = progress > 0 ? (elapsed / progress) - elapsed : 0;

      log(`Batch ${batchNum}/${totalBatches}: ${result.processed}/${batch.length} wallets, ${result.trades} trades | ` +
          `Total: ${processedTotal}/${totalWallets} (${(progress * 100).toFixed(1)}%) | ` +
          `ETA: ${formatDuration(eta)} | Elapsed: ${formatDuration(elapsed)}`);
    }

    const totalDuration = Date.now() - startTime;

    log('\n' + '='.repeat(60));
    log('COMPLETED');
    log('='.repeat(60));
    log(`Total wallets processed: ${processedTotal}/${totalWallets}`);
    log(`Total trades processed: ${tradesTotal}`);
    log(`Errors: ${errorsTotal}`);
    log(`Duration: ${formatDuration(totalDuration)}`);
    log(`End time: ${new Date().toISOString()}`);

  } catch (err) {
    log(`FATAL ERROR: ${err}`);
    throw err;
  }
}

main().catch(console.error);
