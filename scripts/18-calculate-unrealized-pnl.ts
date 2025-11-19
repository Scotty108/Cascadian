import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculateUnrealizedPnL() {
  console.log('=== Calculating UNREALIZED PnL (Open Positions) ===\n');

  // Calculate PnL for positions that either:
  // 1. Have no resolution data (truly open)
  // 2. Have invalid resolution data (payout_denominator = 0)
  const query = `
    WITH positions AS (
      SELECT
        condition_id_norm_v3 AS condition_id,
        outcome_index_v3 AS outcome_idx,
        sum(if(trade_direction = 'BUY', shares, -shares)) AS net_shares,
        sum(if(trade_direction = 'BUY', usd_value, -usd_value)) AS net_cost,
        count() AS trade_count
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 != '0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id, outcome_idx
      HAVING abs(net_shares) > 0.001
    )
    SELECT
      p.condition_id,
      p.outcome_idx,
      p.net_shares,
      p.net_cost,
      p.trade_count,
      r.payout_denominator,
      r.winning_index
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON p.condition_id = r.condition_id_norm
    WHERE r.payout_denominator = 0 OR r.condition_id_norm IS NULL
    ORDER BY abs(net_cost) DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const openPositions = await result.json<any[]>();

  console.log(`Found ${openPositions.length} open/unresolved positions\n`);

  // Calculate unrealized PnL
  // Assumption: For binary markets (YES/NO), if net_shares > 0 and net_cost > 0,
  // the current value would be net_shares * current_price
  // For simplicity, let's assume current_price = 0.50 (50%) for unresolved markets

  let totalNetCost = 0;
  let totalNetShares = 0;
  let positionsWithPositiveShares = 0;
  let positionsWithNegativeShares = 0;

  openPositions.forEach(pos => {
    const netCost = Number(pos.net_cost);
    const netShares = Number(pos.net_shares);

    totalNetCost += netCost;
    totalNetShares += netShares;

    if (netShares > 0) {
      positionsWithPositiveShares++;
    } else if (netShares < 0) {
      positionsWithNegativeShares++;
    }
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('UNREALIZED POSITIONS ANALYSIS:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Total open positions: ${openPositions.length}`);
  console.log(`  Long positions (positive shares): ${positionsWithPositiveShares}`);
  console.log(`  Short positions (negative shares): ${positionsWithNegativeShares}`);
  console.log('');
  console.log(`Total net cost invested: $${totalNetCost.toFixed(2)}`);
  console.log(`Total net shares held: ${totalNetShares.toFixed(2)}`);
  console.log('');

  // Scenario analysis
  console.log('SCENARIO ANALYSIS:');
  console.log('─'.repeat(79));
  console.log('');

  // Scenario 1: All positions resolve to 0 (all lose)
  const scenario1_pnl = -totalNetCost;
  console.log('Scenario 1: All open positions resolve to 0 (worst case)');
  console.log(`  Unrealized PnL: $${scenario1_pnl.toFixed(2)}`);
  console.log('');

  // Scenario 2: All positions resolve at current average cost basis
  // Average cost per share = totalNetCost / totalNetShares (if positive)
  const avgCostPerShare = totalNetShares > 0 ? totalNetCost / totalNetShares : 0;
  const scenario2_value = totalNetShares * avgCostPerShare;
  const scenario2_pnl = scenario2_value - totalNetCost;
  console.log('Scenario 2: All positions resolve at avg cost basis (break-even)');
  console.log(`  Avg cost per share: $${avgCostPerShare.toFixed(4)}`);
  console.log(`  Current value: $${scenario2_value.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${scenario2_pnl.toFixed(2)}`);
  console.log('');

  // Scenario 3: All positions resolve at 50% probability (market at equilibrium)
  const scenario3_value = Math.abs(totalNetShares) * 0.50;
  const scenario3_pnl = scenario3_value - Math.abs(totalNetCost);
  console.log('Scenario 3: All positions valued at $0.50 (50% probability)');
  console.log(`  Current value: $${scenario3_value.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${scenario3_pnl.toFixed(2)}`);
  console.log('');

  // Scenario 4: All positions resolve to 100% (best case)
  const scenario4_value = Math.abs(totalNetShares);
  const scenario4_pnl = scenario4_value - Math.abs(totalNetCost);
  console.log('Scenario 4: All open positions resolve to 100% (best case)');
  console.log(`  Value at 100%: $${scenario4_value.toFixed(2)}`);
  console.log(`  Unrealized PnL: $${scenario4_pnl.toFixed(2)}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('TOTAL PNL PROJECTION:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const realizedPnL = -406642.64; // From our earlier calculation
  const polymarketPnL = 87030.51;

  console.log(`Realized PnL (resolved markets): $${realizedPnL.toFixed(2)}`);
  console.log('');
  console.log('Total PnL (Realized + Unrealized) under each scenario:');
  console.log(`  Scenario 1 (all lose):        $${(realizedPnL + scenario1_pnl).toFixed(2)}`);
  console.log(`  Scenario 2 (break-even):      $${(realizedPnL + scenario2_pnl).toFixed(2)}`);
  console.log(`  Scenario 3 (50% value):       $${(realizedPnL + scenario3_pnl).toFixed(2)}`);
  console.log(`  Scenario 4 (all win):         $${(realizedPnL + scenario4_pnl).toFixed(2)}`);
  console.log('');
  console.log(`Polymarket Reality: $${polymarketPnL.toFixed(2)}`);
  console.log('');

  // Calculate what unrealized PnL would need to be to match Polymarket
  const requiredUnrealized = polymarketPnL - realizedPnL;
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('REVERSE ENGINEERING:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`To match Polymarket's $${polymarketPnL.toFixed(2)}, unrealized PnL must be:`);
  console.log(`  Required: $${requiredUnrealized.toFixed(2)}`);
  console.log('');
  console.log(`Current capital in open positions: $${Math.abs(totalNetCost).toFixed(2)}`);
  console.log(`ROI needed: ${((requiredUnrealized / Math.abs(totalNetCost)) * 100).toFixed(1)}%`);
  console.log('');

  if (Math.abs(requiredUnrealized - scenario3_pnl) < Math.abs(requiredUnrealized - scenario4_pnl)) {
    console.log('✅ Scenario 3 (50% value) is closest to reality!');
    console.log('   This suggests Polymarket IS including unrealized PnL at current market prices.');
  } else if (Math.abs(requiredUnrealized - scenario4_pnl) < 10000) {
    console.log('✅ Scenario 4 (100% value) is close to reality!');
    console.log('   This suggests most open positions are currently trading near 100%.');
  } else {
    console.log('❌ None of the scenarios match Polymarket number.');
    console.log('   This suggests there may be other factors at play.');
  }

  console.log('');
}

calculateUnrealizedPnL().catch(console.error);
