/**
 * Wallet Event Inspector
 *
 * Dumps the full event stream for a wallet from pm_unified_ledger_v8_tbl.
 * Use this to understand the trading activity and identify patterns.
 *
 * Usage:
 *   npx tsx scripts/pnl/wallet-event-inspector.ts <wallet_address>
 *   npx tsx scripts/pnl/wallet-event-inspector.ts --known    # runs for 4 known wallets
 *
 * Example:
 *   npx tsx scripts/pnl/wallet-event-inspector.ts 0x7fb7ad0d...
 */

import { clickhouse } from '../../lib/clickhouse/client';

// Known wallets from manual autopsy
const KNOWN_WALLETS = [
  { address: '0x7fb7ad0d08fd29ab8a0562fefd1e1d4ae6de4034', label: 'BAD - huge error, many redemptions, no splits' },
  { address: '0x82a1b239a08ab879eb34b7a03e9b59e6cf08ea0d', label: 'GOOD - V29 basically correct' },
  { address: '0x343d44668ab68c2e7c7ab02d2fc7b2cba26f8e49', label: 'MEDIUM - medium error' },
  { address: '0xee00ba333f1e4f0851e4f18c1d26c70d91b4d90d', label: 'MAKER - many splits/merges' },
];

interface LedgerEvent {
  source_type: string;
  wallet_address: string;
  condition_id: string;
  outcome_index: number;
  event_time: string;
  event_id: string;
  usdc_delta: number;
  token_delta: number;
  payout_norm: number | null;
}

