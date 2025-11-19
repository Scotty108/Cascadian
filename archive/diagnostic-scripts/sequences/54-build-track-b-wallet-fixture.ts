/**
 * 54: BUILD TRACK B WALLET FIXTURE
 *
 * Track B - Step B3.2
 *
 * Build JSON fixture containing wallet-level data for the 4 selected wallets.
 * This fixture will be used to validate against Polymarket's Data API.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { writeFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

// Selected wallets from script 53
const SELECTED_WALLETS = [
  '0x8a6276085b676a02098d83c199683e8a964168e1',
  '0x1e5d5cb25815fedfd1d17d05c9877b9668bd0fbc',
  '0x880b0cb887fc56aa48a8e276d9d9a18d0eb67844',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
];

interface WalletData {
  canonical_wallet: string;
  total_fills: number;
  total_markets: number;
  earliest_fill: string;
  latest_fill: string;
  trades: TradeData[];
  summary: {
    total_trades: number;
    buy_trades: number;
    sell_trades: number;
    total_volume: number;
    realized_pnl: number;
  };
}

interface TradeData {
  trade_id: string;
  timestamp: string;
  asset_id: string;
  side: string;
  size: number;
  price: number;
  cost: number;
}

async function calculateWalletPnL(trades: TradeData[]): Promise<number> {
  // Calculate P&L using FIFO cost basis
  const positions = new Map<string, { netSize: number; costBasis: number }>();
  let totalRealizedPnL = 0;

  for (const trade of trades) {
    const assetId = trade.asset_id;
    const size = trade.size;
    const price = trade.price;

    if (!positions.has(assetId)) {
      positions.set(assetId, { netSize: 0, costBasis: 0 });
    }

    const pos = positions.get(assetId)!;

    if (trade.side === 'BUY') {
      pos.netSize += size;
      pos.costBasis += size * price;
    } else {
      // SELL
      const avgCost = pos.netSize > 0 ? pos.costBasis / pos.netSize : 0;
      const saleRevenue = size * price;
      const saleCost = size * avgCost;
      const realizedPnL = saleRevenue - saleCost;

      totalRealizedPnL += realizedPnL;

      pos.netSize -= size;
      pos.costBasis = Math.max(0, pos.netSize * avgCost);
    }
  }

  return totalRealizedPnL;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('54: BUILD TRACK B WALLET FIXTURE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Build wallet fixture JSON for Track B validation\n');
  console.log(`Building fixture for ${SELECTED_WALLETS.length} wallets...\n`);

  const walletFixtures: WalletData[] = [];

  for (const wallet of SELECTED_WALLETS) {
    console.log(`\n📊 Processing wallet: ${wallet.substring(0, 12)}...`);

    // Step 1: Get wallet metadata from wallet_identity_map
    const metadataQuery = await clickhouse.query({
      query: `
        SELECT
          canonical_wallet,
          sum(fills_count) AS total_fills,
          sum(markets_traded) AS total_markets,
          min(first_fill_ts) AS earliest_fill,
          max(last_fill_ts) AS latest_fill
        FROM wallet_identity_map
        WHERE canonical_wallet = '${wallet}'
        GROUP BY canonical_wallet
      `,
      format: 'JSONEachRow'
    });

    const metadataResults: any[] = await metadataQuery.json();

    if (metadataResults.length === 0) {
      console.log(`  ⚠️  Wallet not found in wallet_identity_map, skipping`);
      continue;
    }

    const metadata = metadataResults[0];

    console.log(`  ✓ Metadata: ${metadata.total_fills} fills, ${metadata.total_markets} markets`);

    // Step 2: Get all trades for this wallet
    const tradesQuery = await clickhouse.query({
      query: `
        SELECT
          toString(timestamp) AS trade_id,
          timestamp,
          asset_id,
          side,
          size,
          price,
          size * price AS cost
        FROM clob_fills
        WHERE proxy_wallet = '${wallet}'
        ORDER BY timestamp ASC
      `,
      format: 'JSONEachRow'
    });

    const trades: TradeData[] = await tradesQuery.json();

    console.log(`  ✓ Trades: ${trades.length} fills loaded`);

    // Step 3: Calculate summary statistics
    const buyTrades = trades.filter(t => t.side === 'BUY').length;
    const sellTrades = trades.filter(t => t.side === 'SELL').length;
    const totalVolume = trades.reduce((sum, t) => sum + t.cost, 0);
    const realizedPnL = await calculateWalletPnL(trades);

    console.log(`  ✓ Summary: ${buyTrades} buys, ${sellTrades} sells, $${totalVolume.toFixed(2)} volume`);
    console.log(`  ✓ Realized P&L: $${realizedPnL.toFixed(2)}`);

    // Step 4: Build wallet fixture
    walletFixtures.push({
      canonical_wallet: metadata.canonical_wallet,
      total_fills: metadata.total_fills,
      total_markets: metadata.total_markets,
      earliest_fill: metadata.earliest_fill,
      latest_fill: metadata.latest_fill,
      trades,
      summary: {
        total_trades: trades.length,
        buy_trades: buyTrades,
        sell_trades: sellTrades,
        total_volume: totalVolume,
        realized_pnl: realizedPnL
      }
    });
  }

  // Step 5: Write fixture to JSON file
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('WRITING FIXTURE FILE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const fixturePath = resolve(process.cwd(), 'fixture_track_b_wallets.json');
  writeFileSync(fixturePath, JSON.stringify(walletFixtures, null, 2));

  console.log(`✅ Fixture written to: ${fixturePath}\n`);

  // Step 6: Print summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FIXTURE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('| Wallet | Fills | Markets | Total Trades | Realized P&L | Volume |');
  console.log('|--------|-------|---------|--------------|--------------|--------|');

  for (const wallet of walletFixtures) {
    const w = wallet.canonical_wallet.substring(0, 10) + '...';
    const fills = wallet.total_fills;
    const markets = wallet.total_markets;
    const trades = wallet.summary.total_trades;
    const pnl = wallet.summary.realized_pnl.toFixed(2);
    const volume = wallet.summary.total_volume.toFixed(2);

    console.log(`| ${w} | ${fills} | ${markets} | ${trades} | $${pnl} | $${volume} |`);
  }

  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('VALIDATION CHECKPOINTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('For each wallet, we will validate:');
  console.log('  1. Trade count matches Polymarket Data API /trades endpoint');
  console.log('  2. Realized P&L matches Polymarket Data API /positions endpoint');
  console.log('');

  console.log('Next steps:');
  console.log('  - Run script 55: Compare trade counts vs Polymarket Data API');
  console.log('  - Run script 56: Compare P&L vs Polymarket Data API');
  console.log('');

  console.log('✅ Fixture creation complete\n');
}

main().catch(console.error);
