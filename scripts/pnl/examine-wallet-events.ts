/**
 * Examine raw ledger events for specific wallets
 * To understand what causes V29 realized PnL inflation
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function examineWalletEvents(wallet: string, label: string) {
  console.log(`\n${'='.repeat(120)}`);
  console.log(`WALLET: ${wallet} (${label})`);
  console.log('='.repeat(120));

  // First get total count
  const countQuery = `
    SELECT count() as total
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = (await countResult.json()) as any[];
  const totalEvents = Number(countData[0]?.total || 0);

  // Get all events (no limit)
  const query = `
    SELECT
      source_type,
      condition_id,
      outcome_index,
      event_time,
      usdc_delta,
      token_delta,
      event_id
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = lower('${wallet}')
      AND condition_id IS NOT NULL
      AND condition_id != ''
    ORDER BY event_time ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const events = (await result.json()) as any[];

  console.log(`\nTotal events in ledger: ${totalEvents.toLocaleString()}`);
  console.log(`Events retrieved: ${events.length.toLocaleString()}\n`);

  // Summarize by source type
  const byType: Record<string, number> = {};
  let totalUsdcIn = 0;
  let totalUsdcOut = 0;

  for (const event of events) {
    const sourceType = event.source_type;
    byType[sourceType] = (byType[sourceType] || 0) + 1;

    const usdcDelta = Number(event.usdc_delta) || 0;
    if (usdcDelta > 0) {
      totalUsdcIn += usdcDelta;
    } else if (usdcDelta < 0) {
      totalUsdcOut += Math.abs(usdcDelta);
    }
  }

  console.log('EVENT TYPE SUMMARY:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(25)} ${count.toLocaleString().padStart(8)} events`);
  }

  const netCashFlow = totalUsdcIn - totalUsdcOut;

  console.log('\nCASH FLOW SUMMARY:');
  console.log(`  USDC Inflows:   $${totalUsdcIn.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  USDC Outflows:  $${totalUsdcOut.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Net Cash Flow:  $${netCashFlow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

  // Show first 10 and last 10 events
  console.log('\nFIRST 10 EVENTS:');
  console.log(
    'Time'.padEnd(22) +
    'Type'.padEnd(22) +
    'USDC Delta'.padEnd(15) +
    'Token Delta'.padEnd(15) +
    'Event ID (last 8)'
  );
  console.log('-'.repeat(120));

  for (let i = 0; i < Math.min(10, events.length); i++) {
    const e = events[i];
    console.log(
      new Date(e.event_time).toISOString().slice(0, 19).padEnd(22) +
      e.source_type.padEnd(22) +
      `$${Number(e.usdc_delta).toFixed(2)}`.padEnd(15) +
      `${Number(e.token_delta).toFixed(2)}`.padEnd(15) +
      e.event_id.slice(-8)
    );
  }

  if (events.length > 20) {
    console.log('  ...');
    console.log('\nLAST 10 EVENTS:');
    console.log(
      'Time'.padEnd(22) +
      'Type'.padEnd(22) +
      'USDC Delta'.padEnd(15) +
      'Token Delta'.padEnd(15) +
      'Event ID (last 8)'
    );
    console.log('-'.repeat(120));

    for (let i = Math.max(0, events.length - 10); i < events.length; i++) {
      const e = events[i];
      console.log(
        new Date(e.event_time).toISOString().slice(0, 19).padEnd(22) +
        e.source_type.padEnd(22) +
        `$${Number(e.usdc_delta).toFixed(2)}`.padEnd(15) +
        `${Number(e.token_delta).toFixed(2)}`.padEnd(15) +
        e.event_id.slice(-8)
      );
    }
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║          WALLET EVENT STREAM ANALYSIS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  // Good wallet: fully settled, 0.11% error
  await examineWalletEvents(
    '0xe9ad918c7678cd38b12603a762e638a5d1ee7091',
    'GOOD - Fully settled, 0.11% error'
  );

  // Bad wallet: huge inflation, -$18M resolved unredeemed
  await examineWalletEvents(
    '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d',
    'BAD - Massive inflation, -$18M resolved unredeemed'
  );

  console.log('\n✅ Analysis complete\n');
}

main().catch(console.error);
