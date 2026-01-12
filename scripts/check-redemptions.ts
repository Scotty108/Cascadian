import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const wallet = process.argv[2] || '0x1f3178c3f82eee8e67018473b8fc33b3dc7806cb';

  console.log(`\n=== REDEMPTION EVENTS FOR ${wallet} ===\n`);

  // Get redemption details
  const result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        toFloat64OrZero(amount_or_payout)/1e6 as payout_amount,
        event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) = '${wallet.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY event_timestamp
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];
  console.log('PayoutRedemption events:');
  let totalRedemptions = 0;
  for (const row of rows) {
    console.log(`  ${row.condition_id.substring(0, 20)}...: $${row.payout_amount.toFixed(2)} @ ${row.event_timestamp}`);
    totalRedemptions += row.payout_amount;
  }
  console.log(`\nTotal redemption payouts: $${totalRedemptions.toFixed(2)}`);

  // Compare with position calculations
  // For positions where we have POSITIVE tokens that resolved to 1.0,
  // we should see redemptions equal to those tokens

  process.exit(0);
}

main().catch(console.error);
