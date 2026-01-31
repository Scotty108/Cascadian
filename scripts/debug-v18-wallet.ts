#!/usr/bin/env npx tsx
/**
 * Debug script to check why a specific wallet is failing v18 criteria
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const TABLE = 'pm_trade_fifo_roi_v3_mat_unified_backup_20260130';
const MIN_TRADES = 35;
const MIN_MARKETS = 8;
const MIN_MEDIAN_ROI = 0.10;
const WINSORIZE_PCT = 0.025;
const MIN_ROI = -1.0;
const MAX_ROI = 2.0;

interface Trade {
  tx_hash: string;
  entry_time: number;
  roi: number;
  condition_id: string;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function winsorize(trades: Trade[]): Trade[] {
  if (trades.length < 10) return trades;
  const sorted = [...trades].sort((a, b) => a.roi - b.roi);
  const lowerIdx = Math.floor(sorted.length * WINSORIZE_PCT);
  const upperIdx = Math.ceil(sorted.length * (1 - WINSORIZE_PCT));
  return sorted.slice(lowerIdx, upperIdx);
}

async function debugWallet(wallet: string) {
  console.log(`\nDebugging wallet: ${wallet}\n`);

  // Get trades
  const query = `
    SELECT
      tx_hash,
      toUInt64(any(entry_time)) as entry_time,
      GREATEST(${MIN_ROI}, LEAST(any(roi), ${MAX_ROI})) as roi,
      condition_id
    FROM ${TABLE}
    WHERE wallet = '${wallet}'
      AND (is_closed = 1 OR resolved_at IS NOT NULL)
    GROUP BY tx_hash, wallet, condition_id, outcome_index
    ORDER BY entry_time
    SETTINGS max_execution_time = 120
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const trades = await result.json() as Trade[];

  console.log(`Total deduped trades: ${trades.length}`);
  console.log(`  Check: ${trades.length} > ${MIN_TRADES} = ${trades.length > MIN_TRADES ? 'PASS' : 'FAIL'}`);

  // Markets
  const markets = new Set(trades.map(t => t.condition_id));
  console.log(`\nUnique markets: ${markets.size}`);
  console.log(`  Check: ${markets.size} > ${MIN_MARKETS} = ${markets.size > MIN_MARKETS ? 'PASS' : 'FAIL'}`);

  // ROI stats
  const allRois = trades.map(t => t.roi);
  const medianRoi = median(allRois);
  console.log(`\nMedian ROI: ${(medianRoi * 100).toFixed(4)}%`);
  console.log(`  Check: ${(medianRoi * 100).toFixed(2)}% > ${MIN_MEDIAN_ROI * 100}% = ${medianRoi > MIN_MEDIAN_ROI ? 'PASS' : 'FAIL'}`);

  // Win stats
  const winningRois = allRois.filter(r => r > 0);
  const losingRois = allRois.filter(r => r <= 0);
  const medianWinRoi = median(winningRois);
  console.log(`\nWins: ${winningRois.length}, Losses: ${losingRois.length}`);
  console.log(`Median Win ROI: ${(medianWinRoi * 100).toFixed(4)}%`);
  console.log(`  Check: ${(medianWinRoi * 100).toFixed(2)}% != 100% = ${Math.abs(medianWinRoi - 1.0) >= 0.001 ? 'PASS' : 'FAIL (split arber)'}`);

  // Winsorization
  const winsorizedTrades = winsorize(trades);
  console.log(`\nAfter winsorization: ${winsorizedTrades.length} trades (removed ${trades.length - winsorizedTrades.length})`);
  console.log(`  Check: ${winsorizedTrades.length} >= 10 = ${winsorizedTrades.length >= 10 ? 'PASS' : 'FAIL'}`);

  // Log return calculation
  const rois = winsorizedTrades.map(t => t.roi);
  const timestamps = winsorizedTrades.map(t => t.entry_time);
  const firstTs = Math.min(...timestamps);
  const lastTs = Math.max(...timestamps);
  const daysActive = Math.max(1, Math.floor((lastTs - firstTs) / 86400) + 1);

  console.log(`\nFirst trade: ${new Date(firstTs * 1000).toISOString()}`);
  console.log(`Last trade: ${new Date(lastTs * 1000).toISOString()}`);
  console.log(`Days active: ${daysActive}`);

  // Floor ROI at -0.99 for log calculation to avoid ln(0) = -Infinity
  const logReturns = rois.map(r => Math.log(1 + Math.max(-0.99, Math.min(2, r))));
  const sumLogReturns = logReturns.reduce((a, b) => a + b, 0);
  const logReturnPctPerDay = (sumLogReturns / daysActive) * 100;

  console.log(`\nSum of ln(1+ROI): ${sumLogReturns.toFixed(6)}`);
  console.log(`Log Return % Per Day: ${logReturnPctPerDay.toFixed(6)}%`);
  console.log(`  Check: ${logReturnPctPerDay.toFixed(4)}% > 0 = ${logReturnPctPerDay > 0 ? 'PASS' : 'FAIL'}`);

  console.log(`\n${'='.repeat(60)}`);
  const allPass = trades.length > MIN_TRADES &&
    markets.size > MIN_MARKETS &&
    medianRoi > MIN_MEDIAN_ROI &&
    Math.abs(medianWinRoi - 1.0) >= 0.001 &&
    winsorizedTrades.length >= 10 &&
    logReturnPctPerDay > 0;

  console.log(`FINAL RESULT: ${allPass ? 'WOULD QUALIFY' : 'WOULD NOT QUALIFY'}`);
}

const wallet = process.argv[2] || '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee';
debugWallet(wallet).catch(console.error);
