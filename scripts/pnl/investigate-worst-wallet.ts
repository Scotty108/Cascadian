import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createV19sEngine } from '../../lib/pnl/uiActivityEngineV19s';

// Wallet with large error and many open positions
const WALLET = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4';

async function main() {
  console.log('=== INVESTIGATING WORST WALLET WITH OPEN POSITIONS ===\n');
  console.log('Wallet:', WALLET);
  console.log('UI PnL: $360,492');
  console.log('V19s PnL: $-1,436,575 (-498% error)\n');

  const engine = createV19sEngine();
  const result = await engine.compute(WALLET);

  console.log('V19s Result Summary:');
  console.log('  Total PnL:', result.total_pnl.toFixed(2));
  console.log('  Realized PnL:', result.realized_pnl.toFixed(2));
  console.log('  Unrealized PnL:', result.unrealized_pnl.toFixed(2));
  console.log('  Positions:', result.positions_count);
  console.log('  Resolved:', result.resolutions);
  console.log('  Synthetic resolved:', result.synthetic_resolutions);
  console.log('  Open positions:', result.open_positions);

  // Analyze open positions
  const openPositions = result.positions.filter((p) => p.is_resolved === false);
  const resolvedPositions = result.positions.filter((p) => p.is_resolved === true);

  console.log('\nOpen Position Analysis:');
  console.log('  Count:', openPositions.length);
  const unrealizedTotal = openPositions.reduce((s, p) => s + p.unrealized_pnl, 0);
  console.log('  Total unrealized:', unrealizedTotal.toFixed(2));

  // Show sample of open positions with their prices
  console.log('\nSample Open Positions (sorted by abs unrealized):');
  const sortedOpen = openPositions.sort((a, b) => Math.abs(b.unrealized_pnl) - Math.abs(a.unrealized_pnl));
  for (const p of sortedOpen.slice(0, 10)) {
    const priceStr = p.current_price !== null ? p.current_price.toFixed(3) : 'N/A';
    console.log(
      '  cond:' + p.condition_id.slice(0, 12) +
      ' oi:' + p.outcome_index +
      ' cf:' + p.cash_flow.toFixed(2) +
      ' tokens:' + p.final_tokens.toFixed(2) +
      ' price:' + priceStr +
      ' unreal:' + p.unrealized_pnl.toFixed(2)
    );
  }

  // Check how many have actual prices vs 0.5 fallback
  const withPrice = openPositions.filter((p) => p.current_price !== null && p.current_price !== 0.5);
  const withFallback = openPositions.filter((p) => p.current_price === 0.5 || p.current_price === null);

  console.log('\nPrice Coverage:');
  console.log('  With Gamma price:', withPrice.length);
  console.log('  With 0.5 fallback:', withFallback.length);

  // Show some resolved positions for comparison
  console.log('\nSample Resolved Positions (top by PnL):');
  const sortedResolved = resolvedPositions.sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl));
  for (const p of sortedResolved.slice(0, 5)) {
    console.log(
      '  cond:' + p.condition_id.slice(0, 12) +
      ' oi:' + p.outcome_index +
      ' cf:' + p.cash_flow.toFixed(2) +
      ' tokens:' + p.final_tokens.toFixed(2) +
      ' res_price:' + (p.resolution_price?.toFixed(3) || 'N/A') +
      ' real:' + p.realized_pnl.toFixed(2)
    );
  }

  // Calculate what the unrealized would be at different mark prices
  console.log('\nUnrealized Sensitivity:');
  const tokenSum = openPositions.reduce((s, p) => s + p.final_tokens, 0);
  const cashSum = openPositions.reduce((s, p) => s + p.cash_flow, 0);
  console.log('  Total open position tokens:', tokenSum.toFixed(2));
  console.log('  Total open position cash flow:', cashSum.toFixed(2));
  console.log('  Unrealized at 0.5 mark:', (cashSum + tokenSum * 0.5).toFixed(2));
  console.log('  Unrealized at 0.0 mark:', (cashSum + tokenSum * 0.0).toFixed(2));
  console.log('  Unrealized at 1.0 mark:', (cashSum + tokenSum * 1.0).toFixed(2));
}

main().catch(console.error);
