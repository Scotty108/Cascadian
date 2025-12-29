/**
 * Debug V19s calculation for a specific wallet
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

interface PositionRow {
  condition_id: string;
  outcome_index: number;
  cash_flow: number;
  final_tokens: number;
  trade_count: number;
  resolution_price: number | null;
}

async function main() {
  console.log('=== V19s CALCULATION DEBUG ===');
  console.log('Wallet:', wallet);
  console.log('');

  // Replicate V19s query exactly
  const query = `
    WITH ledger_agg AS (
      SELECT
        condition_id,
        outcome_index,
        sum(usdc_delta) AS cash_flow,
        sum(token_delta) AS final_tokens,
        count() AS trade_count
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${wallet}')
        AND source_type = 'CLOB'
        AND condition_id IS NOT NULL
        AND condition_id != ''
      GROUP BY condition_id, outcome_index
    )
    SELECT
      la.condition_id AS condition_id,
      la.outcome_index AS outcome_index,
      la.cash_flow AS cash_flow,
      la.final_tokens AS final_tokens,
      la.trade_count AS trade_count,
      r.resolved_price AS resolution_price
    FROM ledger_agg la
    LEFT JOIN (
      SELECT
        condition_id,
        outcome_index,
        any(resolved_price) AS resolved_price
      FROM vw_pm_resolution_prices
      GROUP BY condition_id, outcome_index
    ) r ON la.condition_id = r.condition_id AND la.outcome_index = r.outcome_index
    ORDER BY la.condition_id, la.outcome_index
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as PositionRow[];

  console.log('Positions from V19s query: ' + rows.length);

  // Calculate PnL the V19s way
  let totalCashFlow = 0;
  let resolvedPnL = 0;
  let unresolvedCashFlow = 0;
  let unresolvedTokens = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const r of rows) {
    totalCashFlow += r.cash_flow;

    if (r.resolution_price !== null) {
      // Resolved: cash_flow + tokens * resolution_price
      const positionPnL = r.cash_flow + r.final_tokens * r.resolution_price;
      resolvedPnL += positionPnL;
      resolvedCount++;
    } else {
      // Unresolved: track separately
      unresolvedCashFlow += r.cash_flow;
      unresolvedTokens += r.final_tokens;
      unresolvedCount++;
    }
  }

  console.log('');
  console.log('Position breakdown:');
  console.log('  Resolved:    ' + resolvedCount);
  console.log('  Unresolved:  ' + unresolvedCount);
  console.log('');
  console.log('Total cash flow from CLOB:    $' + totalCashFlow.toFixed(2));
  console.log('Resolved PnL (cash+tokens*p): $' + resolvedPnL.toFixed(2));
  console.log('Unrealized cash flow:         $' + unresolvedCashFlow.toFixed(2));
  console.log('Unrealized tokens:            ' + unresolvedTokens.toFixed(2));

  // Show top positions by absolute cash flow
  console.log('');
  console.log('=== TOP 10 POSITIONS BY CASH FLOW ===');
  const sortedPositions = [...rows].sort((a, b) => Math.abs(b.cash_flow) - Math.abs(a.cash_flow));

  console.log(
    'Condition'.padEnd(20) +
      'Cash Flow'.padStart(15) +
      'Tokens'.padStart(15) +
      'ResPrice'.padStart(10) +
      'PnL'.padStart(15)
  );
  console.log('-'.repeat(75));
  for (const p of sortedPositions.slice(0, 10)) {
    const pnl =
      p.resolution_price !== null
        ? p.cash_flow + p.final_tokens * p.resolution_price
        : p.cash_flow; // Just cash_flow if unresolved
    console.log(
      (p.condition_id.substring(0, 18) + '..').padEnd(20) +
        ('$' + p.cash_flow.toFixed(2)).padStart(15) +
        p.final_tokens.toFixed(2).padStart(15) +
        (p.resolution_price !== null ? p.resolution_price.toFixed(2) : 'N/A').padStart(10) +
        ('$' + pnl.toFixed(2)).padStart(15)
    );
  }

  // Compare
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('V19s computed (resolved only): $' + resolvedPnL.toFixed(2));
  console.log('V19s reported:                 $520,101');
  console.log('UI reported:                   $416,896');
  console.log('Gap (V19s - UI):               $' + (520101 - 416896).toFixed(2));

  await client.close();
}

main().catch(console.error);
