/**
 * Verify Ledger PnL Calculation
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  console.log('═'.repeat(60));
  console.log('LEDGER PNL VERIFICATION');
  console.log('═'.repeat(60));

  // CONDITION-level closed positions (both YES and NO tokens closed)
  const condClosedResult = await client.query({
    query: `
      SELECT
        condition_id,
        sum(case when outcome_index = 0 then token_delta else 0 end) as yes_tokens,
        sum(case when outcome_index = 1 then token_delta else 0 end) as no_tokens,
        sum(case when outcome_index = 0 then usdc_delta else 0 end) as yes_usdc,
        sum(case when outcome_index = 1 then usdc_delta else 0 end) as no_usdc,
        sum(usdc_delta) as total_usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY condition_id
      HAVING abs(sum(case when outcome_index = 0 then token_delta else 0 end)) < 100
         AND abs(sum(case when outcome_index = 1 then token_delta else 0 end)) < 100
      ORDER BY abs(sum(usdc_delta)) DESC
    `,
    format: 'JSONEachRow'
  });
  const condClosed = await condClosedResult.json() as any[];

  console.log('\nCONDITION-LEVEL Closed Positions (both YES and NO ~0):');
  console.log(`Found: ${condClosed.length} conditions`);

  let totalClosedPnL = 0;
  for (const c of condClosed) {
    totalClosedPnL += Number(c.total_usdc);
  }
  console.log(`Total realized PnL: $${(totalClosedPnL/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}M`);

  console.log('\nTop 5 closed conditions:');
  for (const c of condClosed.slice(0, 5)) {
    console.log(`  ${c.condition_id.slice(0,12)}... | YES: ${Math.round(c.yes_tokens)} | NO: ${Math.round(c.no_tokens)} | PnL: $${(Number(c.total_usdc)/1e6).toFixed(4)}M`);
  }

  // CONDITION-level open positions
  const condOpenResult = await client.query({
    query: `
      SELECT
        condition_id,
        sum(case when outcome_index = 0 then token_delta else 0 end) as yes_tokens,
        sum(case when outcome_index = 1 then token_delta else 0 end) as no_tokens,
        sum(case when outcome_index = 0 then usdc_delta else 0 end) as yes_usdc,
        sum(case when outcome_index = 1 then usdc_delta else 0 end) as no_usdc,
        sum(usdc_delta) as total_usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY condition_id
      HAVING abs(sum(case when outcome_index = 0 then token_delta else 0 end)) >= 100
         OR abs(sum(case when outcome_index = 1 then token_delta else 0 end)) >= 100
      ORDER BY abs(sum(usdc_delta)) DESC
    `,
    format: 'JSONEachRow'
  });
  const condOpen = await condOpenResult.json() as any[];

  console.log('\n' + '─'.repeat(60));
  console.log('CONDITION-LEVEL Open Positions:');
  console.log(`Found: ${condOpen.length} conditions`);

  let totalOpenCost = 0;
  for (const c of condOpen) {
    totalOpenCost += Number(c.total_usdc);
  }
  console.log(`Total cost basis: $${(totalOpenCost/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}M`);

  // Calculate unrealized at different prices
  let totalOpenYesTokens = 0;
  let totalOpenNoTokens = 0;
  for (const c of condOpen) {
    totalOpenYesTokens += Number(c.yes_tokens);
    totalOpenNoTokens += Number(c.no_tokens);
  }

  console.log(`\nOpen tokens: YES=${(totalOpenYesTokens/1e6).toFixed(2)}M, NO=${(totalOpenNoTokens/1e6).toFixed(2)}M`);

  // Compare to TOKEN-level analysis
  console.log('\n' + '═'.repeat(60));
  console.log('COMPARISON: TOKEN vs CONDITION level');
  console.log('═'.repeat(60));

  const tokenClosedResult = await client.query({
    query: `
      SELECT count() as cnt, sum(net_usdc) as total_usdc
      FROM (
        SELECT token_id, sum(usdc_delta) as net_usdc
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}'
        GROUP BY token_id
        HAVING abs(sum(token_delta)) < 1
      )
    `,
    format: 'JSONEachRow'
  });
  const tokenClosed = await tokenClosedResult.json() as any[];

  console.log('TOKEN-level closed:');
  console.log(`  Count: ${tokenClosed[0].cnt} tokens`);
  console.log(`  Total USDC: $${(Number(tokenClosed[0].total_usdc)/1e6).toFixed(2)}M`);

  console.log('\nCONDITION-level closed:');
  console.log(`  Count: ${condClosed.length} conditions`);
  console.log(`  Total USDC: $${(totalClosedPnL/1e6).toFixed(2)}M`);

  console.log('\nDifference explains:');
  console.log(`  TOKEN-level counts each outcome separately`);
  console.log(`  CONDITION-level requires BOTH outcomes closed`);

  // Final PnL calculation
  console.log('\n' + '═'.repeat(60));
  console.log('FINAL PNL CALCULATION');
  console.log('═'.repeat(60));
  console.log(`Condition-level Realized: $${(totalClosedPnL/1e6).toFixed(2)}M`);
  console.log(`Condition-level Open Cost: $${(totalOpenCost/1e6).toFixed(2)}M`);
  console.log(`Expected UI PnL: ~$165K`);

  await client.close();
}
main().catch(console.error);
