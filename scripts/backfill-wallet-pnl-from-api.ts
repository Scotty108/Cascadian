#!/usr/bin/env tsx
/**
 * Backfill Wallet P&L from Polymarket Data API
 *
 * This script fetches wallet positions and P&L data from the Polymarket Data API
 * and stores it in ClickHouse for comparison with our calculated P&L.
 *
 * Usage:
 *   npx tsx backfill-wallet-pnl-from-api.ts [wallet_address]
 *
 * Examples:
 *   npx tsx backfill-wallet-pnl-from-api.ts 0x4ce73141dbfce41e65db3723e31059a730f0abad
 *   npx tsx backfill-wallet-pnl-from-api.ts --top-wallets 100
 */

import { createClient } from '@clickhouse/client';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'http://localhost:8123';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DB || 'polymarket';

const clickhouse = createClient({
  url: CLICKHOUSE_HOST,
  database: CLICKHOUSE_DATABASE,
});

// ============================================================================
// DATA API CLIENT
// ============================================================================

interface Position {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  totalBought: number;
  realizedPnl: number;
  percentRealizedPnl: number;
  curPrice: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  icon?: string;
  eventId?: string;
  eventSlug?: string;
  outcome: string;
  outcomeIndex: number;
  oppositeOutcome?: string;
  oppositeAsset?: string;
  endDate: string;
  negativeRisk?: boolean;
}

async function getAllPositions(address: string): Promise<Position[]> {
  const allPositions: Position[] = [];
  let offset = 0;
  const limit = 500; // Max allowed by API

  while (true) {
    const params = new URLSearchParams({
      user: address.toLowerCase(),
      limit: String(limit),
      offset: String(offset),
      sortBy: 'CASHPNL',
      sortDirection: 'DESC',
    });

    const url = `https://data-api.polymarket.com/positions?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Data API error: ${response.status} ${response.statusText}`);
    }

    const positions: Position[] = await response.json();

    if (positions.length === 0) {
      break;
    }

    allPositions.push(...positions);
    console.log(`  Fetched ${positions.length} positions (total: ${allPositions.length})`);

    if (positions.length < limit) {
      break; // No more data
    }

    offset += limit;
  }

  return allPositions;
}

