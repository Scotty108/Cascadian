import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkWinningOutcomes() {
  console.log('\n🔍 Checking winning_outcome values for wallet markets\n');
  
  const query = `
    SELECT
      gr.cid,
      gr.winning_outcome,
      count(*) as fill_count
    FROM clob_fills cf
    INNER JOIN gamma_resolved gr
      ON lower(replaceAll(cf.condition_id, '0x', '')) = gr.cid
    WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
      AND cf.condition_id != ''
    GROUP BY gr.cid, gr.winning_outcome
    ORDER BY fill_count DESC
    LIMIT 20
  `;
  
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json();
  
  console.log('Winning outcomes for this wallet\'s markets:');
  console.table(data);
  
  // Check outcome type distribution
  console.log('\n📊 Winning outcome type distribution:\n');
  const typeQuery = `
    SELECT
      gr.winning_outcome,
      count(DISTINCT gr.cid) as market_count
    FROM clob_fills cf
    INNER JOIN gamma_resolved gr
      ON lower(replaceAll(cf.condition_id, '0x', '')) = gr.cid
    WHERE lower(cf.proxy_wallet) = lower('${WALLET}')
      AND cf.condition_id != ''
    GROUP BY gr.winning_outcome
    ORDER BY market_count DESC
  `;
  
  const typeResult = await clickhouse.query({ query: typeQuery, format: 'JSONEachRow' });
  const types = await typeResult.json();
  console.table(types);
  
  const hasOnlyYesNo = types.every((t: any) => ['Yes', 'No', 'yes', 'no'].includes(t.winning_outcome));
  
  if (hasOnlyYesNo) {
    console.log('\n✅ All outcomes are Yes/No - validation logic should work');
  } else {
    console.log('\n⚠️  Markets have non-Yes/No outcomes!');
    console.log('Validation script only checks for Yes/No, needs to be updated.');
  }
}

checkWinningOutcomes().catch(console.error);
