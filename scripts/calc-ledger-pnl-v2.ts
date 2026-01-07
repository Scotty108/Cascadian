/**
 * Calculate PnL from Universal Ledger
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
  console.log('PnL CALCULATION FROM UNIVERSAL LEDGER');
  console.log('Wallet: Latina (' + wallet.slice(0,10) + '...)');
  console.log('Expected UI PnL: ~$165,000');
  console.log('═'.repeat(60));

  // Full ledger summary
  const summaryResult = await client.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        round(sum(token_delta), 2) as total_tokens,
        round(sum(usdc_delta), 2) as total_usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY event_type
      ORDER BY event_type
    `,
    format: 'JSONEachRow'
  });
  const summary = await summaryResult.json() as any[];

  console.log('\nLedger Summary:');
  console.table(summary);

  // Calculate net USDC flow
  let netUsdcFlow = 0;
  for (const row of summary) {
    netUsdcFlow += Number(row.total_usdc);
  }

  // Get current open positions (unrealized)
  const openPosResult = await client.query({
    query: `
      SELECT
        l.token_id,
        l.condition_id,
        l.outcome_index,
        sum(l.token_delta) as net_tokens,
        sum(l.usdc_delta) as net_usdc,
        abs(sum(l.usdc_delta) / nullIf(sum(l.token_delta), 0)) as avg_cost
      FROM pm_wallet_token_ledger_v1 l
      WHERE l.wallet = '${wallet}'
      GROUP BY l.token_id, l.condition_id, l.outcome_index
      HAVING abs(sum(l.token_delta)) > 1
      ORDER BY abs(sum(l.token_delta)) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const openPositions = await openPosResult.json() as any[];

  console.log('\n' + '─'.repeat(60));
  console.log('Top 10 Open Positions:');
  for (const pos of openPositions) {
    const tokens = Number(pos.net_tokens);
    const cost = Number(pos.net_usdc);
    const avgCost = Number(pos.avg_cost) || 0;
    console.log(`  ${pos.token_id.slice(0,12)}... | ${(tokens/1e6).toFixed(2)}M tokens | Cost: $${(cost/1e6).toFixed(2)}M | Avg: $${avgCost.toFixed(4)}`);
  }

  // Get total unrealized value at current prices (need market prices or assume 0.50)
  const totalOpenTokens = openPositions.reduce((sum: number, p: any) => sum + Number(p.net_tokens), 0);
  const totalOpenCost = openPositions.reduce((sum: number, p: any) => sum + Number(p.net_usdc), 0);

  console.log('\n' + '─'.repeat(60));
  console.log('PnL CALCULATION:');
  console.log(`  Net USDC Flow (realized): $${(netUsdcFlow/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  Open Positions Cost:       $${(totalOpenCost/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`  Open Tokens:               ${(totalOpenTokens/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}M`);

  // Unrealized at current prices (would need market data)
  // For now, estimate at 50% (neutral)
  const unrealizedAt50 = totalOpenTokens * 0.50;
  const unrealizedPnL50 = unrealizedAt50 + totalOpenCost; // cost is negative

  console.log(`\n  If open positions worth $0.50 each:`);
  console.log(`    Unrealized value:  $${(unrealizedAt50/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Unrealized PnL:    $${(unrealizedPnL50/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}`);
  console.log(`    Total PnL:         $${((netUsdcFlow + unrealizedPnL50)/1e6).toLocaleString(undefined, {maximumFractionDigits: 2})}`);

  // Check if we can get resolution prices
  const resolvedResult = await client.query({
    query: `
      SELECT
        l.condition_id,
        l.outcome_index,
        sum(l.token_delta) as net_tokens,
        r.payout
      FROM pm_wallet_token_ledger_v1 l
      LEFT JOIN pm_condition_resolutions r
        ON lower(l.condition_id) = lower(r.condition_id)
      WHERE l.wallet = '${wallet}'
      GROUP BY l.condition_id, l.outcome_index, r.payout
      HAVING abs(sum(l.token_delta)) > 1
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const resolvedPositions = await resolvedResult.json() as any[];

  console.log('\n' + '─'.repeat(60));
  console.log('Resolution Status Sample:');
  let resolved = 0, unresolved = 0;
  for (const pos of resolvedPositions) {
    if (pos.payout != null) {
      resolved++;
    } else {
      unresolved++;
    }
  }
  console.log(`  Resolved: ${resolved}, Unresolved: ${unresolved}`);

  // Now let's properly calculate realized PnL
  // Realized = positions that are fully closed (net tokens = 0 or very small)
  console.log('\n' + '═'.repeat(60));
  console.log('REALIZED PnL BREAKDOWN');
  console.log('═'.repeat(60));

  const realizedResult = await client.query({
    query: `
      SELECT
        count() as num_positions,
        round(sum(net_usdc)/1e6, 2) as total_realized_pnl
      FROM (
        SELECT
          token_id,
          sum(token_delta) as net_tokens,
          sum(usdc_delta) as net_usdc
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}'
        GROUP BY token_id
        HAVING abs(sum(token_delta)) < 1  -- Fully closed positions
      )
    `,
    format: 'JSONEachRow'
  });
  const realizedData = await realizedResult.json() as any[];

  if (realizedData.length > 0) {
    console.log(`  Fully closed positions: ${realizedData[0].num_positions}`);
    console.log(`  Realized PnL: $${Number(realizedData[0].total_realized_pnl).toLocaleString()}`);
  }

  // Top winning positions
  console.log('\n' + '─'.repeat(60));
  console.log('Top 10 Closed Positions by PnL:');

  const topClosedResult = await client.query({
    query: `
      SELECT
        token_id,
        round(sum(usdc_delta)/1e6, 2) as realized_pnl,
        round(sum(case when token_delta > 0 then token_delta else 0 end)/1e6, 2) as bought,
        round(sum(case when token_delta < 0 then abs(token_delta) else 0 end)/1e6, 2) as sold
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY token_id
      HAVING abs(sum(token_delta)) < 1
      ORDER BY sum(usdc_delta) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topClosed = await topClosedResult.json() as any[];

  for (const pos of topClosed) {
    console.log(`  ${pos.token_id.slice(0,15)}... | PnL: $${Number(pos.realized_pnl).toLocaleString()} | B:${pos.bought}M S:${pos.sold}M`);
  }

  // Final summary
  console.log('\n' + '═'.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('═'.repeat(60));

  const finalRealizedPnL = realizedData.length > 0 ? Number(realizedData[0].total_realized_pnl) : 0;
  const finalUnrealizedPnL = unrealizedPnL50 / 1e6;
  const finalTotalPnL = finalRealizedPnL + finalUnrealizedPnL;

  console.log(`  Realized PnL:   $${finalRealizedPnL.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Unrealized PnL: $${finalUnrealizedPnL.toLocaleString(undefined, {maximumFractionDigits: 0})} (at $0.50)`);
  console.log(`  Total PnL:      $${finalTotalPnL.toLocaleString(undefined, {maximumFractionDigits: 0})}`);
  console.log(`  Expected UI:    $165,000`);
  console.log(`  Difference:     $${(finalTotalPnL - 165000).toLocaleString(undefined, {maximumFractionDigits: 0})} (${((finalTotalPnL / 165000 - 1) * 100).toFixed(1)}%)`);

  await client.close();
}
main().catch(console.error);
