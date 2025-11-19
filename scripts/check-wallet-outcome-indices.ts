import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkWalletOutcomes() {
  console.log('\n🔍 Checking wallet outcome_idx values vs winning outcomes\n');
  
  const query = `
    WITH positions_with_outcome AS (
      SELECT
        lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
        ctm.outcome_index AS outcome_idx,
        sum(if(cf.side = 'BUY', 1., -1.) * cf.size) AS net_shares
      FROM clob_fills cf
      INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
      WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
        AND cf.condition_id != ''
      GROUP BY condition_id_norm, outcome_idx
      HAVING abs(net_shares) > 0.0001
    )
    SELECT
      p.condition_id_norm,
      p.outcome_idx,
      p.net_shares,
      gr.winning_outcome,
      CASE
        WHEN (p.outcome_idx = 1 AND lower(gr.winning_outcome) = 'yes') OR
             (p.outcome_idx = 0 AND lower(gr.winning_outcome) = 'no') THEN
          'WIN'
        ELSE
          'LOSS'
      END AS result
    FROM positions_with_outcome p
    LEFT JOIN gamma_resolved gr ON p.condition_id_norm = gr.cid
    WHERE gr.cid IS NOT NULL
    ORDER BY abs(p.net_shares) DESC
    LIMIT 20
  `;
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  console.log('Wallet positions with outcome_idx and win/loss classification:');
  console.table(data);
  
  // Count wins vs losses
  const winCount = data.filter((r: any) => r.result === 'WIN').length;
  const lossCount = data.filter((r: any) => r.result === 'LOSS').length;
  
  console.log(`\n📊 Win/Loss breakdown:`);
  console.log(`  Wins:   ${winCount} positions`);
  console.log(`  Losses: ${lossCount} positions`);
  
  if (winCount === 0) {
    console.log('\n❌ 0 wins found! This matches validation output.');
    console.log('\nChecking if outcome_idx mapping is wrong...');
    
    // Check what outcomes correspond to each outcome_idx
    const outcomeCheckQuery = `
      SELECT
        ctm.outcome_index,
        gm.outcome,
        count(*) as token_count
      FROM ctf_token_map ctm
      INNER JOIN gamma_markets gm ON ctm.token_id = gm.token_id
      GROUP BY ctm.outcome_index, gm.outcome
      ORDER BY outcome_index, token_count DESC
    `;
    
    const outcomeCheckResult = await clickhouse.query({ query: outcomeCheckQuery, format: 'JSONEachRow' });
    const outcomeCheck = await outcomeCheckResult.json();
    
    console.log('\n📋 Outcome mapping (outcome_index → outcome name):');
    console.table(outcomeCheck);
  }
}

checkWalletOutcomes().catch(console.error);
