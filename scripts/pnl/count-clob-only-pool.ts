/**
 * Count CLOB-Only Pool Size
 *
 * Fast ClickHouse query to estimate the size of the CLOB-only wallet pool
 * at various thresholds.
 *
 * Uses openPositionsApprox computed from sum(token_delta) per condition.
 *
 * Usage: npx tsx scripts/pnl/count-clob-only-pool.ts
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Counting CLOB-Only Pool Size ===\n');

  const countQuery = `
    WITH
      per_condition AS (
        SELECT
          wallet_address as wallet,
          condition_id,
          sum(token_delta) AS net_tokens,
          countIf(source_type = 'CLOB') AS clob_events,
          countIf(source_type IN ('PositionSplit','PositionsMerge')) AS ctf_events
        FROM pm_unified_ledger_v8_tbl
        GROUP BY wallet_address, condition_id
      ),
      per_wallet AS (
        SELECT
          wallet,
          countIf(net_tokens > 0) AS openPositionsApprox,
          sum(clob_events) AS clobEvents,
          sum(ctf_events) AS ctfEvents
        FROM per_condition
        GROUP BY wallet
      )
    SELECT
      count() AS wallets_total,
      countIf(ctfEvents = 0 AND clobEvents > 0) AS clob_only_all,
      countIf(ctfEvents = 0 AND clobEvents > 0 AND openPositionsApprox <= 50) AS clob_only_le_50,
      countIf(ctfEvents = 0 AND clobEvents > 0 AND openPositionsApprox <= 50 AND clobEvents >= 10) AS clob_only_le_50_ge_10_trades,
      countIf(ctfEvents = 0 AND clobEvents > 0 AND openPositionsApprox <= 50 AND clobEvents >= 20) AS clob_only_le_50_ge_20_trades
    FROM per_wallet
  `;

  console.log('Running count query on pm_unified_ledger_v8_tbl...');
  const start = Date.now();

  const result = await clickhouse.query({
    query: countQuery,
    format: 'JSONEachRow',
  });

  interface CountRow {
    wallets_total: string;
    clob_only_all: string;
    clob_only_le_50: string;
    clob_only_le_50_ge_10_trades: string;
    clob_only_le_50_ge_20_trades: string;
  }

  const rows: CountRow[] = await result.json();
  const elapsed = Date.now() - start;

  console.log(`Query completed in ${(elapsed/1000).toFixed(1)}s\n`);

  if (rows.length > 0) {
    const r = rows[0];
    console.log('=== Pool Size Results ===\n');
    console.log(`Total wallets in ledger:           ${Number(r.wallets_total).toLocaleString()}`);
    console.log(`CLOB-only (any positions):         ${Number(r.clob_only_all).toLocaleString()}`);
    console.log(`CLOB-only + <=50 positions:        ${Number(r.clob_only_le_50).toLocaleString()}`);
    console.log(`CLOB-only + <=50 + >=10 trades:    ${Number(r.clob_only_le_50_ge_10_trades).toLocaleString()}`);
    console.log(`CLOB-only + <=50 + >=20 trades:    ${Number(r.clob_only_le_50_ge_20_trades).toLocaleString()}`);

    const pct = (Number(r.clob_only_le_50) / Number(r.wallets_total) * 100).toFixed(1);
    console.log(`\nCLOB-only <=50 as % of total:      ${pct}%`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