// ============================================================================
// CLICKHOUSE SCHEMA
// ============================================================================

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS polymarket.wallet_positions_api (
  wallet_address String,
  asset_token_id String,
  condition_id String,
  market_title String,
  market_slug String,
  event_id String,
  event_slug String,
  outcome String,
  outcome_index UInt8,
  size Float64,
  avg_price Float64,
  initial_value Float64,
  current_value Float64,
  cash_pnl Float64,
  percent_pnl Float64,
  total_bought Float64,
  realized_pnl Float64,
  percent_realized_pnl Float64,
  current_price Float64,
  redeemable Bool,
  mergeable Bool,
  end_date Date,
  negative_risk Bool,
  fetched_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(fetched_at)
PARTITION BY toYYYYMM(end_date)
ORDER BY (wallet_address, condition_id, outcome_index);
`;

async function ensureTableExists() {
  await clickhouse.exec({ query: CREATE_TABLE_SQL });
  console.log('✅ Table polymarket.wallet_positions_api ready');
}

// ============================================================================
// DATA INSERTION
// ============================================================================

async function insertPositions(positions: Position[]) {
  if (positions.length === 0) {
    console.log('⚠️  No positions to insert');
    return;
  }

  const rows = positions.map(p => ({
    wallet_address: p.proxyWallet.toLowerCase(),
    asset_token_id: p.asset,
    condition_id: p.conditionId.toLowerCase().replace('0x', ''),
    market_title: p.title || '',
    market_slug: p.slug || '',
    event_id: p.eventId || '',
    event_slug: p.eventSlug || '',
    outcome: p.outcome || '',
    outcome_index: p.outcomeIndex,
    size: p.size,
    avg_price: p.avgPrice,
    initial_value: p.initialValue,
    current_value: p.currentValue,
    cash_pnl: p.cashPnl,
    percent_pnl: p.percentPnl,
    total_bought: p.totalBought,
    realized_pnl: p.realizedPnl,
    percent_realized_pnl: p.percentRealizedPnl,
    current_price: p.curPrice,
    redeemable: p.redeemable,
    mergeable: p.mergeable,
    end_date: p.endDate,
    negative_risk: p.negativeRisk || false,
  }));

  await clickhouse.insert({
    table: 'polymarket.wallet_positions_api',
    values: rows,
    format: 'JSONEachRow',
  });

  console.log(`✅ Inserted ${rows.length} positions`);
}

// ============================================================================
// GET TOP WALLETS
// ============================================================================

async function getTopWallets(limit: number): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT wallet_address
      FROM polymarket.vw_wallet_pnl
      ORDER BY abs(total_pnl_usd) DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const rows = await result.json<{ wallet_address: string }>();
  return rows.map(r => r.wallet_address);
}

// ============================================================================
// SUMMARY QUERIES
// ============================================================================

async function printWalletSummary(address: string) {
  const summary = await clickhouse.query({
    query: `
      SELECT
        count() as total_positions,
        countIf(redeemable) as redeemable_positions,
        sum(cash_pnl) as total_cash_pnl,
        sum(realized_pnl) as total_realized_pnl,
        sum(current_value) as total_current_value,
        min(cash_pnl) as biggest_loss,
        max(cash_pnl) as biggest_win
      FROM polymarket.wallet_positions_api
      WHERE wallet_address = '${address.toLowerCase()}'
    `,
    format: 'JSONEachRow',
  });

  const result = await summary.json<any>();
  if (result.length > 0) {
    const s = result[0];
    console.log();
    console.log('📊 Wallet Summary from API:');
    console.log(`   Total Positions: ${s.total_positions}`);
    console.log(`   Redeemable: ${s.redeemable_positions}`);
    console.log(`   Total Cash P&L: $${parseFloat(s.total_cash_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Total Realized P&L: $${parseFloat(s.total_realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Current Value: $${parseFloat(s.total_current_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Biggest Win: $${parseFloat(s.biggest_win).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   Biggest Loss: $${parseFloat(s.biggest_loss).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log();
  }
}

async function printTopPositions(address: string, limit = 10) {
  const positions = await clickhouse.query({
    query: `
      SELECT
        market_title,
        outcome,
        cash_pnl,
        realized_pnl,
        size,
        avg_price,
        condition_id
      FROM polymarket.wallet_positions_api
      WHERE wallet_address = '${address.toLowerCase()}'
      ORDER BY cash_pnl DESC
      LIMIT ${limit}
    `,
    format: 'JSONEachRow',
  });

  const result = await positions.json<any>();
  console.log(`🔝 Top ${limit} Positions by Cash P&L:`);
  result.forEach((pos: any, i: number) => {
    console.log(`   ${i + 1}. ${pos.market_title}`);
    console.log(`      Outcome: ${pos.outcome}`);
    console.log(`      Cash P&L: $${parseFloat(pos.cash_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`      Realized P&L: $${parseFloat(pos.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`      Size: ${parseFloat(pos.size).toLocaleString()} @ avg $${parseFloat(pos.avg_price).toFixed(4)}`);
    console.log();
  });
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  console.log('='.repeat(80));
  console.log('BACKFILL WALLET P&L FROM POLYMARKET DATA API');
  console.log('='.repeat(80));
  console.log();

  // Ensure table exists
  await ensureTableExists();
  console.log();

  let wallets: string[] = [];

  if (args.includes('--top-wallets')) {
    const index = args.indexOf('--top-wallets');
    const limit = parseInt(args[index + 1] || '100', 10);
    console.log(`Fetching top ${limit} wallets from vw_wallet_pnl...`);
    wallets = await getTopWallets(limit);
    console.log(`✅ Found ${wallets.length} wallets`);
  } else if (args.length > 0 && args[0].startsWith('0x')) {
    wallets = [args[0]];
  } else {
    console.error('Usage:');
    console.error('  npx tsx backfill-wallet-pnl-from-api.ts <wallet_address>');
    console.error('  npx tsx backfill-wallet-pnl-from-api.ts --top-wallets <limit>');
    process.exit(1);
  }

  console.log();

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    console.log(`[${i + 1}/${wallets.length}] Processing wallet: ${wallet}`);

    try {
      const positions = await getAllPositions(wallet);
      await insertPositions(positions);

      if (wallets.length === 1) {
        // Print detailed summary for single wallet
        await printWalletSummary(wallet);
        await printTopPositions(wallet, 10);
      }

      console.log();
    } catch (error) {
      console.error(`❌ Error processing wallet ${wallet}:`, error);
    }

    // Rate limiting - be nice to the API
    if (i < wallets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log('='.repeat(80));
  console.log('✅ BACKFILL COMPLETE');
  console.log('='.repeat(80));
  console.log();
  console.log('Query examples:');
  console.log();
  console.log('-- Check total P&L for a wallet:');
  console.log("SELECT sum(cash_pnl) FROM polymarket.wallet_positions_api WHERE wallet_address = '0x...'");
  console.log();
  console.log('-- Compare API P&L vs calculated P&L:');
  console.log(`SELECT
    api.wallet_address,
    api.total_cash_pnl as api_pnl,
    calc.total_pnl_usd as calculated_pnl,
    api.total_cash_pnl - calc.total_pnl_usd as difference
  FROM (
    SELECT wallet_address, sum(cash_pnl) as total_cash_pnl
    FROM polymarket.wallet_positions_api
    GROUP BY wallet_address
  ) api
  LEFT JOIN polymarket.vw_wallet_pnl calc
    ON api.wallet_address = calc.wallet_address
  ORDER BY abs(difference) DESC
  LIMIT 20;`);
  console.log();

  await clickhouse.close();
}

main().catch(console.error);
