#!/usr/bin/env npx tsx
/**
 * Check resolution prices and calculate PnL for Patapam222 wallet
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const wallet = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191';

  // Get token_ids from ledger
  const ledgerTokens = await clickhouse.query({
    query: `
      SELECT DISTINCT token_id
      FROM pm_regression_ledger_v1
      WHERE wallet = '${wallet}'
        AND token_id NOT LIKE '0x%'
    `,
    format: 'JSONEachRow'
  });
  const tokens = await ledgerTokens.json() as any[];

  console.log('=== Token resolution status for Patapam222 ===\n');

  let totalPnl = 0;
  let totalCashFlow = 0;
  let totalSettlement = 0;

  for (const t of tokens) {
    // Get condition_id and outcome_index
    const mapping = await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id, outcome_index
        FROM vw_pm_ledger
        WHERE token_id = '${t.token_id}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const mapResult = await mapping.json() as any[];

    if (mapResult.length === 0) {
      console.log(t.token_id.slice(0, 30) + '... -> NO MAPPING');
      continue;
    }

    const { condition_id, outcome_index } = mapResult[0];

    // Check resolution
    const resolution = await clickhouse.query({
      query: `
        SELECT resolved_price, resolution_time
        FROM vw_pm_resolution_prices
        WHERE condition_id = '${condition_id}'
          AND outcome_index = ${outcome_index}
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const resResult = await resolution.json() as any[];

    // Get net shares from ledger
    const shares = await clickhouse.query({
      query: `
        SELECT sum(delta_shares) as net_shares, sum(cash_flow_usdc) as cash_flow
        FROM pm_regression_ledger_v1
        WHERE wallet = '${wallet}'
          AND token_id = '${t.token_id}'
      `,
      format: 'JSONEachRow'
    });
    const sharesResult = await shares.json() as any[];

    const resolved = resResult.length ? resResult[0].resolved_price : null;
    const resolvedTime = resResult.length ? resResult[0].resolution_time : 'N/A';
    const netShares = sharesResult[0]?.net_shares || 0;
    const cashFlow = sharesResult[0]?.cash_flow || 0;

    // Calculate PnL for this token
    const settlementValue = resolved !== null ? netShares * resolved : 0;
    const tokenPnl = cashFlow + settlementValue;

    totalCashFlow += cashFlow;
    totalSettlement += settlementValue;
    totalPnl += tokenPnl;

    console.log(`Token: ${t.token_id.slice(0, 30)}...`);
    console.log(`  Condition: ${condition_id.slice(0, 20)}... outcome=${outcome_index}`);
    console.log(`  Resolved: ${resolved !== null ? resolved : 'UNRESOLVED'} (at: ${resolvedTime})`);
    console.log(`  Net shares: ${netShares.toFixed(2)}, Cash flow: $${cashFlow.toFixed(2)}`);
    console.log(`  Settlement value: $${settlementValue.toFixed(2)}`);
    console.log(`  Token PnL: $${tokenPnl.toFixed(2)}`);
    console.log();
  }

  // Also add CTF redemptions if we have them
  const ctfTotal = await clickhouse.query({
    query: `
      SELECT sum(cash_flow_usdc) as ctf_cash
      FROM pm_regression_ledger_v1
      WHERE wallet = '${wallet}'
        AND event_type = 'REDEEM'
    `,
    format: 'JSONEachRow'
  });
  const ctfResult = await ctfTotal.json() as any[];
  const ctfCash = ctfResult[0]?.ctf_cash || 0;

  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total Cash Flow (trades): $${totalCashFlow.toFixed(2)}`);
  console.log(`Total Settlement Value:   $${totalSettlement.toFixed(2)}`);
  console.log(`CTF Redemptions:          $${ctfCash.toFixed(2)}`);
  console.log(`Total PnL:                $${(totalPnl + ctfCash).toFixed(2)}`);
  console.log(`UI Net Total:             $40.42`);
  console.log(`Delta:                    $${(totalPnl + ctfCash - 40.42).toFixed(2)}`);

  await clickhouse.close();
}

main().catch(console.error);
