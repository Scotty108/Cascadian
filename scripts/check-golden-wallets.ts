import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  const wallets = [
    '0x6e95019d16cdc3e49c0c66c5c5b8bd4b3a541218',
    '0x2b2866a724e7f9a66d3e5aa9e3dd855c00a0d021',
    '0xa40d0f1a3937be23c9697c19a64ad0dc9b62e4ea',
    '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae' // @Latina - known good wallet
  ];

  console.log('=== Checking trade counts for golden wallets ===\n');

  for (const w of wallets) {
    const q = `
      SELECT count() as trades
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${w}')
        AND is_deleted = 0
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = await r.json() as any[];
    console.log(`${w.slice(-8)}: ${rows[0]?.trades || 0} trades`);
  }

  // Also check CTF events for these wallets
  console.log('\n=== Checking CTF events ===\n');

  for (const w of wallets) {
    const q = `
      SELECT count() as events
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${w}')
        AND is_deleted = 0
    `;
    const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = await r.json() as any[];
    console.log(`${w.slice(-8)}: ${rows[0]?.events || 0} CTF events`);
  }
}
check().catch(console.error);
