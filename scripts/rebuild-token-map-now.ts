#!/usr/bin/env tsx
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('🔄 V5 TOKEN MAP REBUILD (ADDITIVE MODE)');

  const beforeQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const beforeRows = await beforeQ.json() as any[];
  const beforeCount = parseInt(beforeRows[0]?.cnt || '0');
  console.log('Before:', beforeCount.toLocaleString(), 'tokens');

  console.log('Inserting new tokens from metadata...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_token_to_condition_map_v5
      SELECT token_id_dec, condition_id, outcome_index, question, category
      FROM (
        SELECT
          arrayJoin(arrayEnumerate(token_ids)) AS idx,
          token_ids[idx] AS token_id_dec,
          condition_id,
          toInt64(idx - 1) AS outcome_index,
          question,
          category
        FROM pm_market_metadata FINAL
        WHERE length(token_ids) > 0
      ) new_tokens
      WHERE NOT EXISTS (
        SELECT 1 FROM pm_token_to_condition_map_v5 existing
        WHERE existing.token_id_dec = new_tokens.token_id_dec
      )
    `,
  });

  const afterQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const afterRows = await afterQ.json() as any[];
  const afterCount = parseInt(afterRows[0]?.cnt || '0');
  console.log('After:', afterCount.toLocaleString(), 'tokens');
  console.log('New tokens added:', (afterCount - beforeCount).toLocaleString());
}

main().catch(e => { console.error(e); process.exit(1); });
