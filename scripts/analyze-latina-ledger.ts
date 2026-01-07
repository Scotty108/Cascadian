/**
 * Analyze Latina's ledger in detail
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
  console.log('LATINA LEDGER ANALYSIS');
  console.log('═'.repeat(60));

  // Get totals by type
  const totalsResult = await client.query({
    query: `
      SELECT
        event_type,
        sum(token_delta) as tokens,
        sum(usdc_delta) as usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY event_type
      ORDER BY event_type
    `,
    format: 'JSONEachRow'
  });
  const totals = await totalsResult.json() as any[];

  console.log('\nEvent Type Totals (USDC in millions):');
  for (const t of totals) {
    const tokenStr = (Number(t.tokens)/1e6).toFixed(2).padStart(8);
    const usdcStr = (Number(t.usdc)/1e6).toFixed(2).padStart(8);
    console.log(`  ${t.event_type.padEnd(12)}: ${tokenStr}M tokens, ${usdcStr}M USDC`);
  }

  const netTokens = totals.reduce((s: number, t: any) => s + Number(t.tokens), 0);
  const netUsdc = totals.reduce((s: number, t: any) => s + Number(t.usdc), 0);
  console.log(`  ${'─'.repeat(50)}`);
  console.log(`  ${'NET'.padEnd(12)}: ${(netTokens/1e6).toFixed(2).padStart(8)}M tokens, ${(netUsdc/1e6).toFixed(2).padStart(8)}M USDC`);

  // Check closed vs open positions
  const closedResult = await client.query({
    query: `
      SELECT
        'closed' as status,
        count() as num_positions,
        sum(net_usdc) as total_usdc
      FROM (
        SELECT token_id, sum(token_delta) as net_tokens, sum(usdc_delta) as net_usdc
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}'
        GROUP BY token_id
        HAVING abs(sum(token_delta)) < 1  -- Closed positions
      )
      UNION ALL
      SELECT
        'open' as status,
        count() as num_positions,
        sum(net_usdc) as total_usdc
      FROM (
        SELECT token_id, sum(token_delta) as net_tokens, sum(usdc_delta) as net_usdc
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}'
        GROUP BY token_id
        HAVING abs(sum(token_delta)) >= 1  -- Open positions
      )
    `,
    format: 'JSONEachRow'
  });
  const positionStatus = await closedResult.json() as any[];

  console.log('\n' + '─'.repeat(60));
  console.log('Position Status:');
  for (const p of positionStatus) {
    console.log(`  ${p.status.padEnd(8)}: ${p.num_positions} positions, $${(Number(p.total_usdc)/1e6).toFixed(2)}M net USDC`);
  }

  // Get redemption details
  const redemptionResult = await client.query({
    query: `
      SELECT
        token_id,
        condition_id,
        outcome_index,
        sum(token_delta) as tokens,
        sum(usdc_delta) as usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}' AND event_type = 'redemption'
      GROUP BY token_id, condition_id, outcome_index
      ORDER BY sum(usdc_delta) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionResult.json() as any[];

  console.log('\n' + '─'.repeat(60));
  console.log('Top 10 Redemptions:');
  for (const r of redemptions) {
    const tokenId = (r.token_id as string).slice(0, 15);
    const tokens = (Number(r.tokens) / 1e6).toFixed(2);
    const usdc = (Number(r.usdc) / 1e6).toFixed(2);
    console.log(`  ${tokenId}... | ${tokens}M tokens | $${usdc}M USDC`);
  }

  // Check a specific closed position to understand the flow
  console.log('\n' + '─'.repeat(60));
  console.log('Sample Closed Position Flow:');

  const sampleClosedResult = await client.query({
    query: `
      SELECT token_id, sum(token_delta) as net_tokens, sum(usdc_delta) as net_usdc
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}'
      GROUP BY token_id
      HAVING abs(sum(token_delta)) < 1
      ORDER BY abs(sum(usdc_delta)) DESC
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });
  const sampleClosed = await sampleClosedResult.json() as any[];

  if (sampleClosed.length > 0) {
    const tokenId = sampleClosed[0].token_id;
    console.log(`  Token: ${tokenId.slice(0, 20)}...`);
    console.log(`  Net tokens: ${sampleClosed[0].net_tokens}, Net USDC: ${Number(sampleClosed[0].net_usdc).toFixed(2)}`);

    // Get all events for this token
    const eventsResult = await client.query({
      query: `
        SELECT event_type, count() as cnt, sum(token_delta) as tokens, sum(usdc_delta) as usdc
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}' AND token_id = '${tokenId}'
        GROUP BY event_type
        ORDER BY event_type
      `,
      format: 'JSONEachRow'
    });
    const events = await eventsResult.json() as any[];
    console.log('  Events:');
    for (const e of events) {
      console.log(`    ${e.event_type}: ${e.cnt} events, ${Number(e.tokens).toFixed(2)} tokens, $${(Number(e.usdc)/1e6).toFixed(4)}M`);
    }
  }

  // The key question: why is net USDC negative when UI shows positive?
  console.log('\n' + '═'.repeat(60));
  console.log('KEY INSIGHT:');
  console.log('═'.repeat(60));
  console.log(`Net USDC from ledger: $${(netUsdc/1e6).toFixed(2)}M`);
  console.log('Expected UI PnL: ~$165K');
  console.log('\nPossible issues:');
  console.log('1. Redemptions are missing or incomplete');
  console.log('2. Split/merge USDC calculation is wrong');
  console.log('3. Some positions need market price valuation');

  // Check how many positions are still open (holding tokens)
  const openTokensResult = await client.query({
    query: `
      SELECT
        sum(net_tokens) as total_open_tokens,
        sum(net_cost) as total_open_cost,
        count() as num_open
      FROM (
        SELECT token_id,
          sum(token_delta) as net_tokens,
          sum(usdc_delta) as net_cost
        FROM pm_wallet_token_ledger_v1
        WHERE wallet = '${wallet}'
        GROUP BY token_id
        HAVING sum(token_delta) >= 1
      )
    `,
    format: 'JSONEachRow'
  });
  const openTokens = await openTokensResult.json() as any[];

  if (openTokens.length > 0) {
    const open = openTokens[0];
    console.log(`\nOpen Positions:`);
    console.log(`  Total tokens: ${(Number(open.total_open_tokens)/1e6).toFixed(2)}M`);
    console.log(`  Total cost: $${(Number(open.total_open_cost)/1e6).toFixed(2)}M`);
    console.log(`  Num positions: ${open.num_open}`);
    console.log(`  Avg cost per token: $${(Number(open.total_open_cost) / Number(open.total_open_tokens)).toFixed(4)}`);

    // If these tokens are worth $1 at resolution...
    const valueAt1 = Number(open.total_open_tokens);
    const unrealizedAt1 = valueAt1 + Number(open.total_open_cost);
    console.log(`\n  If open tokens all resolve to $1:`);
    console.log(`    Value: $${(valueAt1/1e6).toFixed(2)}M`);
    console.log(`    Unrealized PnL: $${(unrealizedAt1/1e6).toFixed(2)}M`);
    console.log(`    Total PnL: $${((netUsdc + unrealizedAt1)/1e6).toFixed(2)}M`);
  }

  await client.close();
}
main().catch(console.error);
