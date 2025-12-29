/**
 * Debug W3 PnL - Expected $5.44, getting $2.5K
 * Terminal: Claude 1
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

const W3 = '0x418db17eaa8f25eaf2085657d0becd82462c6786';

async function main() {
  console.log('=== W3 PnL DEBUGGING ===');
  console.log('UI PnL: $5.44');
  console.log('Our PnL: ~$2,500');
  console.log('');

  // Get basic stats
  console.log('1. BASIC STATS');
  const stats = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT event_id) as unique_events,
        SUM(usdc_amount)/1e6 as total_usdc,
        SUM(token_amount)/1e6 as total_tokens,
        MIN(trade_time) as first_trade,
        MAX(trade_time) as last_trade
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${W3}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  console.log((await stats.json())[0]);

  // Check resolution status
  console.log('');
  console.log('2. RESOLUTION STATUS');
  const resolutions = await client.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc,
          any(token_amount)/1e6 as tokens,
          any(t.token_id) as token_id
        FROM pm_trader_events_v2 t
        WHERE trader_wallet = '${W3}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT
          d.*,
          m.condition_id,
          m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          condition_id,
          outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_delta,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      )
      SELECT
        a.condition_id,
        a.outcome_index,
        a.cash_delta,
        a.final_shares,
        r.payout_numerators,
        r.resolved_at IS NOT NULL as is_resolved
      FROM aggregated a
      LEFT JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      ORDER BY ABS(a.cash_delta) DESC
    `,
    format: 'JSONEachRow'
  });
  const rows = await resolutions.json() as any[];

  console.log('condition_id | outcome | cash_delta | final_shares | payout | resolved');
  console.log('-'.repeat(85));

  let totalResolved = 0;
  let totalUnresolved = 0;
  let resolvedPnL = 0;
  let unresolvedPositionValue = 0;

  for (const r of rows) {
    const condId = String(r.condition_id || '').slice(0, 16);
    const payout = r.payout_numerators ? String(r.payout_numerators).slice(0, 15) : 'NULL';
    console.log(
      condId + '... | ' +
      r.outcome_index + ' | ' +
      '$' + Number(r.cash_delta || 0).toFixed(2).padStart(10) + ' | ' +
      Number(r.final_shares || 0).toFixed(2).padStart(10) + ' | ' +
      payout.padEnd(15) + ' | ' +
      (r.is_resolved ? 'YES' : 'NO')
    );

    if (r.payout_numerators) {
      totalResolved++;
      // Calculate PnL for resolved
      const payouts: number[] = JSON.parse(r.payout_numerators);
      const sum = payouts.reduce((a: number, b: number) => a + b, 0);
      const resolvedPrice = sum > 0 ? payouts[r.outcome_index] / sum : 0;
      resolvedPnL += r.cash_delta + (r.final_shares * resolvedPrice);
    } else {
      totalUnresolved++;
      // Unresolved positions - just count final_shares value
      unresolvedPositionValue += Math.abs(r.final_shares);
    }
  }

  console.log('-'.repeat(85));
  console.log('');
  console.log('3. SUMMARY');
  console.log('Total conditions:', rows.length);
  console.log('Resolved:', totalResolved);
  console.log('Unresolved:', totalUnresolved);
  console.log('');
  console.log('PnL from resolved markets: $' + resolvedPnL.toFixed(2));
  console.log('Unresolved position value: $' + unresolvedPositionValue.toFixed(2) + ' (shares, not USDC)');
  console.log('');

  if (totalUnresolved > 0) {
    console.log('HYPOTHESIS: UI only shows PnL for resolved markets.');
    console.log('We are including unresolved markets in our calculation.');
  }

  await client.close();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
