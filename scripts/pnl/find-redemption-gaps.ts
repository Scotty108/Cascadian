/**
 * Find positions where V19s expected redemption differs from actual redemption
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const wallet = process.argv[2] || '0x42592084120b0d5287059919d2a96b3b7acb936f';

async function main() {
  console.log('=== REDEMPTION GAP ANALYSIS ===');
  console.log('Wallet:', wallet);
  console.log('');

  // Find positions where tokens*resolution != redemption (or no redemption)
  const q = `
    WITH clob AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS clob_cash,
        sum(token_delta) AS clob_tokens
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
      GROUP BY condition_id, outcome_index
    ),
    redemptions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS redemption_usdc
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
      GROUP BY condition_id, outcome_index
    ),
    resolutions AS (
      SELECT
        condition_id,
        outcome_index,
        any(resolved_price) AS resolved_price
      FROM vw_pm_resolution_prices
      GROUP BY condition_id, outcome_index
    )
    SELECT
      substring(c.condition_id, 1, 20) as cond_short,
      c.outcome_index as out,
      round(c.clob_tokens, 0) as tokens,
      r.resolved_price as res,
      round(c.clob_tokens * coalesce(r.resolved_price, 0), 0) AS expected_red,
      round(coalesce(red.redemption_usdc, 0), 0) AS actual_red,
      round(c.clob_tokens * coalesce(r.resolved_price, 0) - coalesce(red.redemption_usdc, 0), 0) AS gap
    FROM clob c
    LEFT JOIN resolutions r ON c.condition_id = r.condition_id AND c.outcome_index = r.outcome_index
    LEFT JOIN redemptions red ON c.condition_id = red.condition_id AND c.outcome_index = red.outcome_index
    WHERE abs(c.clob_tokens * coalesce(r.resolved_price, 0) - coalesce(red.redemption_usdc, 0)) > 1000
    ORDER BY abs(c.clob_tokens * coalesce(r.resolved_price, 0) - coalesce(red.redemption_usdc, 0)) DESC
    LIMIT 20
  `;

  const r = await client.query({ query: q, format: 'JSONEachRow' });
  const rows = (await r.json()) as Array<{
    cond_short: string;
    out: number;
    tokens: number;
    res: number | null;
    expected_red: number;
    actual_red: number;
    gap: number;
  }>;

  console.log('Positions where expected_redemption (tokens*res) differs from actual_redemption:');
  console.log('');
  console.log(
    'condition'.padEnd(22) +
      'out'.padStart(4) +
      'tokens'.padStart(12) +
      'res'.padStart(6) +
      'expected$'.padStart(12) +
      'actual$'.padStart(12) +
      'gap$'.padStart(12)
  );
  console.log('-'.repeat(80));

  let totalGap = 0;
  for (const row of rows) {
    const resStr = row.res !== null ? row.res.toFixed(2) : 'null';
    console.log(
      String(row.cond_short).padEnd(22) +
        String(row.out).padStart(4) +
        String(row.tokens).padStart(12) +
        resStr.padStart(6) +
        String(row.expected_red).padStart(12) +
        String(row.actual_red).padStart(12) +
        String(row.gap).padStart(12)
    );
    totalGap += Number(row.gap);
  }

  console.log('-'.repeat(80));
  console.log('Sum of shown gaps: $' + totalGap.toFixed(0));
  console.log('');
  console.log('Explanation:');
  console.log('- expected_red = tokens * resolution_price (V19s assumption)');
  console.log('- actual_red = PayoutRedemption USDC from ledger');
  console.log('- gap = expected - actual (positive = V19s overcounts)');

  // Sum up the total gap across all positions
  const q2 = `
    WITH clob AS (
      SELECT
        condition_id,
        outcome_index,
        sum(token_delta) AS clob_tokens
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
      GROUP BY condition_id, outcome_index
    ),
    redemptions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS redemption_usdc
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'PayoutRedemption'
      GROUP BY condition_id, outcome_index
    ),
    resolutions AS (
      SELECT
        condition_id,
        outcome_index,
        any(resolved_price) AS resolved_price
      FROM vw_pm_resolution_prices
      GROUP BY condition_id, outcome_index
    )
    SELECT
      sum(c.clob_tokens * coalesce(r.resolved_price, 0)) AS total_expected_redemption,
      sum(coalesce(red.redemption_usdc, 0)) AS total_actual_redemption,
      sum(c.clob_tokens * coalesce(r.resolved_price, 0)) - sum(coalesce(red.redemption_usdc, 0)) AS total_gap
    FROM clob c
    LEFT JOIN resolutions r ON c.condition_id = r.condition_id AND c.outcome_index = r.outcome_index
    LEFT JOIN redemptions red ON c.condition_id = red.condition_id AND c.outcome_index = red.outcome_index
  `;

  const r2 = await client.query({ query: q2, format: 'JSONEachRow' });
  const summary = (await r2.json()) as Array<{
    total_expected_redemption: number;
    total_actual_redemption: number;
    total_gap: number;
  }>;

  console.log('');
  console.log('=== TOTAL GAP ANALYSIS ===');
  for (const s of summary) {
    console.log('Expected redemption (tokens*res): $' + Number(s.total_expected_redemption).toFixed(2));
    console.log('Actual redemption (ledger):       $' + Number(s.total_actual_redemption).toFixed(2));
    console.log('Gap (V19s overcounting):          $' + Number(s.total_gap).toFixed(2));
  }

  await client.close();
}

main().catch(console.error);
