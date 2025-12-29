/**
 * Debug V9 positions for a wallet
 * Shows position-level breakdown to understand where the formula fails
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a'; // darkrider11

async function main() {
  console.log(`\n=== V9 Position Debug for ${WALLET} ===\n`);

  // Get top positions by impact
  const query = `
    WITH
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY condition_id, outcome_index
      )
    SELECT
      condition_id,
      outcome_index,
      cash_flow,
      final_tokens,
      resolution_price,
      if(resolution_price IS NOT NULL,
         cash_flow + final_tokens * resolution_price,
         0) AS realized_pnl,
      if(resolution_price IS NULL,
         cash_flow + final_tokens * 0.5,
         0) AS unrealized_pnl
    FROM positions
    ORDER BY abs(if(resolution_price IS NOT NULL, cash_flow + final_tokens * resolution_price, cash_flow + final_tokens * 0.5)) DESC
    LIMIT 20
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json() as any[];

    console.log('Top 20 positions by PnL impact:');
    console.log('condition_id | outcome | cash_flow | final_tokens | res_price | realized | unrealized');
    console.log('-'.repeat(120));

    let totalRealized = 0;
    let totalUnrealized = 0;

    for (const row of rows) {
      const cf = Number(row.cash_flow);
      const ft = Number(row.final_tokens);
      const rp = row.resolution_price ? Number(row.resolution_price) : null;
      const realized = Number(row.realized_pnl);
      const unrealized = Number(row.unrealized_pnl);

      totalRealized += realized;
      totalUnrealized += unrealized;

      console.log(
        `${row.condition_id.slice(0, 16)}... | ${row.outcome_index} | ${cf >= 0 ? '+' : ''}${cf.toLocaleString(undefined, {maximumFractionDigits: 0})} | ${ft.toLocaleString(undefined, {maximumFractionDigits: 0})} | ${rp !== null ? rp.toFixed(2) : 'N/A'} | ${realized >= 0 ? '+' : ''}${realized.toLocaleString(undefined, {maximumFractionDigits: 0})} | ${unrealized >= 0 ? '+' : ''}${unrealized.toLocaleString(undefined, {maximumFractionDigits: 0})}`
      );
    }

    console.log('-'.repeat(120));
    console.log(`Top 20 subtotal: realized=$${totalRealized.toLocaleString()}, unrealized=$${totalUnrealized.toLocaleString()}`);

    // Also get totals
    const totalsQuery = `
      WITH positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
        GROUP BY condition_id, outcome_index
      )
      SELECT
        count() as total_positions,
        sumIf(cash_flow + final_tokens * resolution_price, resolution_price IS NOT NULL) as total_realized,
        sumIf(cash_flow + final_tokens * 0.5, resolution_price IS NULL) as total_unrealized,
        sum(cash_flow) as total_cash_flow,
        sum(final_tokens) as total_final_tokens
      FROM positions
    `;

    const totalsResult = await clickhouse.query({ query: totalsQuery, format: 'JSONEachRow' });
    const totals = (await totalsResult.json() as any[])[0];

    console.log('\n=== Grand Totals ===');
    console.log(`Total positions: ${totals.total_positions}`);
    console.log(`Total cash flow: $${Number(totals.total_cash_flow).toLocaleString()}`);
    console.log(`Total final tokens: ${Number(totals.total_final_tokens).toLocaleString()}`);
    console.log(`Total realized PnL: $${Number(totals.total_realized).toLocaleString()}`);
    console.log(`Total unrealized PnL: $${Number(totals.total_unrealized).toLocaleString()}`);

    // Check for suspicious positions (huge token amounts)
    console.log('\n=== Suspicious Positions (final_tokens > 100k) ===');
    const suspiciousQuery = `
      WITH positions AS (
        SELECT
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          any(payout_norm) AS resolution_price
        FROM pm_unified_ledger_v9_clob_tbl
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND source_type = 'CLOB'
        GROUP BY condition_id, outcome_index
      )
      SELECT
        condition_id,
        outcome_index,
        cash_flow,
        final_tokens,
        resolution_price,
        if(resolution_price IS NOT NULL, cash_flow + final_tokens * resolution_price, 0) as realized
      FROM positions
      WHERE abs(final_tokens) > 100000
      ORDER BY abs(final_tokens) DESC
      LIMIT 10
    `;
    const suspiciousResult = await clickhouse.query({ query: suspiciousQuery, format: 'JSONEachRow' });
    const suspicious = await suspiciousResult.json() as any[];

    for (const row of suspicious) {
      console.log(`${row.condition_id.slice(0, 16)}... | outcome=${row.outcome_index} | tokens=${Number(row.final_tokens).toLocaleString()} | res_price=${row.resolution_price || 'N/A'} | realized=$${Number(row.realized).toLocaleString()}`);
    }

  } catch (e) {
    console.error('ERROR:', e);
  }

  console.log('\n=== Expected UI Value: +$604,472 ===\n');
}

main().catch(console.error);
