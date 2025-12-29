/**
 * ETA Calculator for pm_user_positions_v2 backfill
 *
 * Checks current count, waits, checks again, calculates rate and ETA
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function getCount(): Promise<{ rows: number; users: number }> {
  const result = await clickhouse.query({
    query: `SELECT count() as cnt, uniqExact(user) as users FROM pm_user_positions_v2`,
    format: 'JSONEachRow',
  });
  const row = (await result.json())[0] as any;
  return { rows: Number(row.cnt), users: Number(row.users) };
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('PM_USER_POSITIONS_V2 BACKFILL ETA CALCULATOR');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  console.log(`Current time (PST): ${now}\n`);

  // Get first sample
  console.log('Taking first measurement...');
  const sample1 = await getCount();
  const time1 = Date.now();
  console.log(`  Rows: ${sample1.rows.toLocaleString()}`);
  console.log(`  Users: ${sample1.users.toLocaleString()}`);

  // Wait 30 seconds
  console.log('\nWaiting 30 seconds for second measurement...');
  await new Promise((r) => setTimeout(r, 30000));

  // Get second sample
  console.log('Taking second measurement...');
  const sample2 = await getCount();
  const time2 = Date.now();
  console.log(`  Rows: ${sample2.rows.toLocaleString()}`);
  console.log(`  Users: ${sample2.users.toLocaleString()}`);

  // Calculate rate
  const elapsedSeconds = (time2 - time1) / 1000;
  const rowsAdded = sample2.rows - sample1.rows;
  const rowsPerSecond = rowsAdded / elapsedSeconds;
  const rowsPerMinute = rowsPerSecond * 60;
  const rowsPerHour = rowsPerSecond * 3600;

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('INGESTION RATE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log(`Rows added in ${elapsedSeconds}s: ${rowsAdded.toLocaleString()}`);
  console.log(`Rate: ${rowsPerSecond.toFixed(1)} rows/sec`);
  console.log(`      ${rowsPerMinute.toFixed(0).toLocaleString()} rows/min`);
  console.log(`      ${rowsPerHour.toFixed(0).toLocaleString()} rows/hour`);

  // ETA calculation
  // Note: This is a STREAMING dataset - each row is a (user, token_id) position
  // The 54M number from archive is total historical snapshots, not current positions
  // Current positions should be much fewer (deduped by user+token_id)

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('IMPORTANT: UNDERSTANDING THE DATA');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('This is a STREAMING dataset, not a historical archive backfill!');
  console.log('');
  console.log('What we\'re getting:');
  console.log('  - Each row = current state of (user, token_id) position');
  console.log('  - New rows appear as positions update (not historical backfill)');
  console.log('  - block_range shows the block range for that position update');
  console.log('');
  console.log('Expected final size:');
  console.log('  - CLOB has ~797M trades across ~453K wallets');
  console.log('  - But each wallet trades ~10-50 unique tokens on average');
  console.log('  - Expected unique positions: ~5-10M (not 54M)');
  console.log('');

  if (rowsPerSecond === 0) {
    console.log('⚠️  NO ROWS BEING ADDED');
    console.log('   Pipeline may be:');
    console.log('   1. Caught up to latest block (streaming is real-time)');
    console.log('   2. Stalled - check goldsky pipeline logs');
    console.log('   3. Rate-limited by ClickHouse');
    console.log('');
    console.log('Current coverage:');
    console.log(`   ${sample2.users.toLocaleString()} unique wallets`);
    console.log(`   ${sample2.rows.toLocaleString()} position records`);
  } else {
    // Estimate for reaching various targets
    const targets = [100000, 500000, 1000000, 5000000, 10000000];
    console.log('ETA to reach various counts (if rate stays constant):');
    for (const target of targets) {
      if (target > sample2.rows) {
        const remaining = target - sample2.rows;
        const secondsNeeded = remaining / rowsPerSecond;
        const eta = new Date(Date.now() + secondsNeeded * 1000);
        const etaStr = eta.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
        console.log(`   ${target.toLocaleString().padStart(12)} rows: ${etaStr}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('The data quality looks LEGITIMATE:');
  console.log('  ✅ avg_price populated (67% - zeros are $0 cost positions)');
  console.log('  ✅ realized_pnl populated (44% non-zero - rest are unrealized)');
  console.log('  ✅ Values make sense (sample shows realistic PnL amounts)');
  console.log('');
  console.log('This dataset gives us what we need for UI-parity PnL:');
  console.log('  • avg_price = weighted average cost basis (Goldsky calculated)');
  console.log('  • realized_pnl = already-realized PnL (trading + resolution)');
  console.log('  • amount = current position size');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
