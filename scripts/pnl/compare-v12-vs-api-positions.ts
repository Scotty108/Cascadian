/**
 * Compare V12 Engine vs API Position-by-Position
 *
 * This script compares our V12 calculated PnL against the API data
 * for each individual position to understand where discrepancies come from.
 */

import { clickhouse } from '../../lib/clickhouse/client';
import { createV12Engine } from '../../lib/pnl/uiActivityEngineV12';

const TEST_WALLETS = [
  {
    address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d',
    name: 'Wallet with 12 positions',
    expectedPnl: 2174.38,
  },
  {
    address: '0x9d36c904930a7d06c5403f9e16996e919f586486',
    name: 'Theo (NegRisk)',
    expectedPnl: 12298.89,
  },
];

async function getApiPositions(wallet: string): Promise<
  Array<{
    condition_id: string;
    outcome: string;
    realized_pnl: number;
    size: number;
    avg_price: number;
    is_closed: number;
  }>
> {
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcome,
        realized_pnl,
        size,
        avg_price,
        is_closed
      FROM pm_api_positions
      WHERE lower(wallet) = lower('${wallet}')
        AND is_deleted = 0
      ORDER BY condition_id, outcome
    `,
    format: 'JSONEachRow',
  });
  return (await result.json()) as any[];
}

async function main() {
  console.log('='.repeat(100));
  console.log('POSITION-BY-POSITION COMPARISON: V12 vs API');
  console.log('='.repeat(100));

  const engine = createV12Engine();

  for (const w of TEST_WALLETS) {
    console.log('\n' + '-'.repeat(100));
    console.log(`Wallet: ${w.name}`);
    console.log(`Address: ${w.address}`);
    console.log('-'.repeat(100));

    // Get V12 result
    const v12Result = await engine.compute(w.address);

    // Get API positions
    const apiPositions = await getApiPositions(w.address);

    console.log(`\nAPI Positions: ${apiPositions.length}`);
    console.log(`V12 Positions: ${v12Result.positions.length}`);

    // Normalize condition_id: strip 0x prefix, lowercase
    const normalizeConditionId = (id: string): string => {
      return id.toLowerCase().replace(/^0x/, '');
    };

    // Build lookup maps with normalized keys
    const v12ByConditionOutcome = new Map<string, typeof v12Result.positions[0]>();
    for (const p of v12Result.positions) {
      const key = `${normalizeConditionId(p.condition_id)}:${p.outcome_index}`;
      v12ByConditionOutcome.set(key, p);
    }

    const apiByConditionOutcome = new Map<string, typeof apiPositions[0]>();
    for (const p of apiPositions) {
      // API uses outcome name, we need to map to index
      const outcomeIndex = p.outcome.toLowerCase() === 'yes' ? 0 : p.outcome.toLowerCase() === 'no' ? 1 : -1;
      const key = `${normalizeConditionId(p.condition_id)}:${outcomeIndex}`;
      apiByConditionOutcome.set(key, p);
    }

    // Compare positions
    console.log('\n' + '='.repeat(100));
    console.log('POSITION COMPARISON');
    console.log('='.repeat(100));
    console.log(
      'ConditionID'.padEnd(22) +
        'Outcome'.padEnd(8) +
        'API PnL'.padEnd(14) +
        'V12 PnL'.padEnd(14) +
        'Diff'.padEnd(12) +
        'Match?'
    );
    console.log('-'.repeat(100));

    let matchCount = 0;
    let mismatchCount = 0;
    let totalApiPnl = 0;
    let totalV12Pnl = 0;

    // Check all API positions
    for (const [key, apiPos] of apiByConditionOutcome) {
      const v12Pos = v12ByConditionOutcome.get(key);
      const apiPnl = Number(apiPos.realized_pnl);
      const v12Pnl = v12Pos?.realized_pnl || 0;
      const diff = Math.abs(apiPnl - v12Pnl);
      const match = diff < 1; // Within $1

      totalApiPnl += apiPnl;
      totalV12Pnl += v12Pnl;

      if (match) {
        matchCount++;
      } else {
        mismatchCount++;
      }

      const status = match ? 'OK' : 'DIFF';
      const condShort = apiPos.condition_id.substring(0, 20) + '..';

      console.log(
        condShort.padEnd(22) +
          apiPos.outcome.padEnd(8) +
          `$${apiPnl.toFixed(2)}`.padEnd(14) +
          `$${v12Pnl.toFixed(2)}`.padEnd(14) +
          `$${diff.toFixed(2)}`.padEnd(12) +
          status
      );
    }

    // Check V12 positions not in API
    console.log('\n[V12 positions NOT in API]:');
    let extraV12Pnl = 0;
    for (const [key, v12Pos] of v12ByConditionOutcome) {
      const normalizedKey = key; // Already normalized in the map
      if (!apiByConditionOutcome.has(normalizedKey)) {
        console.log(
          `  ${v12Pos.condition_id.substring(0, 20)}.. idx=${v12Pos.outcome_index} pnl=$${v12Pos.realized_pnl.toFixed(2)}`
        );
        extraV12Pnl += v12Pos.realized_pnl;
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log(`  Matched: ${matchCount}`);
    console.log(`  Mismatched: ${mismatchCount}`);
    console.log(`  API Total PnL: $${totalApiPnl.toFixed(2)}`);
    console.log(`  V12 Total PnL (API positions only): $${totalV12Pnl.toFixed(2)}`);
    console.log(`  V12 Extra PnL (not in API): $${extraV12Pnl.toFixed(2)}`);
    console.log(`  V12 Full PnL: $${v12Result.realized_pnl.toFixed(2)}`);
    console.log(`  Expected PnL: $${w.expectedPnl.toFixed(2)}`);
  }
}

main().catch(console.error);
