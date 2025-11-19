import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK POSITION RESOLUTIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get unique condition_ids from wallet's trades
  const conditionsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        count() as trade_count
      FROM default.vw_trades_canonical
      WHERE wallet_address_norm = lower('${WALLET}')
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id_norm
      ORDER BY trade_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const conditions: any[] = await conditionsQuery.json();
  console.log(`Wallet has traded in ${conditions.length} unique conditions (showing top 20):\n`);

  // Check each condition for resolution
  for (const cond of conditions) {
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_outcome,
          resolved_at
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${cond.condition_id_norm}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const resolutions = await resolutionQuery.json();

    if (resolutions.length > 0) {
      console.log(`✅ RESOLVED: ${cond.condition_id_norm.substring(0, 30)}...`);
      console.log(`   Trades: ${cond.trade_count}`);
      console.log(`   Winning outcome: ${resolutions[0].winning_outcome}`);
      console.log(`   Resolved: ${resolutions[0].resolved_at}\n`);
    } else {
      console.log(`⏳ OPEN: ${cond.condition_id_norm.substring(0, 30)}...`);
      console.log(`   Trades: ${cond.trade_count}\n`);
    }
  }

  // Summary
  let resolved_count = 0;
  let open_count = 0;

  for (const cond of conditions) {
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT count() as cnt
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${cond.condition_id_norm}'
      `,
      format: 'JSONEachRow'
    });

    const result = await resolutionQuery.json();
    if (result[0].cnt > 0) {
      resolved_count++;
    } else {
      open_count++;
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`Conditions analyzed: ${conditions.length}`);
  console.log(`   Resolved: ${resolved_count}`);
  console.log(`   Open: ${open_count}\n`);

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
