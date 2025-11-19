#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface MonthlyStats {
  month: string;
  total_trades: string;
  orphans: string;
  orphan_pct: string;
  from_original?: string;
  from_twd?: string;
  from_erc1155?: string;
  from_clob?: string;
  from_unknown?: string;
}

async function profileOrphans() {
  console.log('=== V2 ORPHAN PROFILE ===\n');

  // V2 analysis
  const v2Results = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(timestamp) AS month,
        count() AS total_trades,
        countIf(
          condition_id_norm_v2 IS NULL
          OR condition_id_norm_v2 = ''
          OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS orphans,
        round(100.0 * orphans / total_trades, 2) AS orphan_pct,
        countIf(id_repair_source = 'original') AS from_original,
        countIf(id_repair_source = 'erc1155_decode') AS from_erc1155,
        countIf(id_repair_source = 'clob_decode') AS from_clob,
        countIf(id_repair_source = 'unknown') AS from_unknown
      FROM pm_trades_canonical_v2
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const v2Data = await v2Results.json<MonthlyStats[]>();

  console.log('Month    | Total Trades | Orphans    | Orphan % | Original  | ERC1155  | CLOB     | Unknown');
  console.log('---------|--------------|------------|----------|-----------|----------|----------|----------');

  v2Data.forEach(row => {
    const month = row.month;
    const total = Number(row.total_trades).toLocaleString().padEnd(12);
    const orphans = Number(row.orphans).toLocaleString().padEnd(10);
    const pct = String(row.orphan_pct).padEnd(8);
    const orig = Number(row.from_original || 0).toLocaleString().padEnd(9);
    const erc = Number(row.from_erc1155 || 0).toLocaleString().padEnd(8);
    const clob = Number(row.from_clob || 0).toLocaleString().padEnd(8);
    const unk = Number(row.from_unknown || 0).toLocaleString().padEnd(9);

    console.log(`${month} | ${total} | ${orphans} | ${pct} | ${orig} | ${erc} | ${clob} | ${unk}`);
  });

  // Calculate overall stats
  const v2TotalTrades = v2Data.reduce((sum, row) => sum + Number(row.total_trades), 0);
  const v2TotalOrphans = v2Data.reduce((sum, row) => sum + Number(row.orphans), 0);
  const v2OverallPct = ((v2TotalOrphans / v2TotalTrades) * 100).toFixed(2);

  console.log('\nV2 OVERALL STATS:');
  console.log(`Total trades: ${v2TotalTrades.toLocaleString()}`);
  console.log(`Total orphans: ${v2TotalOrphans.toLocaleString()}`);
  console.log(`Overall orphan rate: ${v2OverallPct}%`);

  console.log('\n\n=== V3 ORPHAN PROFILE ===\n');

  // V3 analysis
  const v3Results = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(timestamp) AS month,
        count() AS total_trades,
        countIf(
          condition_id_norm_v2 IS NULL
          OR condition_id_norm_v2 = ''
          OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS orphans,
        round(100.0 * orphans / total_trades, 2) AS orphan_pct,
        countIf(id_repair_source = 'original') AS from_original,
        countIf(id_repair_source = 'twd_join') AS from_twd,
        countIf(id_repair_source = 'erc1155_decode') AS from_erc1155,
        countIf(id_repair_source = 'clob_decode') AS from_clob,
        countIf(id_repair_source = 'unknown') AS from_unknown
      FROM pm_trades_canonical_v3
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const v3Data = await v3Results.json<MonthlyStats[]>();

  console.log('Month    | Total Trades | Orphans    | Orphan % | Original  | TWD      | ERC1155  | CLOB     | Unknown');
  console.log('---------|--------------|------------|----------|-----------|----------|----------|----------|----------');

  v3Data.forEach(row => {
    const month = row.month;
    const total = Number(row.total_trades).toLocaleString().padEnd(12);
    const orphans = Number(row.orphans).toLocaleString().padEnd(10);
    const pct = String(row.orphan_pct).padEnd(8);
    const orig = Number(row.from_original || 0).toLocaleString().padEnd(9);
    const twd = Number(row.from_twd || 0).toLocaleString().padEnd(8);
    const erc = Number(row.from_erc1155 || 0).toLocaleString().padEnd(8);
    const clob = Number(row.from_clob || 0).toLocaleString().padEnd(8);
    const unk = Number(row.from_unknown || 0).toLocaleString().padEnd(9);

    console.log(`${month} | ${total} | ${orphans} | ${pct} | ${orig} | ${twd} | ${erc} | ${clob} | ${unk}`);
  });

  // Calculate overall stats
  const v3TotalTrades = v3Data.reduce((sum, row) => sum + Number(row.total_trades), 0);
  const v3TotalOrphans = v3Data.reduce((sum, row) => sum + Number(row.orphans), 0);
  const v3OverallPct = ((v3TotalOrphans / v3TotalTrades) * 100).toFixed(2);

  console.log('\nV3 OVERALL STATS:');
  console.log(`Total trades: ${v3TotalTrades.toLocaleString()}`);
  console.log(`Total orphans: ${v3TotalOrphans.toLocaleString()}`);
  console.log(`Overall orphan rate: ${v3OverallPct}%`);

  console.log('\n\n=== V3 SANDBOX ORPHAN PROFILE ===\n');

  // V3 sandbox analysis
  const v3SandboxResults = await clickhouse.query({
    query: `
      SELECT
        toYYYYMM(timestamp) AS month,
        count() AS total_trades,
        countIf(
          condition_id_norm_v2 IS NULL
          OR condition_id_norm_v2 = ''
          OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000'
        ) AS orphans,
        round(100.0 * orphans / total_trades, 2) AS orphan_pct,
        countIf(id_repair_source = 'original') AS from_original,
        countIf(id_repair_source = 'erc1155_decode') AS from_erc1155,
        countIf(id_repair_source = 'clob_decode') AS from_clob,
        countIf(id_repair_source = 'unknown') AS from_unknown
      FROM pm_trades_canonical_v3_sandbox
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const v3SandboxData = await v3SandboxResults.json<MonthlyStats[]>();

  console.log('Month    | Total Trades | Orphans    | Orphan % | Original  | ERC1155  | CLOB     | Unknown');
  console.log('---------|--------------|------------|----------|-----------|----------|----------|----------');

  v3SandboxData.forEach(row => {
    const month = row.month;
    const total = Number(row.total_trades).toLocaleString().padEnd(12);
    const orphans = Number(row.orphans).toLocaleString().padEnd(10);
    const pct = String(row.orphan_pct).padEnd(8);
    const orig = Number(row.from_original || 0).toLocaleString().padEnd(9);
    const erc = Number(row.from_erc1155 || 0).toLocaleString().padEnd(8);
    const clob = Number(row.from_clob || 0).toLocaleString().padEnd(8);
    const unk = Number(row.from_unknown || 0).toLocaleString().padEnd(9);

    console.log(`${month} | ${total} | ${orphans} | ${pct} | ${orig} | ${erc} | ${clob} | ${unk}`);
  });

  // Calculate overall stats
  const v3SandboxTotalTrades = v3SandboxData.reduce((sum, row) => sum + Number(row.total_trades), 0);
  const v3SandboxTotalOrphans = v3SandboxData.reduce((sum, row) => sum + Number(row.orphans), 0);
  const v3SandboxOverallPct = ((v3SandboxTotalOrphans / v3SandboxTotalTrades) * 100).toFixed(2);

  console.log('\nV3 SANDBOX OVERALL STATS:');
  console.log(`Total trades: ${v3SandboxTotalTrades.toLocaleString()}`);
  console.log(`Total orphans: ${v3SandboxTotalOrphans.toLocaleString()}`);
  console.log(`Overall orphan rate: ${v3SandboxOverallPct}%`);

  // Find months with worst orphan rates
  console.log('\n\n=== WORST ORPHAN MONTHS (V2) ===\n');
  const worstV2 = [...v2Data]
    .filter(row => Number(row.total_trades) > 10000) // Filter out low-volume months
    .sort((a, b) => Number(b.orphan_pct) - Number(a.orphan_pct))
    .slice(0, 10);

  worstV2.forEach(row => {
    console.log(`${row.month}: ${row.orphan_pct}% orphans (${Number(row.orphans).toLocaleString()} / ${Number(row.total_trades).toLocaleString()} trades)`);
  });

  console.log('\n\n=== BEST ORPHAN MONTHS (V2) ===\n');
  const bestV2 = [...v2Data]
    .filter(row => Number(row.total_trades) > 10000)
    .sort((a, b) => Number(a.orphan_pct) - Number(b.orphan_pct))
    .slice(0, 10);

  bestV2.forEach(row => {
    console.log(`${row.month}: ${row.orphan_pct}% orphans (${Number(row.orphans).toLocaleString()} / ${Number(row.total_trades).toLocaleString()} trades)`);
  });
}

profileOrphans().catch(console.error);
