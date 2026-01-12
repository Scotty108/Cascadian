import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== CTF EVENTS FOR ${wallet} ===\n`);

  // Check CTF events
  const result = await clickhouse.query({
    query: `
      SELECT event_type, count() as cnt, sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND is_deleted = 0
      GROUP BY event_type
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  console.log('CTF events summary:');
  for (const row of rows) {
    console.log(`  ${row.event_type}: ${row.cnt} events, $${row.total_amount.toFixed(2)} total`);
  }

  // Also check pm_ctf_split_merge_expanded for more detail
  const result2 = await clickhouse.query({
    query: `
      SELECT event_type, count() as cnt, sum(abs(shares_delta)) as total_shares
      FROM pm_ctf_split_merge_expanded
      WHERE lower(wallet) = '${wallet.toLowerCase()}'
      GROUP BY event_type
    `,
    format: 'JSONEachRow',
  });

  const rows2 = await result2.json() as any[];
  console.log('\nExpanded split/merge events:');
  for (const row of rows2) {
    console.log(`  ${row.event_type}: ${row.cnt} events, ${row.total_shares.toFixed(2)} shares`);
  }

  process.exit(0);
}

main().catch(console.error);
