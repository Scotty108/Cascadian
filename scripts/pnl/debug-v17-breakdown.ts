/**
 * Debug V17 PnL Breakdown
 *
 * Calculate V17 PnL step by step and show where the $124K gap comes from
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';
const DOME_REALIZED = 120087.75;

async function main() {
  console.log('='.repeat(90));
  console.log('V17 PNL BREAKDOWN - Finding the $124K Gap');
  console.log('='.repeat(90));
  console.log('');

  const engine = createV17Engine();
  const result = await engine.compute(WALLET);

  console.log('V17 realized PnL:', `$${result.realized_pnl.toFixed(2)}`);
  console.log('Dome realized PnL:', `$${DOME_REALIZED.toFixed(2)}`);
  console.log('Gap:', `$${(result.realized_pnl - DOME_REALIZED).toFixed(2)}`);
  console.log('');

  // Group positions by resolution status
  const resolved = result.positions.filter((p) => p.is_resolved);
  const unresolved = result.positions.filter((p) => !p.is_resolved);

  console.log('--- Position Summary ---');
  console.log('Total positions:', result.positions.length);
  console.log('Resolved positions:', resolved.length);
  console.log('Unresolved positions:', unresolved.length);
  console.log('');

  // Resolved breakdown
  const resolvedPnl = resolved.reduce((sum, p) => sum + p.realized_pnl, 0);
  const resolvedCashFlow = resolved.reduce((sum, p) => sum + p.trade_cash_flow, 0);
  const resolvedShareValue = resolved.reduce((sum, p) => {
    if (p.resolution_price !== null) {
      return sum + p.final_shares * p.resolution_price;
    }
    return sum;
  }, 0);

  console.log('--- Resolved Positions ---');
  console.log('Total realized PnL:', `$${resolvedPnl.toFixed(2)}`);
  console.log('Total cash flow:', `$${resolvedCashFlow.toFixed(2)}`);
  console.log('Total share value at resolution:', `$${resolvedShareValue.toFixed(2)}`);
  console.log('Check: cash_flow + share_value =', `$${(resolvedCashFlow + resolvedShareValue).toFixed(2)}`);
  console.log('');

  // Show resolved positions with significant PnL
  console.log('--- Top Resolved Positions (by |PnL|) ---');
  const topResolved = [...resolved].sort((a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl)).slice(0, 15);

  console.log('');
  console.log('| # | Condition (16)       | Cash Flow    | Shares       | Res Price | Realized PnL |');
  console.log('|---|----------------------|--------------|--------------|-----------|--------------|');

  for (let i = 0; i < topResolved.length; i++) {
    const p = topResolved[i];
    const cond = p.condition_id.slice(0, 16) + '...';
    const resPrice = p.resolution_price !== null ? p.resolution_price.toFixed(2) : 'N/A';
    console.log(
      `| ${(i + 1).toString().padStart(1)} | ${cond.padEnd(20)} | $${p.trade_cash_flow.toFixed(2).padStart(10)} | ${p.final_shares.toFixed(2).padStart(12)} | ${resPrice.padStart(9)} | $${p.realized_pnl.toFixed(2).padStart(10)} |`
    );
  }

  console.log('');

  // Check for any suspicious patterns
  console.log('--- Sanity Checks ---');
  console.log('');

  // Check for positions with resolution_price = 1 but positive cash flow
  // (These would be double-counted profits)
  const suspiciousWins = resolved.filter(
    (p) => p.resolution_price === 1 && p.trade_cash_flow > 0 && p.realized_pnl > 0
  );

  if (suspiciousWins.length > 0) {
    console.log('Positions with BOTH positive cash flow AND winning resolution:');
    for (const p of suspiciousWins.slice(0, 5)) {
      console.log(`  ${p.condition_id.slice(0, 16)}... | cf=$${p.trade_cash_flow.toFixed(0)} | shares=${p.final_shares.toFixed(0)} | pnl=$${p.realized_pnl.toFixed(0)}`);
    }
    console.log('');
    console.log('These positions might be counting profits twice:');
    console.log('  1. Cash flow already positive (sold at profit)');
    console.log('  2. Plus additional shares × $1 at resolution');
    console.log('');
  }

  // Check for positions with resolution_price = 0 but negative shares
  // (These are short positions that won - the loser outcome)
  const shortWins = resolved.filter((p) => p.resolution_price === 0 && p.final_shares < 0);

  if (shortWins.length > 0) {
    console.log('Short positions on losing outcomes (shorts that won):');
    const shortWinsPnl = shortWins.reduce((s, p) => s + p.realized_pnl, 0);
    console.log(`  Count: ${shortWins.length}`);
    console.log(`  Total PnL: $${shortWinsPnl.toFixed(2)}`);
    console.log('');
  }

  // Check category breakdown
  console.log('--- Category Breakdown ---');
  console.log('');
  for (const cat of result.by_category) {
    console.log(`${cat.category}: realized=$${cat.realized_pnl.toFixed(2)}, positions=${cat.positions_count}`);
  }

  console.log('');
  console.log('='.repeat(90));
}

main().catch(console.error);
