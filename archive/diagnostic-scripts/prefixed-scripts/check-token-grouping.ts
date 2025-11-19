import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('Checking if multiple tokens per condition exist...\n');

  // Check for multiple tokens per condition
  const multiTokenQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        count() as token_count,
        groupArray(index_set_mask) as masks,
        groupArray(net_shares) as shares,
        groupArray(gross_cf) as cashflows
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY condition_id_ctf
      HAVING token_count > 1
    `,
    format: 'JSONEachRow'
  });

  const multiToken = await multiTokenQuery.json();

  console.log(`Found ${multiToken.length} conditions with multiple tokens\n`);

  if (multiToken.length > 0) {
    console.log('⚠️  PROBLEM DETECTED: Multiple tokens per condition exist!\n');
    console.log('Sample conditions with multiple tokens:');
    multiToken.slice(0, 5).forEach((m: any, i: number) => {
      console.log(`\n${i + 1}. ${m.condition_id_ctf.substring(0, 12)}...`);
      console.log(`   Token count: ${m.token_count}`);
      console.log(`   Masks: [${m.masks.join(', ')}]`);
      console.log(`   Net shares: [${m.shares.map((s: number) => s.toFixed(2)).join(', ')}]`);
      console.log(`   Cashflows: [${m.cashflows.map((c: number) => c.toFixed(2)).join(', ')}]`);
    });

    console.log('\n\n❌ DIAGNOSIS: wallet_condition_pnl is using any() on multiple tokens!');
    console.log('Current view uses: any(f.index_set_mask), any(f.net_shares), any(f.gross_cf)');
    console.log('This picks ONE arbitrary token and ignores the others!\n');
    console.log('FIX REQUIRED: Calculate payout per token BEFORE grouping by condition.\n');
  } else {
    console.log('✅ No multiple tokens per condition found.');
    console.log('The grouping issue is not the cause of the P&L gap.\n');
  }

  // Also check total token count vs condition count
  const countsQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_tokens,
        count(DISTINCT condition_id_ctf) as unique_conditions
      FROM wallet_token_flows
      WHERE lower(wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });

  const counts = await countsQuery.json();
  console.log(`\nTotal tokens: ${counts[0].total_tokens}`);
  console.log(`Unique conditions: ${counts[0].unique_conditions}`);

  if (counts[0].total_tokens > counts[0].unique_conditions) {
    console.log(`\n⚠️  Token count (${counts[0].total_tokens}) > condition count (${counts[0].unique_conditions})`);
    console.log('This confirms multiple tokens per condition exist!');
  }
}

main().catch(console.error);
