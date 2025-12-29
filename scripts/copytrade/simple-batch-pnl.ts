/**
 * Simple Batch P&L Calculator (Cash + UI Parity)
 *
 * Memory-efficient: processes wallets one-at-a-time.
 * Computes both cash-parity (ledger) and UI-parity (subgraph avg-cost).
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';
import { computeLedgerV2Pnl } from '@/lib/pnl/ledgerV2';
import { computeUiParityPnl } from '@/lib/pnl/uiParityPnl';

const LIMIT = parseInt(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || '20');
const MIN_TRADES = parseInt(process.argv.find((a) => a.startsWith('--minTrades='))?.split('=')[1] || '100');
const MAX_TRADES = parseInt(process.argv.find((a) => a.startsWith('--maxTrades='))?.split('=')[1] || '10000');
const MIN_NOTIONAL = parseFloat(process.argv.find((a) => a.startsWith('--minNotional='))?.split('=')[1] || '0');
const MAX_NOTIONAL = parseFloat(process.argv.find((a) => a.startsWith('--maxNotional='))?.split('=')[1] || '1000000000');

interface WalletResult {
  wallet: string;
  cashPnl: number;
  uiPnl: number;
  trades: number;
  openPositions: number;
  mappedTokens: number;
  totalTokens: number;
  mappingCoveragePct: number;
  buys: number;
  sells: number;
  splitCost: number;
  redemptions: number;
  heldValue: number;
  uiVolume: number;
  uiPositions: number;
  uiUnmappedEvents: number;
  uiSkippedUsdc: number;
}

async function calculatePnL(wallet: string): Promise<WalletResult> {
  const [cash, ui] = await Promise.all([
    computeLedgerV2Pnl(wallet),
    computeUiParityPnl(wallet),
  ]);

  return {
    wallet,
    cashPnl: cash.realizedPnl,
    uiPnl: ui.realizedPnl,
    trades: cash.trades,
    openPositions: cash.openPositions,
    mappedTokens: cash.mappedTokens,
    totalTokens: cash.totalTokens,
    mappingCoveragePct: cash.mappingCoveragePct,
    buys: cash.buys,
    sells: cash.sells,
    splitCost: cash.splitCost,
    redemptions: cash.redemptions,
    heldValue: cash.heldValue,
    uiVolume: ui.volume,
    uiPositions: ui.positionCount,
    uiUnmappedEvents: ui.gapStats.unmapped_event_count,
    uiSkippedUsdc: ui.gapStats.skipped_usdc_abs,
  };
}

async function main() {
  console.log('=== SIMPLE BATCH P&L CALCULATOR (CASH + UI PARITY) ===\n');
  console.log(`Processing ${LIMIT} wallets\n`);
  console.log(`Trade filter: ${MIN_TRADES}-${MAX_TRADES} trades`);
  console.log(`Notional filter: $${MIN_NOTIONAL}-$${MAX_NOTIONAL}\n`);

  // Get retail wallets (configurable trade/notional band)
  const walletsQ = `
    SELECT trader_wallet, count() as trade_count, sum(usdc_amount)/1e6 as notional
    FROM pm_trader_events_v2
    WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 60 DAY
    GROUP BY trader_wallet
    HAVING trade_count BETWEEN ${MIN_TRADES} AND ${MAX_TRADES}
      AND notional BETWEEN ${MIN_NOTIONAL} AND ${MAX_NOTIONAL}
    ORDER BY trade_count DESC
    LIMIT ${LIMIT}
  `;
  const walletsR = await clickhouse.query({ query: walletsQ, format: 'JSONEachRow' });
  const wallets = await walletsR.json() as any[];
  console.log(`Found ${wallets.length} wallets\n`);

  const results: WalletResult[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i].trader_wallet;
    try {
      const pnl = await calculatePnL(wallet);
      results.push(pnl);
      console.log(
        `[${i + 1}/${wallets.length}] ${wallet.slice(0, 10)}... ` +
          `Cash: $${pnl.cashPnl.toFixed(2)} | UI: $${pnl.uiPnl.toFixed(2)}`
      );
    } catch (e: any) {
      console.error(`[${i + 1}] Error for ${wallet}: ${e.message}`);
    }
  }

  // Sort and display
  results.sort((a, b) => b.cashPnl - a.cashPnl);

  console.log('\n=== TOP 10 WINNERS ===');
  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(
      `${i + 1}. ${r.wallet.slice(0, 12)}... Cash: $${r.cashPnl.toFixed(2)} ` +
      `UI: $${r.uiPnl.toFixed(2)} (${r.trades} trades, open=${r.openPositions})`
    );
  }

  console.log('\n=== TOP 10 LOSERS ===');
  for (let i = results.length - 1; i >= Math.max(0, results.length - 10); i--) {
    const r = results[i];
    console.log(
      `${results.length - i}. ${r.wallet.slice(0, 12)}... Cash: $${r.cashPnl.toFixed(2)} ` +
      `UI: $${r.uiPnl.toFixed(2)} ` +
      `(${r.trades} trades)`
    );
  }

  // Export
  if (!fs.existsSync('exports')) fs.mkdirSync('exports');
  let csv = 'rank,wallet,cash_pnl,ui_pnl,buys,sells,split_cost,redemptions,held_value,trades,open_positions,mapped_tokens,total_tokens,mapping_coverage_pct,ui_volume,ui_positions,ui_unmapped_events,ui_skipped_usdc\n';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    csv += `${i + 1},${r.wallet},${r.cashPnl.toFixed(2)},${r.uiPnl.toFixed(2)},${r.buys.toFixed(2)},${r.sells.toFixed(2)},${r.splitCost.toFixed(2)},${r.redemptions.toFixed(2)},${r.heldValue.toFixed(2)},${r.trades},${r.openPositions},${r.mappedTokens},${r.totalTokens},${(r.mappingCoveragePct * 100).toFixed(2)},${r.uiVolume.toFixed(2)},${r.uiPositions},${r.uiUnmappedEvents},${r.uiSkippedUsdc.toFixed(2)}\n`;
  }
  fs.writeFileSync('exports/wallet_pnl_simple.csv', csv);
  console.log('\nExported to exports/wallet_pnl_simple.csv');
}

main().catch(console.error);
