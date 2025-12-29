/**
 * Simplified maker/taker check - no full table scans
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('=== MAKER/TAKER DATA ANALYSIS (Simple) ===\n');

  // 1. Simple role distribution (last 30 days only)
  console.log('1. Role distribution (last 30 days)...');
  const roleQuery = await clickhouse.query({
    query: `
      SELECT
        role,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
      GROUP BY role
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const roleRows = await roleQuery.json() as any[];
  console.log('Role values:');
  roleRows.forEach((r: any) => console.log(`  ${r.role || '(empty)'}: ${Number(r.cnt).toLocaleString()}`));

  // 2. Side values
  console.log('\n2. Side values (last 30 days)...');
  const sideQuery = await clickhouse.query({
    query: `
      SELECT side, count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 30 DAY
      GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const sideRows = await sideQuery.json() as any[];
  sideRows.forEach((r: any) => console.log(`  ${r.side}: ${Number(r.cnt).toLocaleString()}`));

  // 3. Sample rows to see structure
  console.log('\n3. Sample rows with role populated...');
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        event_id,
        trade_id,
        trader_wallet,
        role,
        side,
        usdc_amount / 1e6 as usdc,
        trade_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND role != ''
        AND trade_time >= now() - INTERVAL 7 DAY
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleRows = await sampleQuery.json() as any[];
  console.log('Sample rows:');
  sampleRows.forEach((r: any) => {
    console.log(`  ${r.event_id.slice(0, 20)}... | role=${r.role} | side=${r.side} | $${Number(r.usdc).toFixed(2)}`);
  });

  // 4. Check if trade_id groups maker+taker pairs
  console.log('\n4. trade_id grouping check (last 7 days)...');
  const tradeIdQuery = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        groupArray(distinct role) as roles,
        count() as row_count,
        countDistinct(trader_wallet) as wallet_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_id != ''
        AND trade_time >= now() - INTERVAL 7 DAY
      GROUP BY trade_id
      HAVING length(roles) = 2  -- has both maker and taker
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const tradeIdRows = await tradeIdQuery.json() as any[];
  if (tradeIdRows.length > 0) {
    console.log('Trades with both maker and taker:');
    tradeIdRows.forEach((r: any) => {
      console.log(`  trade_id: ${r.trade_id} | roles: ${JSON.stringify(r.roles)} | wallets: ${r.wallet_count}`);
    });
  } else {
    console.log('  No trades found with both maker and taker roles');
  }

  // 5. Wallet breakdown: how many wallets have both maker and taker activity
  console.log('\n5. Wallet maker/taker activity (last 30d, deduped)...');
  const walletQuery = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT
          event_id,
          any(trader_wallet) as wallet,
          any(role) as role,
          any(usdc_amount) / 1e6 as usdc
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY event_id
      )
      SELECT
        wallet,
        countIf(role = 'taker') as taker_fills,
        countIf(role = 'maker') as maker_fills,
        round(sumIf(usdc, role = 'taker'), 0) as taker_vol,
        round(sumIf(usdc, role = 'maker'), 0) as maker_vol
      FROM deduped
      GROUP BY wallet
      HAVING taker_fills > 0 AND maker_fills > 0
      ORDER BY taker_fills + maker_fills DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const walletRows = await walletQuery.json() as any[];
  console.log('Top wallets with BOTH maker and taker activity:');
  console.log('Wallet                                     | Taker | Maker | Taker Vol   | Maker Vol');
  console.log('-------------------------------------------|-------|-------|-------------|----------');
  walletRows.forEach((r: any) => {
    console.log(`${r.wallet} | ${String(r.taker_fills).padStart(5)} | ${String(r.maker_fills).padStart(5)} | $${String(r.taker_vol).padStart(10)} | $${String(r.maker_vol).padStart(9)}`);
  });

  // 6. Overall ratio
  console.log('\n6. Overall taker vs maker ratio (last 30d)...');
  const ratioQuery = await clickhouse.query({
    query: `
      SELECT
        countIf(role = 'taker') as taker_rows,
        countIf(role = 'maker') as maker_rows,
        countIf(role NOT IN ('taker', 'maker', '')) as other_rows,
        countIf(role = '') as empty_role
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 30 DAY
    `,
    format: 'JSONEachRow'
  });
  const ratioRows = await ratioQuery.json() as any[];
  console.log('Row counts:', ratioRows[0]);

  // 7. For the same event_id, does it ever appear twice with different roles?
  console.log('\n7. Check: same event_id with multiple roles?...');
  const eventDupQuery = await clickhouse.query({
    query: `
      SELECT count() as dup_events
      FROM (
        SELECT event_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 30 DAY
        GROUP BY event_id
        HAVING countDistinct(role) > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const eventDupRows = await eventDupQuery.json() as any[];
  console.log('Events with multiple roles:', eventDupRows[0]);
}

main().catch(console.error);
