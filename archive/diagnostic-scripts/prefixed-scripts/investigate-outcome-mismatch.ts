import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  // Pick the top market
  const conditionId = 'a0811c97f529';

  console.log('Investigating market:', conditionId);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get resolution info
  console.log('1. Market resolution info:');
  const resQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        payout_numerators,
        payout_denominator,
        outcome_count,
        winning_outcome
      FROM market_resolutions_final
      WHERE startsWith(condition_id_norm, '${conditionId}')
    `,
    format: 'JSONEachRow'
  });
  const res = await resQuery.json();
  if (res.length > 0) {
    console.log('   condition_id:', res[0].condition_id_norm);
    console.log('   winning_index:', res[0].winning_index);
    console.log('   winning_outcome:', res[0].winning_outcome);
    console.log('   outcome_count:', res[0].outcome_count);
    console.log('   payout_numerators:', res[0].payout_numerators);
    console.log('   payout_denominator:', res[0].payout_denominator);
  }

  console.log('\n2. Wallet position for this market:');
  const posQuery = await clickhouse.query({
    query: `
      SELECT
        wallet,
        outcome_idx,
        net_shares,
        cashflow
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
        AND startsWith(condition_id_norm, '${conditionId}')
    `,
    format: 'JSONEachRow'
  });
  const pos = await posQuery.json();
  console.log('   outcome_idx:', pos[0]?.outcome_idx);
  console.log('   net_shares:', pos[0]?.net_shares);
  console.log('   cashflow:', pos[0]?.cashflow);

  console.log('\n3. Checking token mapping for this market:');
  const tokenQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        ctm.token_id,
        ctm.condition_id_norm,
        ctm.outcome_index
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(replaceAll(cf.condition_id, '0x', '')) LIKE '${conditionId}%'
        AND lower(cf.proxy_wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const tokens = await tokenQuery.json();
  console.log('   Sample tokens:');
  tokens.forEach((t: any) => {
    console.log(`     - token: ${t.token_id.substring(0, 20)}...`);
    console.log(`       condition_id: ${t.condition_id_norm.substring(0, 20)}...`);
    console.log(`       outcome_index: ${t.outcome_index}`);
  });

  console.log('\n4. Checking if condition_ids match:');
  console.log('   Market condition_id:', res[0]?.condition_id_norm.substring(0, 32) + '...');
  console.log('   Token condition_id:', tokens[0]?.condition_id_norm.substring(0, 32) + '...');
  console.log('   Match:', res[0]?.condition_id_norm === tokens[0]?.condition_id_norm ? 'YES ✓' : 'NO ✗');

  console.log('\n5. Understanding the mismatch:');
  console.log('   Market winning_index:', res[0]?.winning_index, '(from market_resolutions_final)');
  console.log('   Wallet outcome_idx:', pos[0]?.outcome_idx, '(from ERC-1155 decoding)');
  console.log('   These should match if wallet won, but they don\'t');
  console.log('\n   Hypothesis: The token\'s condition_id might be different from market\'s condition_id');
  console.log('   OR: The outcome_index encoding scheme is different');
}

main().catch(console.error);
