/**
 * Debug V17 Position Resolution Status
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('=== CHECKING RESOLUTION STATUS OF TOP POSITIONS ===');
  console.log('');

  // Get top positions with resolution info
  const q1 = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    ),
    positions AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        sum(CASE WHEN d.side = 'buy' THEN abs(d.tokens) ELSE 0 END) as buy_tokens,
        sum(CASE WHEN d.side = 'sell' THEN abs(d.tokens) ELSE 0 END) as sell_tokens,
        sum(CASE WHEN d.side = 'buy' THEN abs(d.usdc) ELSE 0 END) as buy_usdc,
        sum(CASE WHEN d.side = 'sell' THEN abs(d.usdc) ELSE 0 END) as sell_usdc
      FROM deduped d
      INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
    )
    SELECT
      p.condition_id,
      p.outcome_index,
      p.buy_tokens,
      p.sell_tokens,
      p.buy_usdc,
      p.sell_usdc,
      p.sell_usdc - p.buy_usdc as cash_flow,
      p.buy_tokens - p.sell_tokens as final_shares,
      r.payout_numerators,
      r.resolved_at
    FROM positions p
    LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
    ORDER BY p.buy_usdc DESC
    LIMIT 15
  `;

  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const positions = (await r1.json()) as any[];

  console.log('Top positions with resolution status:');
  console.log('');

  let resolvedCount = 0;
  let unresolvedCount = 0;
  let resolvedPnl = 0;
  let unresolvedValue = 0;

  for (const p of positions) {
    const cond = p.condition_id.slice(0, 16) + '...';
    const cashFlow = Number(p.cash_flow);
    const finalShares = Number(p.final_shares);
    const payouts = p.payout_numerators ? JSON.parse(p.payout_numerators) : [];
    const isResolved = payouts.length > Number(p.outcome_index);
    const resPrice = isResolved ? payouts[Number(p.outcome_index)] : null;

    let pnl = 0;
    if (isResolved && resPrice !== null) {
      pnl = cashFlow + finalShares * resPrice;
      resolvedPnl += pnl;
      resolvedCount++;
    } else {
      // Unrealized
      pnl = cashFlow + finalShares * 0.5;
      unresolvedValue += pnl;
      unresolvedCount++;
    }

    const status = isResolved ? 'RESOLVED' : 'UNRESOLVED';
    console.log(
      `${cond} | outcome ${p.outcome_index} | buy $${Number(p.buy_usdc).toFixed(0).padStart(7)} | sell $${Number(p.sell_usdc).toFixed(0).padStart(7)} | shares ${finalShares.toFixed(0).padStart(8)} | ${status} | pnl $${pnl.toFixed(0)}`
    );
  }

  console.log('');
  console.log('Summary of top 15:');
  console.log('  Resolved:', resolvedCount, 'positions, PnL:', '$' + resolvedPnl.toFixed(2));
  console.log('  Unresolved:', unresolvedCount, 'positions, unrealized:', '$' + unresolvedValue.toFixed(2));

  // Check total unique positions
  console.log('');
  console.log('--- Total Position Count ---');

  const q2 = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}') AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      count(DISTINCT (m.condition_id, m.outcome_index)) as position_count
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v3 m ON d.token_id = m.token_id_dec
  `;

  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const total = ((await r2.json()) as any[])[0];
  console.log('Total unique (condition_id, outcome_index) pairs:', total.position_count);
}

main().catch(console.error);
