/**
 * Check resolved vs unresolved position coverage for a wallet
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0xb744f56635b537e859152d14b022af5afe485210';

  // Get positions
  const posRes = await client.query({
    query: `
      SELECT
        token_id,
        sum(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as net_tokens,
        sumIf(usdc, side = 'buy') as total_cost
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1e6 as usdc,
          any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_dedup_v2_tbl
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      )
      GROUP BY token_id
      HAVING net_tokens > 100
    `,
    format: 'JSONEachRow'
  });
  const positions = await posRes.json() as Array<{token_id: string, net_tokens: number, total_cost: number}>;

  // Get all resolved condition IDs
  const resRes = await client.query({
    query: "SELECT DISTINCT condition_id FROM pm_condition_resolutions WHERE payout_numerators != ''",
    format: 'JSONEachRow'
  });
  const resolved = new Set((await resRes.json() as Array<{condition_id: string}>).map(r => r.condition_id));

  // Get token → condition mapping
  const mapRes = await client.query({
    query: 'SELECT token_id_dec, condition_id FROM pm_token_to_condition_map_current',
    format: 'JSONEachRow'
  });
  const mapping = new Map<string, string>();
  (await mapRes.json() as Array<{token_id_dec: string, condition_id: string}>).forEach(r => mapping.set(r.token_id_dec, r.condition_id));

  // Classify positions
  let resolvedCount = 0, unresolvedCount = 0, unmappedCount = 0;
  let resolvedTokens = 0, unresolvedTokens = 0, unmappedTokens = 0;
  let resolvedCost = 0, unresolvedCost = 0, unmappedCost = 0;

  for (const p of positions) {
    const conditionId = mapping.get(p.token_id);
    if (conditionId === undefined) {
      unmappedCount++;
      unmappedTokens += p.net_tokens;
      unmappedCost += p.total_cost;
    } else if (resolved.has(conditionId)) {
      resolvedCount++;
      resolvedTokens += p.net_tokens;
      resolvedCost += p.total_cost;
    } else {
      unresolvedCount++;
      unresolvedTokens += p.net_tokens;
      unresolvedCost += p.total_cost;
    }
  }

  console.log('Position Resolution Status for wasianiversonworldchamp2025:');
  console.log('Status      | Positions | Tokens           | Cost Basis');
  console.log('-'.repeat(70));
  console.log(`RESOLVED    | ${String(resolvedCount).padStart(9)} | ${resolvedTokens.toLocaleString().padStart(16)} | $${resolvedCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`UNRESOLVED  | ${String(unresolvedCount).padStart(9)} | ${unresolvedTokens.toLocaleString().padStart(16)} | $${unresolvedCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`UNMAPPED    | ${String(unmappedCount).padStart(9)} | ${unmappedTokens.toLocaleString().padStart(16)} | $${unmappedCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log('-'.repeat(70));
  const totalCount = resolvedCount + unresolvedCount + unmappedCount;
  const totalTokens = resolvedTokens + unresolvedTokens + unmappedTokens;
  const totalCost = resolvedCost + unresolvedCost + unmappedCost;
  console.log(`TOTAL       | ${String(totalCount).padStart(9)} | ${totalTokens.toLocaleString().padStart(16)} | $${totalCost.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log('');
  console.log('% Resolved:', ((resolvedCost / totalCost) * 100).toFixed(1) + '%');
  console.log('% Unresolved:', ((unresolvedCost / totalCost) * 100).toFixed(1) + '%');
  console.log('');
  console.log('EXPLANATION:');
  console.log('  - RESOLVED positions are auto-settled at 0 (loser) or 1 (winner)');
  console.log('  - UNRESOLVED positions should use mark-to-market (current price)');
  console.log('  - If engine is auto-settling UNRESOLVED positions → bug!');

  await client.close();
}

main().catch(console.error);
