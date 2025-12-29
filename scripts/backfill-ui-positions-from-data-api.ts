#!/usr/bin/env tsx
/**
 * Backfill UI Positions from Polymarket Data API
 *
 * Fetches BOTH open and closed positions from Polymarket Data API
 * and inserts into pm_ui_positions table for UI PnL calculation.
 *
 * Key insight:
 * - Open positions have cashPnl (unrealized, can be negative)
 * - Closed positions have realizedPnl (realized gains)
 * - UI Losses ≈ sum(cashPnl) from open positions where cashPnl < 0
 * - UI Gains ≈ sum(realizedPnl) from closed positions
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

// ClickHouse client
const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Polymarket Data API
const DATA_API_BASE = 'https://data-api.polymarket.com';

// Calibration wallets
const WALLET_ADDRESSES = [
  '0x56687bf447db6ffa42ffe2204a05edaa20f55839', // Theo
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c', // Sports Bettor
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface UIPosition {
  proxy_wallet: string;
  condition_id: string;
  asset: string;
  cash_pnl: number;       // For open: cashPnl, for closed: realizedPnl
  total_bought: number;
  realized_pnl: number;
  current_value: number;
  position_type: string;  // 'open' or 'closed'
}

/**
 * Fetch all positions from an endpoint with pagination
 */
async function fetchAllPositions(endpoint: string, wallet: string): Promise<any[]> {
  const allPositions: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `${endpoint}?user=${wallet}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Cascadian-PnL-Calibration/1.0',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) break;

    allPositions.push(...data);

    if (data.length < limit) break;
    offset += limit;

    await sleep(200); // Rate limiting
  }

  return allPositions;
}

/**
 * Fetch and combine open + closed positions for a wallet
 */
async function fetchPositionsForWallet(wallet: string): Promise<UIPosition[]> {
  console.log(`  Fetching open positions...`);
  const openPositions = await fetchAllPositions(`${DATA_API_BASE}/positions`, wallet);
  console.log(`    Found ${openPositions.length} open positions`);

  console.log(`  Fetching closed positions...`);
  const closedPositions = await fetchAllPositions(`${DATA_API_BASE}/closed-positions`, wallet);
  console.log(`    Found ${closedPositions.length} closed positions`);

  // Transform open positions - use cashPnl
  const openRows: UIPosition[] = openPositions.map(pos => ({
    proxy_wallet: wallet.toLowerCase(),
    condition_id: pos.conditionId || '',
    asset: pos.asset || '',
    cash_pnl: pos.cashPnl || 0,         // This is the key field for losses
    total_bought: pos.totalBought || 0,
    realized_pnl: pos.realizedPnl || 0,
    current_value: pos.currentValue || 0,
    position_type: 'open',
  }));

  // Transform closed positions - use realizedPnl as cash_pnl for the view
  const closedRows: UIPosition[] = closedPositions.map(pos => ({
    proxy_wallet: wallet.toLowerCase(),
    condition_id: pos.conditionId || '',
    asset: pos.asset || '',
    cash_pnl: pos.realizedPnl || 0,     // Realized gains go here
    total_bought: pos.totalBought || 0,
    realized_pnl: pos.realizedPnl || 0,
    current_value: 0,                    // Closed positions have no current value
    position_type: 'closed',
  }));

  return [...openRows, ...closedRows];
}

/**
 * Insert positions into ClickHouse
 */
async function insertPositions(positions: UIPosition[]): Promise<void> {
  if (positions.length === 0) {
    console.log('  No positions to insert');
    return;
  }

  const wallet = positions[0].proxy_wallet;

  // Clear existing data for this wallet
  await clickhouse.command({
    query: `ALTER TABLE pm_ui_positions DELETE WHERE proxy_wallet = '${wallet}'`,
  });
  await sleep(1000);

  // Insert in batches
  const BATCH_SIZE = 500;
  for (let i = 0; i < positions.length; i += BATCH_SIZE) {
    const batch = positions.slice(i, i + BATCH_SIZE);

    await clickhouse.insert({
      table: 'pm_ui_positions',
      values: batch.map(p => ({
        proxy_wallet: p.proxy_wallet,
        condition_id: p.condition_id,
        asset: p.asset,
        cash_pnl: p.cash_pnl,
        total_bought: p.total_bought,
        realized_pnl: p.realized_pnl,
        current_value: p.current_value,
      })),
      format: 'JSONEachRow',
    });

    console.log(`  Inserted batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(positions.length/BATCH_SIZE)}`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== Backfill UI Positions from Polymarket Data API ===');
  console.log();

  for (const wallet of WALLET_ADDRESSES) {
    console.log(`Processing wallet: ${wallet}`);

    try {
      const positions = await fetchPositionsForWallet(wallet);

      // Statistics
      const openCount = positions.filter(p => p.position_type === 'open').length;
      const closedCount = positions.filter(p => p.position_type === 'closed').length;
      const totalCashPnl = positions.reduce((sum, p) => sum + p.cash_pnl, 0);
      const gains = positions.filter(p => p.cash_pnl > 0).reduce((sum, p) => sum + p.cash_pnl, 0);
      const losses = positions.filter(p => p.cash_pnl < 0).reduce((sum, p) => sum + p.cash_pnl, 0);

      console.log(`  Total: ${positions.length} positions (${openCount} open, ${closedCount} closed)`);
      console.log(`  Total cash_pnl: $${totalCashPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Gains (positive): $${gains.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Losses (negative): $${losses.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

      await insertPositions(positions);
      console.log(`  ✅ Inserted ${positions.length} positions`);
    } catch (error) {
      console.error(`  ❌ Error: ${(error as Error).message}`);
    }

    console.log();
    await sleep(1000);
  }

  // Final verification
  console.log('=== Final Verification ===');
  const result = await clickhouse.query({
    query: `
      SELECT
        proxy_wallet,
        count() as positions,
        sum(cash_pnl) as net_pnl,
        sumIf(cash_pnl, cash_pnl > 0) as gains,
        -sumIf(cash_pnl, cash_pnl < 0) as losses
      FROM pm_ui_positions
      GROUP BY proxy_wallet
      ORDER BY proxy_wallet
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  console.log('wallet                                     | positions | net_pnl         | gains           | losses');
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(`${r.proxy_wallet} | ${String(r.positions).padStart(9)} | $${Number(r.net_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} | $${Number(r.gains).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)} | $${Number(r.losses).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(13)}`);
  }

  console.log();
  console.log('=== TARGET COMPARISON ===');
  console.log('Theo target:          net_pnl = $22,053,934');
  console.log('Sports Bettor target: net_pnl = $-10,021,172, gains = $28,812,489, losses = $38,833,660');

  await clickhouse.close();
  console.log();
  console.log('Done!');
}

main().catch(console.error);
