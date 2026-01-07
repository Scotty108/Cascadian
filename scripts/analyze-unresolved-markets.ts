/**
 * Analyze ALL unresolved markets for xcnstrategy wallet
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function analyzeAllUnresolved() {
  // Get ALL unresolved condition_ids for this wallet with position sizes
  const q = `
    WITH trades AS (
      SELECT
        side,
        token_id,
        any(usdc_amount) / 1e6 AS usdc,
        token_amount / 1e6 AS tokens,
        max(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY transaction_hash, side, token_id, token_amount
    ),
    positions AS (
      SELECT
        token_id,
        sum(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) -
        sum(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) AS net_tokens,
        sum(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) AS total_usdc_spent
      FROM trades
      GROUP BY token_id
      HAVING net_tokens > 0.01
    ),
    mapped AS (
      SELECT
        p.token_id,
        p.net_tokens,
        p.total_usdc_spent,
        m.condition_id,
        m.outcome_index
      FROM positions p
      JOIN pm_token_to_condition_map_v5 m ON p.token_id = m.token_id_dec
    )
    SELECT
      condition_id,
      outcome_index,
      sum(net_tokens) as shares,
      sum(total_usdc_spent) as cost_basis
    FROM mapped
    WHERE condition_id NOT IN (SELECT condition_id FROM pm_condition_resolutions)
    GROUP BY condition_id, outcome_index
    ORDER BY cost_basis DESC
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];

  console.log('Total unresolved positions:', rows.length);
  console.log('');

  let totalCostBasis = 0;
  let yesPositions = 0;
  let noPositions = 0;

  for (const row of rows) {
    totalCostBasis += row.cost_basis;
    if (row.outcome_index === 0) yesPositions++;
    else noPositions++;
  }

  console.log('Total cost basis:', '$' + totalCostBasis.toFixed(2));
  console.log('Yes positions:', yesPositions);
  console.log('No positions:', noPositions);
  console.log('');

  // Check top 10 positions in Gamma API
  console.log('Top 10 positions by cost basis:');
  console.log('');

  for (const row of rows.slice(0, 10)) {
    const cid = row.condition_id;
    console.log('Condition:', cid.slice(0, 20) + '...');
    console.log('  Outcome Index:', row.outcome_index, '(' + (row.outcome_index === 0 ? 'YES' : 'NO') + ')');
    console.log('  Shares:', row.shares.toFixed(2));
    console.log('  Cost Basis:', '$' + row.cost_basis.toFixed(2));

    try {
      const url = `https://gamma-api.polymarket.com/markets?condition_id=${cid}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const markets = await resp.json();
        if (markets && markets.length > 0) {
          const m = markets[0];
          console.log('  Question:', m.question?.slice(0, 70));
          console.log('  Status: closed=' + m.closed + ', resolved=' + m.resolved + ', active=' + m.active);

          // Determine what outcome should be (for old closed markets)
          if (m.closed && !m.resolved) {
            console.log('  → CLOSED BUT NOT RESOLVED - likely total loss');
          }
        } else {
          console.log('  → NOT FOUND IN GAMMA API');
        }
      }
    } catch (e) {
      console.log('  Error:', (e as Error).message);
    }
    console.log('');
  }

  // Calculate total if all unresolved = 0 (losses)
  console.log('='.repeat(60));
  console.log('If all unresolved positions are treated as total losses:');
  console.log('  Lost shares: all', rows.length, 'positions');
  console.log('  Loss PnL: -$' + totalCostBasis.toFixed(2));
  console.log('');
  console.log('Current engine output: $82,220.85');
  console.log('Adjusted (subtracting unresolved losses): $' + (82220.85 - totalCostBasis).toFixed(2));
}

analyzeAllUnresolved();
