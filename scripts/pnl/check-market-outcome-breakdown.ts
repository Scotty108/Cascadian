/**
 * Check per-outcome breakdown for a specific market
 * Investigating why ImJustKen's V20 PnL is $850K short
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9d84ce0306f8551e02efef1680475fc0f1dc1344';
const MARKET = 'a0811c97f529d627b7774a5b163ea51db81a17d02c7eb0ecf12aa2e92ad4c7ba';

async function main() {
  console.log('Per-outcome breakdown for top redemption market');
  console.log('='.repeat(100));
  console.log(`Condition: ${MARKET}`);
  console.log('');

  const q = `
    SELECT
      canonical_condition_id,
      outcome_index,
      source_type,
      sum(usdc_delta) as usdc_total,
      sum(token_delta) as token_total,
      any(payout_norm) as resolution
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND canonical_condition_id = '${MARKET}'
    GROUP BY canonical_condition_id, outcome_index, source_type
    ORDER BY source_type, outcome_index
  `;

  const result = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Source           | Outcome | USDC Total       | Token Total      | Resolution');
  console.log('-'.repeat(100));

  for (const r of rows) {
    const usdc = Number(r.usdc_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const tokens = Number(r.token_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(15);
    const res = r.resolution !== null ? String(r.resolution).padStart(10) : 'N/A'.padStart(10);
    console.log(`${r.source_type.padEnd(16)} | ${String(r.outcome_index).padStart(7)} | $${usdc} | ${tokens} | ${res}`);
  }

  // Calculate correct PnL
  console.log('');
  console.log('PnL Calculation:');
  console.log('-'.repeat(100));

  // Get CLOB rows
  const clobRows = rows.filter(r => r.source_type === 'CLOB');
  const redemption = rows.find(r => r.source_type === 'PayoutRedemption');

  let totalPnl = 0;

  for (const clob of clobRows) {
    const cash = Number(clob.usdc_total);
    const tokens = Number(clob.token_total);
    const res = clob.resolution !== null ? Number(clob.resolution) : 0;

    // For binary markets: if outcome 0 has resolution 0, outcome 1 has resolution 1
    // The payout_norm should already reflect the correct value for this outcome
    const pnl = cash + tokens * res;
    totalPnl += pnl;

    console.log(`  Outcome ${clob.outcome_index}: cash=$${cash.toFixed(2)}, tokens=${tokens.toFixed(2)}, res=${res}, PnL=$${pnl.toFixed(2)}`);
  }

  console.log('-'.repeat(100));
  console.log(`  CLOB Total PnL: $${totalPnl.toFixed(2)}`);

  if (redemption) {
    console.log(`  PayoutRedemption: $${Number(redemption.usdc_total).toFixed(2)}`);
  }

  // Now check if the issue is that payout_norm for outcome 1 is NOT being set correctly
  console.log('');
  console.log('Checking payout_numerators from pm_condition_resolutions:');
  console.log('-'.repeat(100));

  const resQuery = `
    SELECT
      condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id = '${MARKET}'
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  if (resRows.length > 0) {
    console.log(`  payout_numerators: ${resRows[0].payout_numerators}`);

    // Parse and show
    const nums = resRows[0].payout_numerators;
    if (nums) {
      try {
        const parsed = JSON.parse(nums);
        console.log(`  Parsed: ${JSON.stringify(parsed)}`);
        console.log(`  Outcome 0 payout: ${parsed[0]}`);
        console.log(`  Outcome 1 payout: ${parsed[1]}`);
      } catch (e) {
        console.log(`  Failed to parse: ${e}`);
      }
    }
  } else {
    console.log('  No resolution found!');
  }

  // Check multiple markets to see the pattern
  console.log('');
  console.log('='.repeat(100));
  console.log('Checking top 10 redemption markets for payout_norm pattern:');
  console.log('-'.repeat(100));

  const patternQuery = `
    SELECT
      canonical_condition_id,
      outcome_index,
      sum(usdc_delta) as clob_cash,
      sum(token_delta) as clob_tokens,
      any(payout_norm) as res_price
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
      AND canonical_condition_id IN (
        SELECT canonical_condition_id
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'PayoutRedemption'
        ORDER BY usdc_delta DESC
        LIMIT 10
      )
    GROUP BY canonical_condition_id, outcome_index
    ORDER BY canonical_condition_id, outcome_index
  `;

  const patternResult = await clickhouse.query({ query: patternQuery, format: 'JSONEachRow' });
  const patternRows = (await patternResult.json()) as any[];

  console.log('Condition (first 25)              | Outcome | CLOB Cash    | Tokens       | payout_norm');
  console.log('-'.repeat(100));

  for (const r of patternRows) {
    const condId = (r.canonical_condition_id || '').substring(0, 25).padEnd(25);
    const cash = Number(r.clob_cash).toFixed(0).padStart(12);
    const tokens = Number(r.clob_tokens).toFixed(0).padStart(12);
    const res = r.res_price !== null ? String(r.res_price).padStart(11) : 'NULL'.padStart(11);
    console.log(`${condId} | ${String(r.outcome_index).padStart(7)} | $${cash} | ${tokens} | ${res}`);
  }

  // KEY INSIGHT: Check if payout_norm is being set correctly for BOTH outcomes
  console.log('');
  console.log('='.repeat(100));
  console.log('KEY INSIGHT: Is payout_norm being set for both outcomes?');
  console.log('-'.repeat(100));

  const bothOutcomesQuery = `
    SELECT
      canonical_condition_id,
      groupArray(outcome_index) as outcomes,
      groupArray(any(payout_norm)) as resolutions
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
      AND canonical_condition_id IN (
        SELECT canonical_condition_id
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'PayoutRedemption'
        ORDER BY usdc_delta DESC
        LIMIT 5
      )
    GROUP BY canonical_condition_id
  `;

  const bothResult = await clickhouse.query({ query: bothOutcomesQuery, format: 'JSONEachRow' });
  const bothRows = (await bothResult.json()) as any[];

  for (const r of bothRows) {
    console.log(`Condition: ${(r.canonical_condition_id as string).substring(0, 40)}...`);
    console.log(`  Outcomes traded: ${JSON.stringify(r.outcomes)}`);
    console.log(`  Resolution prices: ${JSON.stringify(r.resolutions)}`);
    console.log('');
  }
}

main().catch(console.error);
