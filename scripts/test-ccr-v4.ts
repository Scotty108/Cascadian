#!/usr/bin/env npx tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { computeCCRv4 } from '../lib/pnl/ccrEngineV4';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
const SPLIT_HEAVY_UI = -115409.28;

const TAKER_HEAVY = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';
const TAKER_HEAVY_UI = -1129;

async function main() {
  console.log('='.repeat(70));
  console.log('Testing CCR-v4: Unified Engine (All Trades + Paired-Outcome Normalization)');
  console.log('='.repeat(70));

  const splitResult = await computeCCRv4(SPLIT_HEAVY);
  const splitError = Math.abs(splitResult.total_pnl - SPLIT_HEAVY_UI) / Math.abs(SPLIT_HEAVY_UI) * 100;

  console.log('\nSplit-Heavy wallet:');
  console.log(`  Total PnL: $${splitResult.total_pnl.toLocaleString()}`);
  console.log(`  UI PnL: $${SPLIT_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${splitError.toFixed(2)}%`);
  console.log(`  Trades: ${splitResult.total_trades} (maker: ${splitResult.maker_trades}, taker: ${splitResult.taker_trades})`);
  console.log(`  External sells: ${splitResult.external_sell_tokens.toLocaleString()} tokens, $${splitResult.external_sell_usdc.toLocaleString()}`);
  console.log(`  External adjustment: $${splitResult.external_sell_adjustment.toLocaleString()}`);
  console.log(`  Confidence: ${splitResult.pnl_confidence}`);

  const takerResult = await computeCCRv4(TAKER_HEAVY);
  const takerError = Math.abs(takerResult.total_pnl - TAKER_HEAVY_UI) / Math.abs(TAKER_HEAVY_UI) * 100;

  console.log('\nTaker-Heavy wallet:');
  console.log(`  Total PnL: $${takerResult.total_pnl.toLocaleString()}`);
  console.log(`  UI PnL: $${TAKER_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${takerError.toFixed(2)}%`);
  console.log(`  Trades: ${takerResult.total_trades} (maker: ${takerResult.maker_trades}, taker: ${takerResult.taker_trades})`);
  console.log(`  External sells: ${takerResult.external_sell_tokens.toLocaleString()} tokens, $${takerResult.external_sell_usdc.toLocaleString()}`);
  console.log(`  External adjustment: $${takerResult.external_sell_adjustment.toLocaleString()}`);
  console.log(`  Confidence: ${takerResult.pnl_confidence}`);

  console.log('\n' + '='.repeat(70));
  console.log('Result:');
  console.log('='.repeat(70));
  console.log(`Split-heavy: ${splitError < 5 ? 'PASS' : 'FAIL'} (${splitError.toFixed(2)}% error)`);
  console.log(`Taker-heavy: ${takerError < 5 ? 'PASS' : 'FAIL'} (${takerError.toFixed(2)}% error)`);
}

main().catch(console.error);
