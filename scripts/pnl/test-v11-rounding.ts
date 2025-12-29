/**
 * Test V11 with price rounding against API ground truth
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV11Engine } from '../../lib/pnl/uiActivityEngineV11';

const TEST_WALLET = '0x9d36c904930a7d06c5403f9e16996e919f586486';

interface ApiPosition {
  condition_id: string;
  outcome: string;
  avg_price: number;
  realized_pnl: number;
  is_closed: number;
}

async function getApiPositions(wallet: string): Promise<ApiPosition[]> {
  const query = `
    SELECT condition_id, outcome, avg_price, realized_pnl, is_closed
    FROM pm_api_positions
    WHERE lower(wallet) = lower('${wallet}')
    ORDER BY condition_id, outcome
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];
  return rows.map((r) => ({
    condition_id: r.condition_id,
    outcome: r.outcome,
    avg_price: Number(r.avg_price),
    realized_pnl: Number(r.realized_pnl),
    is_closed: Number(r.is_closed),
  }));
}

async function main() {
  console.log('='.repeat(80));
  console.log('V11 PRICE ROUNDING TEST');
  console.log(`Wallet: ${TEST_WALLET}`);
  console.log('='.repeat(80));

  const engine = createV11Engine();

  // Get API positions
  const apiPositions = await getApiPositions(TEST_WALLET);
  console.log(`\nFound ${apiPositions.length} API positions`);

  const totalApiPnL = apiPositions.reduce((sum, p) => sum + p.realized_pnl, 0);
  console.log(`API total realized_pnl: $${totalApiPnL.toFixed(2)}`);

  // Compute V11 for whole wallet
  const v11Result = await engine.compute(TEST_WALLET);
  console.log(`V11 total realized_pnl: $${v11Result.realized_pnl.toFixed(2)}`);
  console.log(`Difference: $${(v11Result.realized_pnl - totalApiPnL).toFixed(2)}\n`);

  // Compare per-position
  console.log('Per-Position Comparison:');
  console.log('-'.repeat(80));
  console.log('Condition (first 15)    | Outcome | API PnL      | V11 PnL      | Diff');
  console.log('-'.repeat(80));

  let matchCount = 0;
  let closeCount = 0;

  for (const api of apiPositions) {
    const cleanCid = api.condition_id.replace(/^0x/, '').toLowerCase();
    const outcomeIndex = api.outcome.toLowerCase() === 'yes' ? 0 : 1;

    // Find V11's calculation for this position
    const v11Pos = v11Result.positions.find(
      (p) => p.condition_id.toLowerCase() === cleanCid && p.outcome_index === outcomeIndex
    );

    const v11Pnl = v11Pos?.realized_pnl || 0;
    const diff = v11Pnl - api.realized_pnl;
    const pctDiff = api.realized_pnl !== 0 ? Math.abs(diff / api.realized_pnl * 100) : 0;

    let status = '';
    if (Math.abs(diff) < 1) {
      status = '✓';
      matchCount++;
    } else if (pctDiff < 5) {
      status = '~';
      closeCount++;
    } else {
      status = '✗';
    }

    console.log(
      `${cleanCid.substring(0, 15)}... | ${api.outcome.padEnd(3)}     | $${api.realized_pnl.toFixed(2).padStart(10)} | $${v11Pnl.toFixed(2).padStart(10)} | $${diff.toFixed(2).padStart(10)} ${status}`
    );

    // Show avg_price comparison
    if (v11Pos && Math.abs(diff) > 1) {
      console.log(`  -> API avg_price: $${api.avg_price.toFixed(6)}, V11 avg_price: $${v11Pos.avgPrice.toFixed(6)}`);
      console.log(`  -> V11 remaining amount: ${v11Pos.amount.toFixed(2)}, trades: ${v11Pos.trade_count}`);
    }
  }

  console.log('-'.repeat(80));
  console.log(`\nSummary:`);
  console.log(`  Exact matches (diff < $1): ${matchCount}/${apiPositions.length}`);
  console.log(`  Close matches (diff < 5%): ${closeCount}/${apiPositions.length}`);
  console.log(`  Total off: ${apiPositions.length - matchCount - closeCount}/${apiPositions.length}`);
}

main().catch(console.error);
