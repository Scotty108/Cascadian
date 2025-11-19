#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function run(query: string, label?: string) {
  if (label) console.log(label);
  await clickhouse.command({ query });
}

async function main() {
  console.log('=== Complete repair steps (view + checks) ===');

  await run(`
    CREATE OR REPLACE VIEW vw_trades_canonical_global_repaired AS
    SELECT
      coalesce(rm.correct_wallet, lower(t.wallet_address)) AS wallet_fixed,
      lower(replaceRegexpAll(t.condition_id_norm_v3,'^0x','')) AS cid_norm,
      t.*
    FROM pm_trades_canonical_v3 t
    LEFT JOIN tmp_global_repair_map rm USING (transaction_hash)
  `, 'View created');

  const coll = await clickhouse.query({
    query: `
      SELECT count() AS collisions
      FROM (
        SELECT transaction_hash, countDistinct(wallet_fixed) AS w
        FROM vw_trades_canonical_global_repaired
        GROUP BY transaction_hash
        HAVING w > 1
      )
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()[0]);
  console.log('Remaining collisions:', coll?.collisions ?? 'unknown');

  const xcn = await clickhouse.query({
    query: `
      SELECT count() AS trades, uniqExact(cid_norm) AS markets
      FROM vw_trades_canonical_global_repaired
      WHERE wallet_fixed = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()[0]);
  console.log('XCN trades:', xcn?.trades, 'markets:', xcn?.markets);

  console.log('=== Done ===');
}

main().catch(err => { console.error(err); process.exit(1); });
