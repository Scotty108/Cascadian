/**
 * Analyze the hybrid formula for PnL calculation
 *
 * Key insight: For positions with redemption, use cashflow only.
 * For positions without redemption, use cashflow + token_value * payout_norm.
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  const wallet = '0x56bf1a64a14601aff2de20bb01045aed8da6c45a';

  console.log('=' .repeat(70));
  console.log('Hybrid Formula Analysis for JustDoIt');
  console.log('=' .repeat(70));

  // Check positions that are still open (non-zero final tokens)
  console.log('\nOpen positions (tokens != 0 after all events):');

  const open = await clickhouse.query({
    query: `
      SELECT
        canonical_condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_tokens,
        any(payout_norm) as payout,
        countIf(source_type = 'PayoutRedemption') as redemption_count
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = '${wallet}'
        AND source_type IN ('CLOB', 'PayoutRedemption')
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY canonical_condition_id, outcome_index
      HAVING abs(sum(token_delta)) > 1
      ORDER BY abs(sum(token_delta)) DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });

  const openRows: any[] = await open.json();
  console.log('cond_id               | out | cash_flow   | tokens     | payout | redemptions');
  console.log('-'.repeat(85));

  let sumUnrealizedValue = 0;
  for (const r of openRows) {
    const tokens = Number(r.final_tokens);
    const payout = r.payout !== null ? Number(r.payout) : 0;
    const unrealizedValue = tokens * payout;
    const cashFlow = Number(r.cash_flow);
    sumUnrealizedValue += unrealizedValue;

    console.log(
      `${r.canonical_condition_id.slice(0, 20)}... | ${String(r.outcome_index).padStart(3)} | ` +
      `$${cashFlow.toFixed(2).padStart(10)} | ` +
      `${tokens.toFixed(0).padStart(10)} | ` +
      `${String(r.payout).padStart(6)} | ` +
      `${r.redemption_count}`
    );
  }

  console.log(`\nSum of unrealized token value: $${sumUnrealizedValue.toFixed(2)}`);

  // Now compute what UI might be doing differently
  // Maybe UI only counts realized PnL (positions fully closed)?
  console.log('\n\nFully closed positions (tokens = 0 after all events):');

  const closed = await clickhouse.query({
    query: `
      SELECT
        sum(usdc_pnl) as realized_pnl,
        count() as position_count
      FROM (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) as usdc_pnl,
          sum(token_delta) as tokens
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${wallet}'
          AND source_type IN ('CLOB', 'PayoutRedemption')
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
        HAVING abs(sum(token_delta)) < 1
      )
    `,
    format: 'JSONEachRow'
  });

  const closedRow = (await closed.json())[0] as any;
  console.log(`  Fully realized positions: ${closedRow.position_count}`);
  console.log(`  Realized PnL from closed: $${Number(closedRow.realized_pnl).toFixed(2)}`);

  // Compare formulas
  console.log('\n\n' + '=' .repeat(70));
  console.log('Formula Comparison:');
  console.log('=' .repeat(70));

  // Hybrid: for redeemed positions use cashflow, for others use cashflow + tokens * payout
  const hybrid = await clickhouse.query({
    query: `
      SELECT sum(
        CASE
          WHEN has_redemption = 1 THEN usdc_delta
          ELSE usdc_delta + token_delta * coalesce(payout_norm, 0)
        END
      ) as pnl
      FROM (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) as usdc_delta,
          sum(token_delta) as token_delta,
          any(payout_norm) as payout_norm,
          countIf(source_type = 'PayoutRedemption') > 0 as has_redemption
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${wallet}'
          AND source_type IN ('CLOB', 'PayoutRedemption')
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const hybridRow = (await hybrid.json())[0] as any;
  console.log(`Hybrid (cashflow if redeemed):  $${Number(hybridRow.pnl).toFixed(2)}`);

  // Realized only (closed positions)
  console.log(`Realized only (closed pos):     $${Number(closedRow.realized_pnl).toFixed(2)}`);

  console.log(`\nUI Target:                      $1,519.31`);

  // Debug: what if we only count CLOB and ignore redemptions entirely?
  console.log('\n\nAlternative: CLOB-only with tokens valued at payout_norm');
  const clobOnly = await clickhouse.query({
    query: `
      SELECT sum(usdc_delta + token_delta * coalesce(payout_norm, 0)) as pnl
      FROM (
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(usdc_delta) as usdc_delta,
          sum(token_delta) as token_delta,
          any(payout_norm) as payout_norm
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${wallet}'
          AND source_type = 'CLOB'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
      )
    `,
    format: 'JSONEachRow'
  });
  const clobOnlyRow = (await clobOnly.json())[0] as any;
  console.log(`CLOB-only (V17):               $${Number(clobOnlyRow.pnl).toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
