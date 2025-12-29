/**
 * Test Hybrid PnL Calculation WITHOUT avg_price from archive
 *
 * Since our archive doesn't have avg_price, we need to:
 * 1. Calculate avg_price ourselves from CLOB trades (V9/V11 approach)
 * 2. Add resolution PnL for positions held to market close
 *
 * This validates if our V11 engine (which calculates avg_price from trades)
 * can match the UI when combined with resolution PnL.
 *
 * Key insight: The archive realized_pnl ONLY counts resolution profits.
 * We need to ALSO count trading PnL (sell_price - avg_price) * qty_sold.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';

// Test wallet that shows discrepancy:
// Archive: +$28M (resolution profits only)
// UI: -$10M (resolution profits - sell losses = $28M - $38M = -$10M)
const TEST_WALLET = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function getArchivePnL(wallet: string): Promise<number> {
  const result = await clickhouse.query({
    query: `
      SELECT sum(realized_pnl) / 1000000.0 as total_pnl
      FROM pm_archive.pm_user_positions
      WHERE lower(proxy_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as any[];
  return Number(rows[0]?.total_pnl || 0);
}

async function main() {
  console.log('='.repeat(80));
  console.log('HYBRID PnL TEST (without archive avg_price)');
  console.log(`Wallet: ${TEST_WALLET}`);
  console.log('='.repeat(80));

  // 1. Get archive realized_pnl (resolution profits only)
  console.log('\n[1] Archive realized_pnl (resolution profits only):');
  const archivePnL = await getArchivePnL(TEST_WALLET);
  console.log(`    $${archivePnL.toFixed(2)}`);

  // 2. Calculate V11 PnL (CLOB trades + resolution)
  console.log('\n[2] V11 Engine PnL (CLOB trades + resolution):');
  const engine = createV11Engine();
  const v11Result = await engine.compute(TEST_WALLET);
  console.log(`    Realized PnL: $${v11Result.realized_pnl.toFixed(2)}`);
  console.log(`    Volume Traded: $${v11Result.volume_traded.toFixed(2)}`);
  console.log(`    Buys: ${v11Result.buys_count}, Sells: ${v11Result.sells_count}`);
  console.log(`    Outcomes: ${v11Result.outcomes_traded}`);

  // 3. Show the expected value
  console.log('\n[3] Expected (from UI):');
  console.log('    Approximately -$10,000,000');

  // 4. Analysis
  console.log('\n[4] Analysis:');
  console.log(`    Archive shows resolution profits: $${archivePnL.toFixed(2)}`);
  console.log(`    V11 shows trading + resolution: $${v11Result.realized_pnl.toFixed(2)}`);

  // If V11 is correct, the trading losses should be:
  // trading_losses = archive_pnl - v11_pnl
  const tradingLosses = archivePnL - v11Result.realized_pnl;
  console.log(`    Implied trading losses: $${tradingLosses.toFixed(2)}`);

  console.log('\n[5] Conclusion:');
  if (Math.abs(v11Result.realized_pnl - (-10_000_000)) < 2_000_000) {
    console.log('    ✓ V11 is close to UI! Our CLOB-based calculation works.');
    console.log('    The archive realized_pnl was incomplete (missing sell PnL).');
  } else {
    console.log('    ✗ V11 does not match UI.');
    console.log('    Possible issues:');
    console.log('      - Missing trades in pm_trader_events_v2');
    console.log('      - CTF events (splits/merges) affecting position');
    console.log('      - Need polymarket_user_positions with avg_price');
  }
}

main().catch(console.error);
