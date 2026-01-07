import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

type Row = {
  database: string;
  table: string;
  name: string;
  type: string;
};

const USER_PATTERNS = [
  'user',
  'wallet',
  'account',
  'eoa',
  'owner',
  'trader',
  'maker',
  'taker',
  'beneficiary',
  'stakeholder',
  'redeemer',
  'recipient',
  'sender',
];

const PROXY_PATTERNS = [
  'proxy',
  'executor',
  'operator',
  'relayer',
  'router',
  'forwarder',
  'delegate',
  'caller',
  'origin',
  'signer',
  'auth',
  'agent',
];

const TRANSFER_PATTERNS = ['from', 'to', 'sender', 'recipient'];

const TABLE_NAME_PATTERNS = [
  'canonical',
  'identity',
  'map',
  'proxy',
  'wallet',
  'delegate',
  'relayer',
  'router',
  'forwarder',
  'agent',
  'executor',
  'operator',
];

function matchesAny(name: string, patterns: string[]): boolean {
  const n = name.toLowerCase();
  return patterns.some((p) => n.includes(p));
}

function classify(name: string): 'user' | 'proxy' | 'transfer' | 'other' {
  const n = name.toLowerCase();
  if (matchesAny(n, PROXY_PATTERNS)) return 'proxy';
  if (matchesAny(n, USER_PATTERNS)) return 'user';
  if (matchesAny(n, TRANSFER_PATTERNS)) return 'transfer';
  return 'other';
}

async function main() {
  const orCols = [...new Set([...USER_PATTERNS, ...PROXY_PATTERNS, ...TRANSFER_PATTERNS])]
    .map((p) => `lower(name) LIKE '%${p}%'`)
    .join(' OR ');

  const colQuery = `
    SELECT database, table, name, type
    FROM system.columns
    WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      AND (${orCols})
    ORDER BY database, table, name
  `;

  const colRes = await clickhouse.query({ query: colQuery, format: 'JSONEachRow' });
  const rows = (await colRes.json()) as Row[];

  const byTable = new Map<
    string,
    { database: string; table: string; cols: Row[]; proxy: number; user: number; transfer: number }
  >();

  for (const r of rows) {
    const key = `${r.database}.${r.table}`;
    if (!byTable.has(key)) {
      byTable.set(key, { database: r.database, table: r.table, cols: [], proxy: 0, user: 0, transfer: 0 });
    }
    const entry = byTable.get(key)!;
    entry.cols.push(r);
    const c = classify(r.name);
    if (c === 'proxy') entry.proxy += 1;
    else if (c === 'user') entry.user += 1;
    else if (c === 'transfer') entry.transfer += 1;
  }

  const candidates = [...byTable.values()]
    .filter((t) => t.proxy > 0 && t.user > 0)
    .sort((a, b) => b.proxy + b.user - (a.proxy + a.user));

  console.log('=== Candidate tables with BOTH proxy-like and user-like columns ===');
  if (candidates.length === 0) {
    console.log('  (none found)');
  } else {
    for (const c of candidates.slice(0, 50)) {
      const cols = c.cols.map((r) => r.name).join(', ');
      console.log(`- ${c.database}.${c.table} | user=${c.user} proxy=${c.proxy} transfer=${c.transfer}`);
      console.log(`  cols: ${cols}`);
    }
  }

  const tableNameOr = TABLE_NAME_PATTERNS.map((p) => `lower(name) LIKE '%${p}%'`).join(' OR ');
  const tblQuery = `
    SELECT database, name
    FROM system.tables
    WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
      AND (${tableNameOr})
    ORDER BY database, name
  `;
  const tblRes = await clickhouse.query({ query: tblQuery, format: 'JSONEachRow' });
  const tblRows = (await tblRes.json()) as { database: string; name: string }[];

  console.log('\n=== Tables with proxy/identity/canonical/map in name ===');
  if (tblRows.length === 0) {
    console.log('  (none found)');
  } else {
    for (const t of tblRows) {
      console.log(`- ${t.database}.${t.name}`);
    }
  }

  const directCandidates = ['wallet_identity_map', 'pm_trader_fills_canonical_v1'];
  for (const t of directCandidates) {
    const checkQ = `
      SELECT count() AS cnt
      FROM system.tables
      WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA')
        AND name = '${t}'
    `;
    const r = await clickhouse.query({ query: checkQ, format: 'JSONEachRow' });
    const d = (await r.json()) as any[];
    const cnt = Number(d[0]?.cnt || 0);
    console.log(`\nTable ${t}: ${cnt > 0 ? 'FOUND' : 'NOT FOUND'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
