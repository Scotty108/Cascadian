/**
 * Monitor pm_user_positions_v2 backfill with proper tracking
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface Sample {
  time: Date;
  rows: number;
  users: number;
}

const samples: Sample[] = [];

async function getSample(): Promise<Sample> {
  const result = await clickhouse.query({
    query: `SELECT count() as cnt, uniqExact(user) as users FROM pm_user_positions_v2`,
    format: 'JSONEachRow',
  });
  const row = (await result.json())[0] as any;
  return {
    time: new Date(),
    rows: Number(row.cnt),
    users: Number(row.users),
  };
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('PM_USER_POSITIONS_V2 BACKFILL MONITOR');
  console.log('Tracking row count over time to understand ingestion pattern');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const startTime = new Date();
  console.log(`Started: ${startTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}\n`);

  console.log('Time (PST)          | Rows          | Δ Rows   | Users     | Δ Users');
  console.log('-'.repeat(75));

  // Take samples every 10 seconds for 5 minutes
  for (let i = 0; i < 30; i++) {
    const sample = await getSample();
    samples.push(sample);

    const timeStr = sample.time.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' });
    const rowsStr = sample.rows.toLocaleString().padStart(12);

    let deltaRows = '';
    let deltaUsers = '';
    if (samples.length > 1) {
      const prev = samples[samples.length - 2];
      const rowDiff = sample.rows - prev.rows;
      const userDiff = sample.users - prev.users;
      deltaRows = (rowDiff >= 0 ? '+' : '') + rowDiff.toLocaleString();
      deltaUsers = (userDiff >= 0 ? '+' : '') + userDiff.toLocaleString();
    }

    console.log(
      `${timeStr.padEnd(18)} | ${rowsStr} | ${deltaRows.padStart(8)} | ${sample.users.toLocaleString().padStart(9)} | ${deltaUsers.padStart(7)}`
    );

    if (i < 29) {
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const first = samples[0];
  const last = samples[samples.length - 1];
  const totalDelta = last.rows - first.rows;
  const totalSeconds = (last.time.getTime() - first.time.getTime()) / 1000;

  console.log(`First sample:  ${first.rows.toLocaleString()} rows`);
  console.log(`Last sample:   ${last.rows.toLocaleString()} rows`);
  console.log(`Net change:    ${totalDelta >= 0 ? '+' : ''}${totalDelta.toLocaleString()} rows over ${totalSeconds}s`);
  console.log(`Avg rate:      ${(totalDelta / totalSeconds).toFixed(1)} rows/sec`);

  // Check for fluctuation pattern
  let increases = 0;
  let decreases = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].rows > samples[i - 1].rows) increases++;
    if (samples[i].rows < samples[i - 1].rows) decreases++;
  }

  console.log(`\nFluctuation pattern:`);
  console.log(`  Increases: ${increases} intervals`);
  console.log(`  Decreases: ${decreases} intervals`);
  console.log(`  Stable:    ${samples.length - 1 - increases - decreases} intervals`);

  if (decreases > 0) {
    console.log(`\n⚠️  Row count DECREASED ${decreases} times!`);
    console.log(`   This is due to ReplacingMergeTree background merges.`);
    console.log(`   The table is deduplicating rows as it ingests.`);
    console.log(`   This is NORMAL behavior - positions are being updated, not duplicated.`);
  }

  // Check table engine
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('TABLE ENGINE CHECK');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const engineResult = await clickhouse.query({
    query: `SELECT engine, engine_full FROM system.tables WHERE name = 'pm_user_positions_v2'`,
    format: 'JSONEachRow',
  });
  const engineRow = (await engineResult.json())[0] as any;
  console.log(`Engine: ${engineRow?.engine || 'Unknown'}`);
  console.log(`Full:   ${engineRow?.engine_full || 'Unknown'}`);

  if (engineRow?.engine?.includes('Replacing') || engineRow?.engine_full?.includes('Replacing')) {
    console.log(`\n✅ This is a ReplacingMergeTree table.`);
    console.log(`   Rows are DEDUPLICATED by primary key during background merges.`);
    console.log(`   Each (user, token_id) pair will have only ONE row (latest state).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
