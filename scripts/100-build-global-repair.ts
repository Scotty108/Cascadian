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
  console.log('=== Global wallet repair (memory-safe) ===');

  // 1) Per-wallet stats per tx_hash (counts + min_ts)
  await run(`
    CREATE OR REPLACE TABLE tmp_wallet_tx_stats
    ENGINE = MergeTree
    ORDER BY (transaction_hash, wallet_address) AS
    SELECT
      transaction_hash,
      lower(wallet_address) AS wallet_address,
      count() AS cnt,
      min(timestamp) AS min_ts
    FROM pm_trades_canonical_v3
    GROUP BY transaction_hash, wallet_address
  `, 'Step 1: built tmp_wallet_tx_stats');

  // 2) Repair map: pick wallet with highest cnt, tie-break earliest min_ts
  await run(`
    CREATE OR REPLACE TABLE tmp_global_repair_map
    ENGINE = MergeTree
    ORDER BY transaction_hash AS
    SELECT transaction_hash, wallet_address AS correct_wallet
    FROM (
      SELECT
        transaction_hash,
        wallet_address,
        row_number() OVER (PARTITION BY transaction_hash ORDER BY cnt DESC, min_ts ASC) AS rn
      FROM tmp_wallet_tx_stats
    )
    WHERE rn = 1
  `, 'Step 2: built tmp_global_repair_map');

  // 3) Repaired view
  await run(`
    CREATE OR REPLACE VIEW vw_trades_canonical_global_repaired AS
    SELECT
      coalesce(rm.correct_wallet, lower(t.wallet_address)) AS wallet_fixed,
      lower(replaceRegexpAll(t.condition_id_norm_v3,'^0x','')) AS cid_norm,
      t.*
    FROM pm_trades_canonical_v3 t
    LEFT JOIN tmp_global_repair_map rm USING (transaction_hash)
  `, 'Step 3: created repaired view');

  // 4) Remaining collisions (should be 0)
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

  // 5) XCN sanity
  const xcn = await clickhouse.query({
    query: `
      SELECT count() AS trades, uniqExact(cid_norm) AS markets
      FROM vw_trades_canonical_global_repaired
      WHERE wallet_fixed = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()[0]);
  console.log('XCN trades:', xcn?.trades, 'markets:', xcn?.markets);

  console.log('=== Done. Use vw_trades_canonical_global_repaired for reads ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
