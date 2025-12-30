import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const CRONS = [
  { name: 'sync-metadata', cadenceMinutes: 10, table: 'pm_market_metadata', syncType: 'metadata_sync' },
  { name: 'sync-clob-dedup', cadenceMinutes: 30, table: 'pm_trader_events_dedup_v2_tbl', syncType: null },
  { name: 'rebuild-token-map', cadenceMinutes: 360, table: null, syncType: 'token_map_rebuild' },
];

const COLUMN_PRIORITY = [
  'last_ingest',
  'updated_at',
  'ingested_at',
  'insert_time',
  'latest_insert_time',
  'trade_time',
  'event_time',
  'event_timestamp',
  'block_timestamp',
  'timestamp',
  'created_at',
  'block_time',
  'block_date',
  'date',
  'trade_date',
  'event_date',
];

async function pickTimestampColumn(table: string) {
  const q = `
    SELECT name, type
    FROM system.columns
    WHERE database = currentDatabase()
      AND table = '${table}'
  `;
  const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const cols = (await res.json()) as Array<{ name: string; type: string }>;
  const byName = new Map(cols.map((c) => [c.name, c.type]));

  for (const name of COLUMN_PRIORITY) {
    if (byName.has(name)) return { name, type: byName.get(name)! };
  }

  // Fallback: first Date/DateTime-like column
  const fallback = cols.find((c) => /DateTime|Date/.test(c.type));
  return fallback ? { name: fallback.name, type: fallback.type } : null;
}

async function getLatestForTable(table: string) {
  const column = await pickTimestampColumn(table);
  if (!column) {
    return { table, column: null, latest: null, minutesAgo: null, source: 'none' as const };
  }

  const q = `
    SELECT
      max(${column.name}) AS latest,
      dateDiff('minute', max(${column.name}), now()) AS minutes_ago
    FROM ${table}
  `;
  const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await res.json()) as Array<{ latest: string | null; minutes_ago: number | null }>;
  const row = rows[0] || { latest: null, minutes_ago: null };
  return {
    table,
    column: column.name,
    latest: row.latest,
    minutesAgo: row.minutes_ago,
    source: 'table' as const,
  };
}

async function getSyncStatus() {
  try {
    const q = `
      SELECT
        sync_type,
        max(last_success_at) AS last_success_at,
        max(records_synced) AS records_synced,
        max(coverage_pct) AS coverage_pct,
        max(duration_ms) AS duration_ms
      FROM pm_sync_status
      GROUP BY sync_type
    `;
    const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    return (await res.json()) as Array<{
      sync_type: string;
      last_success_at: string | null;
      records_synced: number | null;
      coverage_pct: number | null;
      duration_ms: number | null;
    }>;
  } catch (err) {
    return null;
  }
}

function statusLine(name: string, cadence: number, latest: string | null, minutesAgo: number | null) {
  if (!latest || minutesAgo === null) {
    return `${name.padEnd(18)} | latest: n/a | status: UNKNOWN`;
  }
  const overdueThreshold = cadence * 2;
  const status = minutesAgo > overdueThreshold ? 'OVERDUE' : minutesAgo > cadence ? 'LATE' : 'OK';
  return `${name.padEnd(18)} | latest: ${latest} | age: ${minutesAgo}m | status: ${status}`;
}

async function getSyncStatusForType(syncType: string) {
  try {
    const q = `
      SELECT
        last_success_at,
        records_synced,
        coverage_pct,
        duration_ms
      FROM pm_sync_status
      WHERE sync_type = '${syncType}'
      ORDER BY last_success_at DESC
      LIMIT 1
    `;
    const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await res.json()) as Array<{
      last_success_at: string | null;
      records_synced: number | null;
      coverage_pct: number | null;
      duration_ms: number | null;
    }>;
    if (!rows.length) return null;
    const row = rows[0];
    // Calculate minutes ago
    if (row.last_success_at) {
      const lastSuccess = new Date(row.last_success_at + 'Z');
      const minutesAgo = Math.round((Date.now() - lastSuccess.getTime()) / 60000);
      return { ...row, minutesAgo };
    }
    return { ...row, minutesAgo: null };
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Cron Freshness Check (ClickHouse) ===');
  for (const cron of CRONS) {
    // Prefer syncType from pm_sync_status, fall back to table column check
    if (cron.syncType) {
      const syncInfo = await getSyncStatusForType(cron.syncType);
      if (syncInfo) {
        console.log(
          statusLine(
            cron.name,
            cron.cadenceMinutes,
            syncInfo.last_success_at,
            syncInfo.minutesAgo
          ) + ` | source: pm_sync_status.${cron.syncType} | coverage: ${syncInfo.coverage_pct ?? 'n/a'}%`
        );
        continue;
      }
    }

    // Fall back to table-based check
    if (cron.table) {
      const info = await getLatestForTable(cron.table);
      console.log(
        statusLine(
          cron.name,
          cron.cadenceMinutes,
          info.latest,
          info.minutesAgo
        ) + ` | table: ${cron.table} | column: ${info.column ?? 'n/a'}`
      );
    } else {
      console.log(
        statusLine(
          cron.name,
          cron.cadenceMinutes,
          null,
          null
        ) + ' | source: none configured'
      );
    }
  }

  const syncStatus = await getSyncStatus();
  if (syncStatus) {
    console.log('\n=== pm_sync_status (all entries) ===');
    for (const row of syncStatus) {
      console.log(
        `${row.sync_type.padEnd(18)} | last_success_at: ${row.last_success_at ?? 'n/a'} | records: ${row.records_synced ?? 'n/a'} | coverage: ${row.coverage_pct ?? 'n/a'}% | duration_ms: ${row.duration_ms ?? 'n/a'}`
      );
    }
  } else {
    console.log('\n=== pm_sync_status ===');
    console.log('No pm_sync_status table or not accessible.');
  }
}

main().catch((err) => {
  console.error('ERROR:', err?.message || err);
  process.exit(1);
});
