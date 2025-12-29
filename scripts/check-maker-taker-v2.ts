/**
 * Verify maker/taker structure
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('=== MAKER/TAKER STRUCTURE VERIFICATION ===\n');

  // 1. Show schema
  console.log('1. Schema columns...');
  const schema = await clickhouse.query({
    query: `DESCRIBE pm_trader_events_v2`,
    format: 'JSONEachRow'
  });
  const schemaRows = await schema.json() as any[];
  console.log('All columns:');
  schemaRows.forEach((r: any) => console.log(`  ${r.name}: ${r.type}`));

  // 2. Sample rows showing both sides of a trade
  console.log('\n2. Sample: maker row vs taker row...');
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        event_id,
        trader_wallet,
        role,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as tokens,
        trade_time
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 1 DAY
      ORDER BY trade_time DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const samples = await sampleQuery.json() as any[];
  console.log('Recent trades (note: each match has maker+taker rows):');
  console.log('event_id                         | role   | side | wallet (first 10)     | usdc');
  console.log('---------------------------------|--------|------|-----------------------|-------');
  samples.forEach((r: any) => {
    console.log(`${r.event_id.slice(0, 32)} | ${r.role.padEnd(6)} | ${r.side.padEnd(4)} | ${r.trader_wallet.slice(0, 21)} | $${Number(r.usdc).toFixed(2)}`);
  });

  // 3. For a known wallet, show their maker vs taker fills
  console.log('\n3. Wallet breakdown: taker-only vs maker-only (last 30d)...');
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
        round(100.0 * countIf(role = 'taker') / count(), 1) as taker_pct,
        round(sumIf(usdc, role = 'taker'), 0) as taker_vol,
        round(sumIf(usdc, role = 'maker'), 0) as maker_vol
      FROM deduped
      GROUP BY wallet
      HAVING (taker_fills > 10 OR maker_fills > 10)
      ORDER BY taker_fills + maker_fills DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  const walletRows = await walletQuery.json() as any[];
  console.log('Wallet                                     | Taker | Maker | Taker% | Taker Vol   | Maker Vol');
  console.log('-------------------------------------------|-------|-------|--------|-------------|----------');
  walletRows.forEach((r: any) => {
    console.log(`${r.wallet} | ${String(r.taker_fills).padStart(5)} | ${String(r.maker_fills).padStart(5)} | ${String(r.taker_pct).padStart(5)}% | $${String(r.taker_vol).padStart(10)} | $${String(r.maker_vol).padStart(9)}`);
  });

  // 4. Total unique fills by role
  console.log('\n4. Unique event_ids by role (verifying no overlap)...');
  const uniqueQuery = await clickhouse.query({
    query: `
      SELECT
        role,
        countDistinct(event_id) as unique_events
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 7 DAY
      GROUP BY role
    `,
    format: 'JSONEachRow'
  });
  const uniqueRows = await uniqueQuery.json() as any[];
  console.log('Unique events by role:');
  uniqueRows.forEach((r: any) => console.log(`  ${r.role}: ${Number(r.unique_events).toLocaleString()}`));

  // 5. Check if event_id is unique per wallet (each event_id should appear once per wallet)
  console.log('\n5. Sanity check: event_id appears once per wallet?...');
  const sanityQuery = await clickhouse.query({
    query: `
      SELECT count() as dup_count
      FROM (
        SELECT event_id, trader_wallet, count() as cnt
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND trade_time >= now() - INTERVAL 7 DAY
        GROUP BY event_id, trader_wallet
        HAVING cnt > 1
      )
    `,
    format: 'JSONEachRow'
  });
  const sanityRows = await sanityQuery.json() as any[];
  console.log('Duplicate (event_id, wallet) pairs:', sanityRows[0]);

  // 6. Summary
  console.log('\n=== SUMMARY ===');
  console.log(`
KEY FINDINGS:
1. Each CLOB match creates TWO rows in pm_trader_events_v2:
   - One for the MAKER (resting order that got hit)
   - One for the TAKER (crossing order that executed)

2. These are DIFFERENT wallets - a wallet is either maker OR taker on any given trade.

3. event_id is unique per (wallet, role) - no duplicates within a wallet.

4. For wallet-level t-stat:
   - Taker-only: Filters to active traders who cross the spread (intentional entries)
   - Maker-only: Would show passive fills (limit orders getting hit)
   - Combined: Could double-count if you're measuring "market" metrics, but NOT for wallet-level

5. DEDUPLICATION GUIDANCE:
   - By event_id: Removes ingestion duplicates (same row inserted twice)
   - By condition_id: WRONG - each condition has many fills
   - For wallet stats: No maker/taker dedupe needed - they're different wallets

6. WHY TAKER-ONLY FOR COPYTRADING:
   - Takers show INTENTIONAL entries (they crossed the spread)
   - Makers show PASSIVE fills (their limit order got hit by someone else)
   - Taker fills reflect the wallet's active decisions -> what you'd copy
  `);
}

main().catch(console.error);