async function inspectWallet(wallet: string, label?: string): Promise<void> {
  const displayLabel = label ? ` (${label})` : '';
  console.log('');
  console.log('='.repeat(100));
  console.log(`WALLET EVENT INSPECTOR: ${wallet}${displayLabel}`);
  console.log('='.repeat(100));

  // Query all events for wallet
  const query = `
    SELECT
      source_type,
      wallet_address,
      condition_id,
      outcome_index,
      event_time,
      event_id,
      usdc_delta,
      token_delta,
      payout_norm
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
    ORDER BY event_time ASC, event_id ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const events = (await result.json()) as LedgerEvent[];

  // Total count
  console.log(`\nTotal events: ${events.length}`);

  if (events.length === 0) {
    console.log('No events found for this wallet.');
    return;
  }

  // Counts by source_type
  const sourceTypeCounts = new Map<string, number>();
  for (const e of events) {
    sourceTypeCounts.set(e.source_type, (sourceTypeCounts.get(e.source_type) || 0) + 1);
  }

  console.log('\nEvents by source_type:');
  console.log('-'.repeat(40));
  for (const [type, count] of Array.from(sourceTypeCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(20)} : ${count.toLocaleString()}`);
  }

  // Unique conditions
  const uniqueConditions = new Set(events.map((e) => e.condition_id));
  console.log(`\nUnique conditions: ${uniqueConditions.size}`);

  // Time range
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  console.log(`\nTime range:`);
  console.log(`  First event: ${firstEvent.event_time}`);
  console.log(`  Last event:  ${lastEvent.event_time}`);

  // USDC totals by source type
  console.log('\nUSDC flow by source_type:');
  console.log('-'.repeat(60));
  const usdcBySource = new Map<string, { in: number; out: number }>();
  for (const e of events) {
    const entry = usdcBySource.get(e.source_type) || { in: 0, out: 0 };
    if (e.usdc_delta > 0) {
      entry.in += e.usdc_delta;
    } else {
      entry.out += Math.abs(e.usdc_delta);
    }
    usdcBySource.set(e.source_type, entry);
  }

  for (const [type, flow] of Array.from(usdcBySource.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${type.padEnd(20)} : IN $${flow.in.toFixed(2).padStart(14)} | OUT $${flow.out.toFixed(2).padStart(14)} | NET $${(flow.in - flow.out).toFixed(2).padStart(14)}`
    );
  }

  // Token totals by source type
  console.log('\nToken flow by source_type:');
  console.log('-'.repeat(60));
  const tokenBySource = new Map<string, { in: number; out: number }>();
  for (const e of events) {
    const entry = tokenBySource.get(e.source_type) || { in: 0, out: 0 };
    if (e.token_delta > 0) {
      entry.in += e.token_delta;
    } else {
      entry.out += Math.abs(e.token_delta);
    }
    tokenBySource.set(e.source_type, entry);
  }

  for (const [type, flow] of Array.from(tokenBySource.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${type.padEnd(20)} : IN ${flow.in.toFixed(2).padStart(14)} | OUT ${flow.out.toFixed(2).padStart(14)} | NET ${(flow.in - flow.out).toFixed(2).padStart(14)}`
    );
  }

  // First 5 events
  console.log('\nFirst 5 events:');
  console.log('-'.repeat(120));
  console.log('Time                | Source              | Outcome | USDC Delta       | Token Delta      | Condition (first 12)');
  console.log('-'.repeat(120));
  for (const e of events.slice(0, 5)) {
    const condShort = e.condition_id.substring(0, 12);
    console.log(
      `${e.event_time} | ${e.source_type.padEnd(18)} | ${String(e.outcome_index).padStart(7)} | $${e.usdc_delta.toFixed(2).padStart(14)} | ${e.token_delta.toFixed(2).padStart(15)} | ${condShort}...`
    );
  }

  // Last 5 events
  console.log('\nLast 5 events:');
  console.log('-'.repeat(120));
  console.log('Time                | Source              | Outcome | USDC Delta       | Token Delta      | Condition (first 12)');
  console.log('-'.repeat(120));
  for (const e of events.slice(-5)) {
    const condShort = e.condition_id.substring(0, 12);
    console.log(
      `${e.event_time} | ${e.source_type.padEnd(18)} | ${String(e.outcome_index).padStart(7)} | $${e.usdc_delta.toFixed(2).padStart(14)} | ${e.token_delta.toFixed(2).padStart(15)} | ${condShort}...`
    );
  }

  // Redemption events sample (if any)
  const redemptions = events.filter((e) => e.source_type === 'PayoutRedemption');
  if (redemptions.length > 0) {
    console.log(`\nPayoutRedemption events (${redemptions.length} total, showing up to 10):`);
    console.log('-'.repeat(120));
    console.log('Time                | Payout Norm | USDC Delta       | Token Delta      | Condition (first 12)');
    console.log('-'.repeat(120));
    for (const e of redemptions.slice(0, 10)) {
      const condShort = e.condition_id.substring(0, 12);
      const payoutStr = e.payout_norm !== null ? e.payout_norm.toFixed(4) : 'null';
      console.log(
        `${e.event_time} | ${payoutStr.padStart(11)} | $${e.usdc_delta.toFixed(2).padStart(14)} | ${e.token_delta.toFixed(2).padStart(15)} | ${condShort}...`
      );
    }
  }

  // Split events sample (if any)
  const splits = events.filter((e) => e.source_type === 'PositionSplit');
  if (splits.length > 0) {
    console.log(`\nPositionSplit events (${splits.length} total, showing up to 5):`);
    console.log('-'.repeat(100));
    for (const e of splits.slice(0, 5)) {
      const condShort = e.condition_id.substring(0, 12);
      console.log(
        `${e.event_time} | outcome=${e.outcome_index} | tokens=${e.token_delta.toFixed(2)} | usdc=${e.usdc_delta.toFixed(2)} | ${condShort}...`
      );
    }
  }

  // Merge events sample (if any)
  const merges = events.filter((e) => e.source_type === 'PositionsMerge');
  if (merges.length > 0) {
    console.log(`\nPositionsMerge events (${merges.length} total, showing up to 5):`);
    console.log('-'.repeat(100));
    for (const e of merges.slice(0, 5)) {
      const condShort = e.condition_id.substring(0, 12);
      console.log(
        `${e.event_time} | outcome=${e.outcome_index} | tokens=${e.token_delta.toFixed(2)} | usdc=${e.usdc_delta.toFixed(2)} | ${condShort}...`
      );
    }
  }

  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx scripts/pnl/wallet-event-inspector.ts <wallet_address>');
    console.log('  npx tsx scripts/pnl/wallet-event-inspector.ts --known');
    console.log('');
    console.log('Known wallets:');
    for (const w of KNOWN_WALLETS) {
      console.log(`  ${w.address.substring(0, 14)}... - ${w.label}`);
    }
    process.exit(0);
  }

  if (args[0] === '--known') {
    // Inspect all known wallets
    for (const w of KNOWN_WALLETS) {
      await inspectWallet(w.address, w.label);
    }
  } else {
    // Inspect single wallet
    await inspectWallet(args[0]);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('INSPECTION COMPLETE');
  console.log('='.repeat(100));
}

main().catch(console.error);
