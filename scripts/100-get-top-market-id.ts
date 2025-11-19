#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id_norm_v3
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')
        AND condition_id_norm_v3 LIKE 'bc4a8b1cc876%'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const data = await result.json<Array<any>>();
  if (data.length > 0) {
    console.log('Full condition_id:');
    console.log(data[0].condition_id_norm_v3);
  } else {
    console.log('NOT FOUND - checking with 0x prefix...');
    const result2 = await clickhouse.query({
      query: `
        SELECT DISTINCT condition_id_norm_v3
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')
          AND condition_id_norm_v3 LIKE '0xbc4a8b1cc876%'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const data2 = await result2.json<Array<any>>();
    if (data2.length > 0) {
      console.log('Full condition_id (with 0x):');
      console.log(data2[0].condition_id_norm_v3);
    } else {
      console.log('Still NOT FOUND - showing any condition_id for this wallet:');
      const result3 = await clickhouse.query({
        query: `
          SELECT condition_id_norm_v3, count() as cnt
          FROM pm_trades_canonical_v3
          WHERE lower(wallet_address) = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')
            AND condition_id_norm_v3 != ''
          GROUP BY condition_id_norm_v3
          ORDER BY cnt DESC
          LIMIT 5
        `,
        format: 'JSONEachRow'
      });
      const data3 = await result3.json<Array<any>>();
      console.log('Top 5 condition_ids by trade count:');
      data3.forEach(d => console.log(`  ${d.condition_id_norm_v3} (${d.cnt} trades)`));
    }
  }
}

main().catch(console.error);
