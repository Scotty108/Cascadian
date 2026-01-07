/**
 * Analyze Win/Loss counts for a wallet
 * Compares market-level and position-level win rates
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

const wallet = process.argv[2] || '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae'; // @Latina

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`WIN/LOSS ANALYSIS FOR ${wallet.slice(0, 10)}...`);
  console.log(`${'='.repeat(60)}\n`);

  // Get position-level win/loss (positions held at resolution)
  // payout_numerators is stored as "[1,0]", "[0,1]", "[1000000,0]", etc.
  // Need to find which index has the non-zero value (winner)
  const positionQuery = `
    SELECT
      condition_id,
      outcome_index,
      winning_outcome,
      net_position,
      outcome_index = winning_outcome as is_winner
    FROM (
      SELECT
        condition_id,
        outcome_index,
        winning_outcome,
        sum(case when lower(side) = 'buy' then tokens else -tokens end) as net_position
      FROM (
        SELECT
          m.condition_id as condition_id,
          m.outcome_index as outcome_index,
          -- Parse payout_numerators as JSON array and find winning index
          -- For binary markets: [X,0] -> 0 wins, [0,X] -> 1 wins where X > 0
          CASE
            WHEN JSONExtractUInt(r.payout_numerators, 1) > JSONExtractUInt(r.payout_numerators, 2) THEN 0
            WHEN JSONExtractUInt(r.payout_numerators, 2) > JSONExtractUInt(r.payout_numerators, 1) THEN 1
            ELSE -1  -- Tie or invalid
          END as winning_outcome,
          t.side as side,
          t.token_amount / 1000000.0 as tokens
        FROM pm_trader_events_v2 t
        INNER JOIN pm_token_to_condition_map_current m ON t.token_id = m.token_id_dec
        INNER JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
        WHERE lower(t.trader_wallet) = lower('${wallet}')
          AND t.is_deleted = 0
          AND t.role = 'maker'
      )
      GROUP BY condition_id, outcome_index, winning_outcome
    )
    WHERE net_position > 0.001
  `;

  const posResult = await client.query({ query: positionQuery, format: 'JSONEachRow' });
  const positions = await posResult.json() as any[];

  // Calculate stats from positions
  const winningPositions = positions.filter(p => p.is_winner === 1);
  const losingPositions = positions.filter(p => p.is_winner === 0);

  // Unique markets
  const winningMarkets = new Set(winningPositions.map(p => p.condition_id));
  const losingMarkets = new Set(losingPositions.map(p => p.condition_id));
  const allMarkets = new Set(positions.map(p => p.condition_id));

  // Some markets may have both winning AND losing positions (if user held both YES and NO)
  const pureWinMarkets = [...winningMarkets].filter(c => !losingMarkets.has(c));
  const pureLoseMarkets = [...losingMarkets].filter(c => !winningMarkets.has(c));
  const mixedMarkets = [...winningMarkets].filter(c => losingMarkets.has(c));

  console.log('POSITION LEVEL (YES/NO positions held at resolution):');
  console.log(`  Total Positions: ${positions.length}`);
  console.log(`  Winning Positions: ${winningPositions.length}`);
  console.log(`  Losing Positions: ${losingPositions.length}`);
  const posWinRate = positions.length > 0 ? (winningPositions.length / positions.length * 100).toFixed(1) : '0.0';
  console.log(`  Position Win Rate: ${posWinRate}%`);

  console.log('\nMARKET LEVEL (unique conditions):');
  console.log(`  Total Resolved Markets: ${allMarkets.size}`);
  console.log(`  Pure Win Markets: ${pureWinMarkets.length}`);
  console.log(`  Pure Lose Markets: ${pureLoseMarkets.length}`);
  console.log(`  Mixed Markets (held both): ${mixedMarkets.length}`);
  const mktWinRate = allMarkets.size > 0 ? (pureWinMarkets.length / allMarkets.size * 100).toFixed(1) : '0.0';
  console.log(`  Market Win Rate (pure wins): ${mktWinRate}%`);

  // Show some sample positions for debugging
  console.log('\nSAMPLE POSITIONS (first 5):');
  positions.slice(0, 5).forEach((p, i) => {
    console.log(`  ${i + 1}. condition=${p.condition_id.slice(0, 16)}... outcome=${p.outcome_index} winner=${p.winning_outcome} net=${p.net_position.toFixed(2)} is_winner=${p.is_winner}`);
  });

  await client.close();
}

main().catch(console.error);
