import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function checkEventStructure() {
  const wallet = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';

  // Get 3 maker events and 3 taker events for @Latina
  const sampleQuery = `
    (SELECT event_id, role
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND role = 'maker'
    GROUP BY event_id, role
    LIMIT 3)
    UNION ALL
    (SELECT event_id, role
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
      AND role = 'taker'
    GROUP BY event_id, role
    LIMIT 3)
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleRows = (await sampleResult.json()) as any[];

  console.log('=== Sample event_ids from @Latina ===');
  for (const r of sampleRows) {
    console.log(`${r.role}: ${r.event_id.slice(0, 50)}...`);
  }

  // Now check if these same event_ids have the OTHER party's row
  const eventIds = sampleRows.map(r => `'${r.event_id}'`).join(',');

  const fullQuery = `
    SELECT
      event_id,
      trader_wallet,
      role,
      side,
      usdc_amount / 1e6 as usdc,
      token_amount / 1e6 as tokens
    FROM pm_trader_events_v2
    WHERE event_id IN (${eventIds})
      AND is_deleted = 0
    ORDER BY event_id, role
  `;

  const fullResult = await clickhouse.query({ query: fullQuery, format: 'JSONEachRow' });
  const fullRows = (await fullResult.json()) as any[];

  console.log('\n=== Full rows for these events (all wallets) ===');
  let currentEvent = '';
  for (const r of fullRows) {
    if (r.event_id !== currentEvent) {
      console.log(`\nEvent: ...${r.event_id.slice(-40)}`);
      currentEvent = r.event_id;
    }
    const isLatina = r.trader_wallet.toLowerCase() === wallet.toLowerCase();
    const marker = isLatina ? '<- @Latina' : '';
    console.log(`  ${r.role.padEnd(6)} | ${r.side.padEnd(4)} | $${r.usdc.toFixed(2).padStart(10)} | ...${r.trader_wallet.slice(-8)} ${marker}`);
  }
}

checkEventStructure().catch(console.error);
