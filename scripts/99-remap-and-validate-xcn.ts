#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const REAL_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const MIS_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function getXiCids(): Promise<string[]> {
  const url = `https://data-api.polymarket.com/positions?user=${REAL_WALLET}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polymarket API ${res.status}`);
  const data = (await res.json()) as any[];
  const cids = new Set<string>();
  for (const p of data) {
    const title: string = p?.title?.toLowerCase?.() || '';
    if (title.includes('xi')) {
      const cid = String(p.conditionId || p.condition_id || '').replace(/^0x/i, '').toLowerCase();
      if (cid) cids.add(cid);
    }
  }
  return [...cids];
}

async function createRemapView() {
  // view is idempotent
  const sql = `
    CREATE OR REPLACE VIEW vw_trades_canonical_v3_remap_xcn AS
    SELECT
      if(lower(wallet_address)='${MIS_WALLET}', '${REAL_WALLET}', lower(wallet_address)) AS wallet_fixed,
      lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,
      *
    FROM pm_trades_canonical_v3;
  `;
  await clickhouse.command({ query: sql });
}

async function xiLedger(cids: string[], label: string) {
  const cidList = cids.map(c => `'${c}'`).join(',');
  const sql = `
    SELECT
      wallet_fixed,
      cid_norm,
      count() AS trades,
      sumIf(usd_value, trade_direction='BUY') AS buy_cash,
      sumIf(usd_value, trade_direction='SELL') AS sell_cash,
      sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares
    FROM vw_trades_canonical_v3_remap_xcn
    WHERE cid_norm IN (${cidList})
      AND wallet_fixed IN ('${REAL_WALLET}', '${MIS_WALLET}')
    GROUP BY wallet_fixed, cid_norm
    ORDER BY wallet_fixed, cid_norm;
  `;
  const rows = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
  const parsed = rows.text()
    .then(t => t.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  console.log(`\n=== ${label} (Xi CIDs) ===`);
  for (const r of await parsed) {
    console.log(`${r.wallet_fixed}\t${r.cid_norm}\ttrades=${r.trades}\tbuy=${r.buy_cash}\tsell=${r.sell_cash}\tnet=${r.net_shares}`);
  }
}

async function collisions(label: string) {
  const sql = `
    SELECT count() AS collisions
    FROM (
      SELECT transaction_hash, countDistinct(wallet_fixed) AS w
      FROM vw_trades_canonical_v3_remap_xcn
      GROUP BY transaction_hash
      HAVING w > 1
    );`;
  const row = await clickhouse.query({ query: sql, format: 'JSONEachRow' }).then(r => r.json()[0]);
  console.log(`\n=== ${label} collisions >1 wallet per tx === ${row?.collisions}`);
}

async function main() {
  const cids = await getXiCids();
  if (cids.length === 0) throw new Error('No Xi markets in Polymarket positions');
  await createRemapView();
  await xiLedger(cids, 'Ledger after remap view');
  await collisions('Global');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
