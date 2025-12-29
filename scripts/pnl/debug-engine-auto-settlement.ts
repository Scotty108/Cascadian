/**
 * Debug the auto-settlement calculation in the engine
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import { computePolymarketPnl } from '../../lib/pnl/polymarketAccurateEngine';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0xb744f56635b537e859152d14b022af5afe485210';

  console.log('=== DEBUG: Auto-Settlement Calculation ===\n');

  // Run the engine
  console.log('Running engine...');
  const result = await computePolymarketPnl(wallet);

  console.log('\n=== Engine Results ===');
  console.log('Positions tracked:', result.positionCount);
  console.log('Open positions (amount > 0):', result.metadata?.openPositions);
  console.log('Realized PnL (including auto-settle):', '$' + result.realizedPnl.toLocaleString());
  console.log('Auto-settled PnL:', '$' + ((result.metadata?.autoSettledPnl as number) || 0).toLocaleString());
  console.log('Unrealized PnL:', '$' + result.unrealizedPnl.toLocaleString());
  console.log('Total PnL:', '$' + result.totalPnl.toLocaleString());

  // Check how many positions have metadata
  console.log('\n=== Position Details ===');
  let withMeta = 0, withPayouts = 0, withoutPayouts = 0;
  let winnerCount = 0, loserCount = 0;
  let winnerPnl = 0, loserPnl = 0;

  for (const pos of result.positions) {
    if (pos.amount <= 0) continue;

    if (pos.conditionId) {
      withMeta++;
    }
    if (pos.outcomeIndex !== undefined) {
      withPayouts++;
    } else {
      withoutPayouts++;
    }
  }
  console.log('Positions with conditionId:', withMeta);
  console.log('Positions with outcomeIndex:', withPayouts);
  console.log('Positions without outcomeIndex (unresolved?):', withoutPayouts);

  // Sample some positions to verify
  console.log('\n=== Sample Positions ===');
  const sample = result.positions.filter(p => p.amount > 1000).slice(0, 5);
  for (const pos of sample) {
    console.log(`Token: ${pos.tokenId.substring(0, 20)}...`);
    console.log(`  Amount: ${pos.amount.toLocaleString()}`);
    console.log(`  Avg Price: $${pos.avgPrice.toFixed(4)}`);
    console.log(`  Cost Basis: $${(pos.amount * pos.avgPrice).toLocaleString(undefined, {maximumFractionDigits: 0})}`);
    console.log(`  Realized PnL (from trades): $${pos.realizedPnl.toLocaleString()}`);
    console.log(`  Condition ID: ${pos.conditionId?.substring(0, 20) || 'N/A'}...`);
    console.log(`  Outcome Index: ${pos.outcomeIndex ?? 'N/A'}`);
    console.log('');
  }

  // Compare with direct SQL
  console.log('\n=== Direct SQL Comparison ===');
  const sqlRes = await client.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          token_id,
          sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
          sumIf(usdc, side = 'buy') / nullIf(sumIf(tokens, side = 'buy'), 0) as avg_buy_price
        FROM (
          SELECT event_id, any(token_id) as token_id, any(side) as side,
            any(usdc_amount)/1e6 as usdc, any(token_amount)/1e6 as tokens
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = lower('${wallet}')
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING net_tokens > 0
      )
      SELECT
        count() as total_positions,
        countIf(r.payout_numerators IS NOT NULL AND r.payout_numerators != '') as resolved_positions,
        countIf(r.payout_numerators IS NULL OR r.payout_numerators = '') as unresolved_positions,
        sum(wp.net_tokens * wp.avg_buy_price) as total_cost_basis
      FROM wallet_positions wp
      LEFT JOIN pm_token_to_condition_map_current m ON wp.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    `,
    format: 'JSONEachRow'
  });
  const sql = (await sqlRes.json())[0] as {
    total_positions: number;
    resolved_positions: number;
    unresolved_positions: number;
    total_cost_basis: number;
  };

  console.log('SQL total positions:', sql.total_positions);
  console.log('SQL resolved positions:', sql.resolved_positions);
  console.log('SQL unresolved positions:', sql.unresolved_positions);
  console.log('SQL total cost basis:', '$' + Number(sql.total_cost_basis).toLocaleString());

  // Check engine vs SQL position counts
  const engineOpenPositions = result.positions.filter(p => p.amount > 0).length;
  console.log('\nEngine open positions:', engineOpenPositions);
  console.log('SQL total positions:', sql.total_positions);

  if (engineOpenPositions !== sql.total_positions) {
    console.log('⚠️ MISMATCH in position count!');
  }

  await client.close();
}

main().catch(console.error);
