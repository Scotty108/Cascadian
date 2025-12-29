#!/usr/bin/env npx tsx
/**
 * Recalculate PnL for Active Cohort - BATCHED VERSION
 *
 * Processes wallets in batches to avoid timeout.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

const BATCH_SIZE = 1000;

interface WalletPnl {
  wallet: string;
  realized_pnl_usd: number;
  sum_gains: number;
  sum_losses: number;
  omega: number;
  total_trades: number;
  markets_traded: number;
  first_trade: string;
  last_trade: string;
}

async function getActiveWallets(): Promise<string[]> {
  console.log('Finding active wallets (trades >= 20, active last 14 days)...');

  const result = await clickhouse.query({
    query: `
      SELECT trader_wallet
      FROM (
        SELECT
          trader_wallet,
          count() AS trades,
          max(trade_time) AS last_trade
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY trader_wallet
        HAVING trades >= 20 AND last_trade >= now() - INTERVAL 14 DAY
      )
    `,
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  console.log(`Found ${rows.length.toLocaleString()} active wallets\n`);
  return rows.map((r) => r.trader_wallet);
}

async function calculatePnlBatch(wallets: string[]): Promise<WalletPnl[]> {
  const walletList = wallets.map((w) => `'${w}'`).join(',');

  const query = `
    WITH
      -- First filter raw events to target wallets
      filtered_events AS (
        SELECT event_id, trader_wallet, side, usdc_amount, token_amount, token_id, trade_time
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trader_wallet IN (${walletList})
      ),
      -- Then dedupe by event_id
      deduped AS (
        SELECT
          event_id,
          any(trader_wallet) AS trader_wallet,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time
        FROM filtered_events
        GROUP BY event_id
      ),
      trades_mapped AS (
        SELECT
          d.trader_wallet,
          m.condition_id,
          m.outcome_index,
          d.side,
          d.usdc_amount / 1000000.0 AS usdc,
          d.token_amount / 1000000.0 AS tokens,
          d.trade_time
        FROM deduped d
        INNER JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
      ),

      positions AS (
        SELECT
          trader_wallet,
          condition_id,
          outcome_index,
          sum(if(side = 'buy', -usdc, usdc)) AS cash_flow,
          sum(if(side = 'buy', tokens, -tokens)) AS shares,
          count(*) AS trades,
          min(trade_time) AS first_trade,
          max(trade_time) AS last_trade
        FROM trades_mapped
        GROUP BY trader_wallet, condition_id, outcome_index
      ),

      with_resolution AS (
        SELECT
          p.*,
          CASE
            WHEN r.payout_numerators IS NULL THEN NULL
            WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) >= 1000 THEN 1.0
            ELSE toFloat64(JSONExtractInt(r.payout_numerators, p.outcome_index + 1))
          END AS resolution_price
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
      ),

      position_pnl AS (
        SELECT
          trader_wallet,
          condition_id,
          cash_flow,
          shares,
          resolution_price,
          trades,
          first_trade,
          last_trade,
          cash_flow + (shares * coalesce(resolution_price, 0)) AS realized_pnl
        FROM with_resolution
      )

    SELECT
      trader_wallet AS wallet,
      sum(realized_pnl) AS realized_pnl_usd,
      sumIf(realized_pnl, realized_pnl > 0) AS sum_gains,
      abs(sumIf(realized_pnl, realized_pnl < 0)) AS sum_losses,
      if(abs(sumIf(realized_pnl, realized_pnl < 0)) > 0.01,
         sumIf(realized_pnl, realized_pnl > 0) / abs(sumIf(realized_pnl, realized_pnl < 0)),
         if(sumIf(realized_pnl, realized_pnl > 0) > 0, 999, 0)) AS omega,
      sum(trades) AS total_trades,
      uniqExact(condition_id) AS markets_traded,
      min(first_trade) AS first_trade,
      max(last_trade) AS last_trade
    FROM position_pnl
    GROUP BY trader_wallet
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    query_params: {},
    clickhouse_settings: {
      max_execution_time: 300  // 5 minute timeout per batch
    }
  });
  return (await result.json()) as WalletPnl[];
}

async function main() {
  console.log('='.repeat(80));
  console.log('RECALCULATE PNL FOR ACTIVE COHORT (BATCHED)');
  console.log('='.repeat(80));
  console.log(`Batch size: ${BATCH_SIZE}\n`);

  const startTime = Date.now();

  // Get active wallets
  const wallets = await getActiveWallets();

  // Process in batches
  const allResults: WalletPnl[] = [];
  const numBatches = Math.ceil(wallets.length / BATCH_SIZE);

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batch = wallets.slice(i, i + BATCH_SIZE);

    process.stdout.write(`\rProcessing batch ${batchNum}/${numBatches} (${batch.length} wallets)...`);

    try {
      const results = await calculatePnlBatch(batch);
      allResults.push(...results);
    } catch (err: any) {
      console.error(`\nBatch ${batchNum} failed:`, err.message);
    }
  }

  console.log(`\n\nProcessed ${allResults.length.toLocaleString()} wallets\n`);

  // Summary stats
  const profitable = allResults.filter((r) => r.realized_pnl_usd > 0);
  const highOmega = allResults.filter((r) => r.omega > 1 && r.omega < 999);
  const highPnlOmega = allResults.filter((r) => r.realized_pnl_usd > 500 && r.omega > 1 && r.omega < 999);
  const totalPnl = allResults.reduce((s, r) => s + r.realized_pnl_usd, 0);

  console.log('='.repeat(80));
  console.log('COHORT SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total wallets:      ${allResults.length.toLocaleString()}`);
  console.log(`Profitable:         ${profitable.length.toLocaleString()} (${((profitable.length / allResults.length) * 100).toFixed(1)}%)`);
  console.log(`Omega > 1:          ${highOmega.length.toLocaleString()}`);
  console.log(`PnL>$500 & Omega>1: ${highPnlOmega.length.toLocaleString()}`);
  console.log(`Combined PnL:       $${totalPnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

  // Sort by omega for top 10
  const sorted = [...highOmega].sort((a, b) => b.omega - a.omega);

  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 BY OMEGA');
  console.log('='.repeat(80));
  console.log('Wallet                                     | Omega    | PnL          | Trades');
  console.log('-'.repeat(80));

  sorted.slice(0, 10).forEach((w) => {
    const pnlStr = w.realized_pnl_usd >= 0
      ? `+$${w.realized_pnl_usd.toFixed(0).padStart(9)}`
      : `-$${Math.abs(w.realized_pnl_usd).toFixed(0).padStart(9)}`;
    console.log(
      `${w.wallet} | ${w.omega.toFixed(2).padStart(8)} | ${pnlStr} | ${w.total_trades.toString().padStart(5)}`
    );
  });

  // Export to CSV
  const csvPath = 'tmp/cohort_pnl_recalculated.csv';
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp', { recursive: true });
  }

  // Add polymarket URL
  const enriched = allResults.map((r) => ({
    ...r,
    polymarket_url: `https://polymarket.com/profile/${r.wallet}`,
  }));

  const headers = Object.keys(enriched[0] || {}).join(',');
  const csvRows = enriched.map((r) =>
    Object.values(r)
      .map((v) => {
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      })
      .join(',')
  );
  fs.writeFileSync(csvPath, [headers, ...csvRows].join('\n'));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Exported to ${csvPath}`);
  console.log(`   ${enriched.length.toLocaleString()} wallets, ${elapsed}s`);
}

main().catch(console.error);
