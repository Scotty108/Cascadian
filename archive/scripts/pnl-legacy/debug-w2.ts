/**
 * Debug W2 PnL Calculation
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

const W2 = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838';

async function main() {
  console.log('=== W2 PnL DEBUGGING ===');
  console.log('UI PnL: $4,405');
  console.log('');

  // Get all conditions with trades and resolutions for W2
  const result = await client.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        COUNT(*) as trades,
        SUM(CASE WHEN t.side = 'buy' THEN -t.usdc_amount ELSE t.usdc_amount END)/1e6 as cash_delta,
        SUM(CASE WHEN t.side = 'buy' THEN t.token_amount ELSE -t.token_amount END)/1e6 as final_shares,
        any(r.payout_numerators) as payout_numerators,
        any(r.resolved_at IS NOT NULL) as is_resolved
      FROM pm_trader_events_v2 t
      JOIN pm_token_to_condition_map_v3 m ON toString(t.token_id) = toString(m.token_id_dec)
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      WHERE t.trader_wallet = '${W2}' AND t.is_deleted = 0
      GROUP BY m.condition_id, m.outcome_index
      ORDER BY ABS(cash_delta) DESC
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];

  console.log('Found', rows.length, 'condition/outcome pairs');
  console.log('');
  console.log('Sample rows:');
  console.log('condition_id | outcome | cash_delta | final_shares | payout | resolved');
  console.log('-'.repeat(80));

  for (const r of rows.slice(0, 10)) {
    const condId = String(r.condition_id || '');
    const payout = r.payout_numerators ? String(r.payout_numerators).slice(0, 12) : 'NULL';
    console.log(
      condId.slice(0, 16) + '... | ' +
      r.outcome_index + ' | ' +
      '$' + Number(r.cash_delta || 0).toFixed(2).padStart(10) + ' | ' +
      Number(r.final_shares || 0).toFixed(2).padStart(10) + ' | ' +
      payout.padEnd(12) + ' | ' +
      (r.is_resolved ? 'YES' : 'NO')
    );
  }

  console.log('');
  console.log('=== CALCULATING REALIZED PNL ===');

  let totalPnL = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const r of rows) {
    const payoutNumerators = r.payout_numerators as string | null;

    if (payoutNumerators === null || payoutNumerators === undefined) {
      unresolvedCount++;
      continue;
    }

    resolvedCount++;

    // Parse payout_numerators like '[0, 1000000]' or '[1, 0]'
    const payouts: number[] = JSON.parse(payoutNumerators);
    const sum = payouts.reduce((a, b) => a + b, 0);
    const outcomeIndex = r.outcome_index as number;
    const resolvedPrice = sum > 0 ? payouts[outcomeIndex] / sum : 0;

    const cashDelta = r.cash_delta as number;
    const finalShares = r.final_shares as number;
    const pnl = cashDelta + (finalShares * resolvedPrice);

    totalPnL += pnl;
  }

  console.log('Resolved conditions:', resolvedCount);
  console.log('Unresolved conditions:', unresolvedCount);
  console.log('');
  console.log('CALCULATED PnL: $' + totalPnL.toFixed(2));
  console.log('UI PnL: $4,405.00');
  console.log('Difference: $' + (totalPnL - 4405).toFixed(2));
  console.log('Error: ' + (Math.abs(totalPnL - 4405) / 4405 * 100).toFixed(1) + '%');

  await client.close();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
