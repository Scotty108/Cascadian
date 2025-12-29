/**
 * Deep Dive V2 - Analyze wallet PnL discrepancy with V17
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const WALLET = process.argv[2] || '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  console.log('='.repeat(100));
  console.log('DEEP DIVE V2: Wallet', WALLET);
  console.log('='.repeat(100));

  // 1. Run V17 engine
  console.log('\n--- V17 Engine Output ---');
  const engine = createV17Engine();
  const result = await engine.compute(WALLET);

  console.log('V17 Summary:');
  console.log('  Realized PnL: $' + result.realized_pnl.toFixed(2));
  console.log('  Unrealized PnL: $' + result.unrealized_pnl.toFixed(2));
  console.log('  Total PnL: $' + result.total_pnl.toFixed(2));
  console.log('  Positions:', result.positions_count);
  console.log('  Resolved:', result.resolutions);

  // 2. Show top realized PnL positions (both wins and losses)
  console.log('\n--- Top 20 Positions by |Realized PnL| ---');
  const sortedByRealized = [...result.positions].sort(
    (a, b) => Math.abs(b.realized_pnl) - Math.abs(a.realized_pnl)
  );

  console.log(
    'condition_id (16 chars) | idx | resolved | res_price | cash_flow    | shares       | realized'
  );
  console.log('-'.repeat(105));

  let runningTotal = 0;
  for (const p of sortedByRealized.slice(0, 20)) {
    runningTotal += p.realized_pnl;
    const resStr = p.is_resolved ? 'YES' : 'NO ';
    const priceStr = p.resolution_price !== null ? p.resolution_price.toFixed(2) : 'N/A ';
    console.log(
      `${p.condition_id.substring(0, 16)}... | ${p.outcome_index} | ${resStr} | ${priceStr.padStart(5)} | $${p.trade_cash_flow.toFixed(2).padStart(10)} | ${p.final_shares.toFixed(2).padStart(10)} | $${p.realized_pnl.toFixed(2).padStart(10)}`
    );
  }
  console.log('-'.repeat(105));
  console.log(`Running total of top 20: $${runningTotal.toFixed(2)}`);

  // 3. Check how many markets are being marked as resolved
  const resolvedCount = result.positions.filter((p) => p.is_resolved).length;
  const unresolvedCount = result.positions.filter((p) => !p.is_resolved).length;

  console.log('\n--- Resolution Summary ---');
  console.log(`Resolved positions: ${resolvedCount}`);
  console.log(`Unresolved positions: ${unresolvedCount}`);

  // 4. Check what pm_condition_resolutions has for this wallet's markets
  console.log('\n--- Checking Resolution Table ---');
  const conditionIds = result.positions.map((p) => "'" + p.condition_id + "'").join(',');

  if (conditionIds.length > 0) {
    const resQ = `
      SELECT condition_id, payout_numerators, resolved_at
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (${conditionIds})
    `;

    try {
      const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
      const resolutions = (await resR.json()) as any[];
      console.log(`Found ${resolutions.length} resolutions in pm_condition_resolutions`);

      // Show payouts for top markets
      console.log('\nResolution payouts for top 10 markets by volume:');
      for (const r of resolutions.slice(0, 10)) {
        let payouts = r.payout_numerators;
        if (typeof payouts === 'string') {
          payouts = JSON.parse(payouts);
        }
        console.log(`  ${r.condition_id.substring(0, 20)}... | payouts: ${JSON.stringify(payouts)}`);
      }
    } catch (e: any) {
      console.log('Resolution query error:', e.message);
    }
  }

  // 5. Show the breakdown by resolution status
  console.log('\n--- PnL by Resolution Status ---');
  const resolvedPnl = result.positions
    .filter((p) => p.is_resolved)
    .reduce((s, p) => s + p.realized_pnl, 0);
  const unresolvedPnl = result.positions
    .filter((p) => !p.is_resolved)
    .reduce((s, p) => s + p.unrealized_pnl, 0);

  console.log(`Resolved markets realized PnL:   $${resolvedPnl.toFixed(2)}`);
  console.log(`Unresolved markets unrealized:   $${unresolvedPnl.toFixed(2)}`);
  console.log(`V17 reported realized:           $${result.realized_pnl.toFixed(2)}`);
  console.log(`V17 reported unrealized:         $${result.unrealized_pnl.toFixed(2)}`);

  // 6. Show unresolved positions to see what UI might be including
  console.log('\n--- Unresolved Positions (if any) ---');
  const unresolvedPositions = result.positions.filter((p) => !p.is_resolved);
  for (const p of unresolvedPositions.slice(0, 10)) {
    console.log(
      `  ${p.condition_id.substring(0, 16)}... | shares: ${p.final_shares.toFixed(2)} | cash: $${p.trade_cash_flow.toFixed(2)} | unrealized: $${p.unrealized_pnl.toFixed(2)}`
    );
  }
}

main().catch(console.error);
