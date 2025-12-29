/**
 * Check maker/taker data structure in pm_trader_events_v2
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('=== MAKER/TAKER DATA ANALYSIS ===\n');

  // 1. Check what columns exist
  console.log('1. Checking schema for role/side columns...');
  const schema = await clickhouse.query({
    query: `DESCRIBE pm_trader_events_v2`,
    format: 'JSONEachRow'
  });
  const schemaRows = await schema.json() as any[];
  const relevantCols = schemaRows.filter(r =>
    r.name.includes('role') || r.name.includes('side') || r.name === 'event_id'
  );
  console.log('Relevant columns:');
  relevantCols.forEach((r: any) => console.log(`  ${r.name}: ${r.type}`));

  // 2. Check distinct values for role and side
  console.log('\n2. Checking distinct role values...');
  const roleQuery = await clickhouse.query({
    query: `
      SELECT
        role,
        count() as cnt,
        countDistinct(event_id) as unique_events,
        count() / (SELECT count() FROM pm_trader_events_v2 WHERE is_deleted = 0) * 100 as pct
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY role
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const roleRows = await roleQuery.json() as any[];
  console.log('Role values:');
  roleRows.forEach((r: any) => console.log(`  ${r.role || '(empty)'}: ${Number(r.cnt).toLocaleString()} rows (${Number(r.pct).toFixed(2)}%)`));

  console.log('\n3. Checking distinct side values...');
  const sideQuery = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY side
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const sideRows = await sideQuery.json() as any[];
  console.log('Side values:');
  sideRows.forEach((r: any) => console.log(`  ${r.side}: ${Number(r.cnt).toLocaleString()}`));

  // 3. Check if same event_id can appear with different roles (maker + taker)
  console.log('\n4. Checking if same event_id appears with multiple roles...');
  const multiRoleQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_events,
        countIf(role_count > 1) as multi_role_events
      FROM (
        SELECT event_id, countDistinct(role) as role_count
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const multiRoleRows = await multiRoleQuery.json() as any[];
  console.log('Multi-role analysis:', multiRoleRows[0]);

  // 4. Check if maker and taker are different wallets for same trade
  console.log('\n5. Sample: maker vs taker for same trade_id...');
  const tradeIdQuery = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        groupArray(role) as roles,
        groupArray(trader_wallet) as wallets,
        groupArray(side) as sides,
        groupArray(usdc_amount / 1e6) as usdc_amounts
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_id != ''
      GROUP BY trade_id
      HAVING length(roles) > 1
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const tradeIdRows = await tradeIdQuery.json() as any[];
  if (tradeIdRows.length > 0) {
    console.log('Sample multi-party trades:');
    tradeIdRows.forEach((r: any) => {
      console.log(`  trade_id: ${r.trade_id}`);
      console.log(`    roles: ${JSON.stringify(r.roles)}`);
      console.log(`    wallets: ${JSON.stringify(r.wallets.map((w: string) => w.slice(0, 10) + '...'))}`);
      console.log(`    sides: ${JSON.stringify(r.sides)}`);
    });
  } else {
    console.log('  No multi-party trades found with trade_id');
  }

  // 5. For a specific wallet, check maker vs taker fills
  console.log('\n6. Sample wallet maker vs taker breakdown...');
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
        GROUP BY event_id
      )
      SELECT
        wallet,
        countIf(role = 'taker') as taker_fills,
        countIf(role = 'maker') as maker_fills,
        countIf(role NOT IN ('taker', 'maker')) as other_fills,
        sumIf(usdc, role = 'taker') as taker_volume,
        sumIf(usdc, role = 'maker') as maker_volume
      FROM deduped
      GROUP BY wallet
      HAVING taker_fills > 0 AND maker_fills > 0
      ORDER BY taker_fills + maker_fills DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const walletRows = await walletQuery.json() as any[];
  console.log('Wallets with both maker and taker activity:');
  console.log('Wallet                                     | Taker Fills | Maker Fills | Taker Vol   | Maker Vol');
  console.log('-------------------------------------------|-------------|-------------|-------------|----------');
  walletRows.forEach((r: any) => {
    console.log(`${r.wallet} | ${String(r.taker_fills).padStart(11)} | ${String(r.maker_fills).padStart(11)} | $${Number(r.taker_volume).toFixed(0).padStart(10)} | $${Number(r.maker_volume).toFixed(0).padStart(9)}`);
  });

  // 6. Check: does a wallet ever appear as BOTH maker and taker on the same trade_id?
  console.log('\n7. Checking if same wallet ever appears as both maker AND taker on same trade...');
  const selfTradeQuery = await clickhouse.query({
    query: `
      SELECT count() as self_trades
      FROM (
        SELECT trade_id, trader_wallet
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_id != ''
        GROUP BY trade_id, trader_wallet
        HAVING countDistinct(role) > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const selfTradeRows = await selfTradeQuery.json() as any[];
  console.log('Self-trade count (wallet as both maker+taker):', selfTradeRows[0]);
}

main().catch(console.error);
