/**
 * Wallet Data Ingestion Script
 *
 * This script:
 * 1. Discovers wallet addresses from Polymarket markets
 * 2. Fetches wallet data from Polymarket Data-API
 * 3. Calculates whale and insider scores
 * 4. Inserts/updates data in Supabase tables
 *
 * Usage:
 *   pnpm tsx scripts/ingest-wallet-data.ts
 *   pnpm tsx scripts/ingest-wallet-data.ts --wallet 0x... (single wallet)
 *   pnpm tsx scripts/ingest-wallet-data.ts --discover (find new wallets)
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const POLYMARKET_DATA_API = 'https://data-api.polymarket.com';
const POLYMARKET_GAMMA_API = 'https://gamma-api.polymarket.com';

// Fetch with timeout to prevent API hanging
async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Known test wallet
const KNOWN_WALLETS = [
  '0x8aaec816b503a23e082f2a570d18c53be777a2ad'
];

interface PolymarketPosition {
  market: string;
  market_slug?: string;
  outcome: string;
  size: number;
  value: number;
  pnl: number;
  percent_pnl?: number;
}

interface PolymarketTrade {
  id: string;
  market: string;
  asset_id: string;
  outcome: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  timestamp: string;
  transaction_hash?: string;
}

interface WalletData {
  address: string;
  positions: PolymarketPosition[];
  trades: PolymarketTrade[];
  totalValue: number;
  totalPnL: number;
}

/**
 * Fetch wallet positions from Polymarket Data-API
 */
async function fetchWalletPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  try {
    const url = `${POLYMARKET_DATA_API}/positions?user=${walletAddress}`;
    console.log(`Fetching positions for ${walletAddress}...`);

    const response = await fetchWithTimeout(url, 15000);
    if (!response.ok) {
      console.error(`Failed to fetch positions: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    console.log(`Found ${data.length || 0} positions`);

    // Transform API response to match our interface
    const positions = (data || []).map((p: any) => ({
      market: p.conditionId || p.market || p.market_id, // API uses conditionId
      market_slug: p.slug,
      outcome: p.outcome,
      size: parseFloat(p.size || 0),
      value: parseFloat(p.currentValue || p.value || 0), // API uses currentValue
      pnl: parseFloat(p.cashPnl || p.pnl || 0), // API uses cashPnl
      percent_pnl: parseFloat(p.percentPnl || p.percent_pnl || 0),
    }));

    return positions;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`Timeout fetching positions for ${walletAddress}`);
    } else {
      console.error(`Error fetching positions for ${walletAddress}:`, error.message);
    }
    return [];
  }
}

/**
 * Fetch wallet trades from Polymarket Data-API
 */
async function fetchWalletTrades(walletAddress: string): Promise<PolymarketTrade[]> {
  try {
    // Reduced limit from 1000 to 200 to prevent API timeouts
    const url = `${POLYMARKET_DATA_API}/trades?user=${walletAddress}&limit=200`;
    console.log(`Fetching trades for ${walletAddress}...`);

    const response = await fetchWithTimeout(url, 15000);
    if (!response.ok) {
      console.error(`Failed to fetch trades: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    console.log(`Found ${data.length || 0} trades`);

    // Transform API response to match our interface
    const trades = (data || []).map((t: any) => ({
      id: t.transactionHash || t.id || `${t.timestamp}-${t.size}`,
      market: t.conditionId || t.market || t.market_id, // API uses conditionId
      asset_id: t.asset || t.asset_id || '',
      outcome: t.outcome,
      side: (t.side || 'BUY').toUpperCase() as 'BUY' | 'SELL',
      size: parseFloat(t.size || 0),
      price: parseFloat(t.price || 0),
      timestamp: String(t.timestamp),
      transaction_hash: t.transactionHash || t.transaction_hash,
    }));

    return trades;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`Timeout fetching trades for ${walletAddress}`);
    } else {
      console.error(`Error fetching trades for ${walletAddress}:`, error.message);
    }
    return [];
  }
}

/**
 * Fetch wallet value from Polymarket Data-API
 */
async function fetchWalletValue(walletAddress: string): Promise<number> {
  try {
    const url = `${POLYMARKET_DATA_API}/portfolioValue?user=${walletAddress}`;
    console.log(`Fetching portfolio value for ${walletAddress}...`);

    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) {
      // 404 is expected if wallet has no current positions
      if (response.status === 404) {
        console.log(`No portfolio value found (likely no open positions)`);
        return 0;
      }
      console.error(`Failed to fetch value: ${response.status} ${response.statusText}`);
      return 0;
    }

    const data = await response.json();
    return data.totalValue || 0;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error(`Timeout fetching value for ${walletAddress}`);
    } else {
      console.error(`Error fetching value for ${walletAddress}:`, error.message);
    }
    return 0;
  }
}

/**
 * Calculate whale score (0-10 scale)
 * Based on: volume, win rate, consistency, position sizes
 */
function calculateWhaleScore(walletData: WalletData): number {
  const { positions, trades, totalValue, address } = walletData;

  // No data = 0 score
  if (trades.length === 0) {
    return 0;
  }

  // Component 1: Volume Score (0-3 points)
  const totalVolume = trades.reduce((sum, t) => sum + ((t.size || 0) * (t.price || 0)), 0);
  const volumeScore = Math.min(3, (totalVolume / 50000) * 3); // $50k+ = max points

  // Component 2: Win Rate Score (0-3 points)
  const closedPositions = positions.filter(p => Math.abs(p.pnl || 0) > 0);
  const winningPositions = closedPositions.filter(p => (p.pnl || 0) > 0);
  const winRate = closedPositions.length > 0 ? winningPositions.length / closedPositions.length : 0;
  const winRateScore = winRate * 3;

  // Component 3: Consistency Score (0-2 points)
  // Trade frequency and position count
  const consistencyScore = Math.min(2, (trades.length / 50) * 2); // 50+ trades = max

  // Component 4: Position Size Score (0-2 points)
  const avgPositionSize = positions.length > 0
    ? positions.reduce((sum, p) => sum + (p.value || 0), 0) / positions.length
    : 0;
  const positionSizeScore = Math.min(2, (avgPositionSize / 5000) * 2); // $5k+ avg = max

  const totalScore = volumeScore + winRateScore + consistencyScore + positionSizeScore;
  const finalScore = Math.min(10, Math.round(totalScore * 10) / 10);

  return isNaN(finalScore) ? 0 : finalScore;
}

/**
 * Calculate insider score (0-10 scale)
 * Based on: early entry timing, contrarian bets, timing precision
 */
function calculateInsiderScore(walletData: WalletData): number {
  const { trades, positions } = walletData;

  if (trades.length === 0) return 0;

  // Component 1: Early Entry Score (0-4 points)
  // Would need market creation timestamps to calculate properly
  // For now, use a placeholder based on trade timing
  const earlyEntryScore = 2; // Placeholder

  // Component 2: Contrarian Score (0-3 points)
  // Identify positions taken against the crowd
  const contrarianBets = trades.filter(t => {
    // Buy NO when price < 0.3 or buy YES when price > 0.7
    return (t.side === 'BUY' && t.outcome === 'NO' && t.price < 0.3) ||
           (t.side === 'BUY' && t.outcome === 'YES' && t.price > 0.7);
  });
  const contrarianScore = Math.min(3, (contrarianBets.length / trades.length) * 6);

  // Component 3: Timing Precision (0-3 points)
  // Analyze PnL relative to position timing
  const profitablePositions = positions.filter(p => p.pnl > 0);
  const avgPnLPercent = profitablePositions.length > 0
    ? profitablePositions.reduce((sum, p) => sum + (p.percent_pnl || 0), 0) / profitablePositions.length
    : 0;
  const timingScore = Math.min(3, (avgPnLPercent / 50) * 3); // 50%+ avg = max

  const totalScore = earlyEntryScore + contrarianScore + timingScore;
  return Math.min(10, Math.round(totalScore * 10) / 10);
}

/**
 * Insert or update wallet master record
 */
async function upsertWallet(walletData: WalletData, whaleScore: number, insiderScore: number) {
  const { address, positions, trades, totalValue, totalPnL } = walletData;

  const totalVolume = trades.reduce((sum, t) => sum + (t.size * t.price), 0);
  const closedPositions = positions.filter(p => Math.abs(p.pnl) > 0);
  const winningPositions = closedPositions.filter(p => p.pnl > 0);
  const winRate = closedPositions.length > 0 ? winningPositions.length / closedPositions.length : 0;
  const realizedPnL = closedPositions.reduce((sum, p) => sum + p.pnl, 0);
  const unrealizedPnL = totalPnL - realizedPnL;

  // Convert first_seen_at timestamp
  let firstSeenAt = new Date().toISOString();
  if (trades.length > 0) {
    const firstTradeTimestamp = trades[trades.length - 1].timestamp;
    if (typeof firstTradeTimestamp === 'number' || /^\d+$/.test(firstTradeTimestamp)) {
      const timestamp = typeof firstTradeTimestamp === 'number' ? firstTradeTimestamp : parseInt(firstTradeTimestamp);
      const timestampMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
      firstSeenAt = new Date(timestampMs).toISOString();
    } else {
      firstSeenAt = firstTradeTimestamp;
    }
  }

  const walletRecord = {
    wallet_address: address.toLowerCase(),
    wallet_alias: null, // Could fetch from ENS or Polymarket profiles
    is_whale: totalVolume >= 10000, // $10k+ volume = whale
    whale_score: isNaN(whaleScore) ? 0 : whaleScore,
    is_suspected_insider: insiderScore >= 7,
    insider_score: isNaN(insiderScore) ? 0 : insiderScore,
    total_volume_usd: isNaN(totalVolume) ? 0 : totalVolume,
    total_trades: trades.length,
    realized_pnl_usd: isNaN(realizedPnL) ? 0 : realizedPnL,
    unrealized_pnl_usd: isNaN(unrealizedPnL) ? 0 : unrealizedPnL,
    total_pnl_usd: isNaN(totalPnL) ? 0 : totalPnL,
    win_rate: isNaN(winRate) ? 0 : winRate,
    active_positions_count: positions.length,
    last_seen_at: new Date().toISOString(),
    first_seen_at: firstSeenAt,
  };

  const { error } = await supabase
    .from('wallets')
    .upsert(walletRecord, { onConflict: 'wallet_address' });

  if (error) {
    console.error(`Error upserting wallet ${address}:`, error);
    throw error;
  }

  console.log(`✅ Upserted wallet ${address} (whale_score: ${whaleScore}, insider_score: ${insiderScore})`);
}

/**
 * Insert wallet positions (replaces existing)
 */
async function insertPositions(walletAddress: string, positions: PolymarketPosition[]) {
  if (positions.length === 0) {
    console.log('No positions to insert');
    return;
  }

  // Delete existing positions for this wallet
  await supabase
    .from('wallet_positions')
    .delete()
    .eq('wallet_address', walletAddress.toLowerCase());

  // Insert new positions (filter out any without market_id)
  const positionRecords = positions
    .filter(p => p.market && p.market.trim() !== '')
    .map(p => ({
      wallet_address: walletAddress.toLowerCase(),
      market_id: p.market,
      market_title: null, // Could fetch from markets table
      condition_id: null,
      outcome: p.outcome,
      shares: p.size,
      entry_price: null,
      current_price: null,
      position_value_usd: p.value,
      unrealized_pnl_usd: p.pnl,
    }));

  if (positionRecords.length === 0) {
    console.log('No valid positions to insert (all missing market_id)');
    return;
  }

  const { error } = await supabase
    .from('wallet_positions')
    .insert(positionRecords);

  if (error) {
    console.error(`Error inserting positions for ${walletAddress}:`, error);
    throw error;
  }

  console.log(`✅ Inserted ${positions.length} positions for ${walletAddress}`);
}

/**
 * Insert wallet trades (upsert to avoid duplicates)
 */
async function insertTrades(walletAddress: string, trades: PolymarketTrade[]) {
  if (trades.length === 0) {
    console.log('No trades to insert');
    return;
  }

  const tradeRecords = trades
    .filter(t => t.market && t.market.trim() !== '')
    .map(t => {
      // Convert Unix timestamp to ISO string if needed
      let executedAt = t.timestamp;
      if (typeof executedAt === 'number' || /^\d+$/.test(executedAt)) {
        // Unix timestamp in seconds or milliseconds
        const timestamp = typeof executedAt === 'number' ? executedAt : parseInt(executedAt);
        const timestampMs = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
        executedAt = new Date(timestampMs).toISOString();
      }

      return {
        trade_id: t.id,
        wallet_address: walletAddress.toLowerCase(),
        market_id: t.market,
        market_title: null,
        condition_id: null,
        side: t.side,
        outcome: t.outcome,
        shares: t.size,
        price: t.price,
        amount_usd: t.size * t.price,
        executed_at: executedAt,
      };
    });

  if (tradeRecords.length === 0) {
    console.log('No valid trades to insert (all missing market_id)');
    return;
  }

  const { error } = await supabase
    .from('wallet_trades')
    .upsert(tradeRecords, { onConflict: 'trade_id' });

  if (error) {
    console.error(`Error inserting trades for ${walletAddress}:`, error);
    throw error;
  }

  console.log(`✅ Inserted ${trades.length} trades for ${walletAddress}`);
}

/**
 * Process a single wallet: fetch data, calculate scores, insert to DB
 */
async function processWallet(walletAddress: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing wallet: ${walletAddress}`);
  console.log('='.repeat(60));

  try {
    // Fetch all data
    const [positions, trades, totalValue] = await Promise.all([
      fetchWalletPositions(walletAddress),
      fetchWalletTrades(walletAddress),
      fetchWalletValue(walletAddress),
    ]);

    const totalPnL = positions.reduce((sum, p) => sum + (p.pnl || 0), 0) || 0;

    const walletData: WalletData = {
      address: walletAddress,
      positions,
      trades,
      totalValue,
      totalPnL,
    };

    // Calculate scores
    const whaleScore = calculateWhaleScore(walletData);
    const insiderScore = calculateInsiderScore(walletData);

    console.log(`\n📊 Wallet Stats:`);
    console.log(`  - Positions: ${positions.length}`);
    console.log(`  - Trades: ${trades.length}`);
    console.log(`  - Total Value: $${totalValue.toFixed(2)}`);
    console.log(`  - Total PnL: $${totalPnL.toFixed(2)}`);
    console.log(`  - Whale Score: ${whaleScore}/10`);
    console.log(`  - Insider Score: ${insiderScore}/10`);

    // Calculate is_whale status (used by seed script)
    const totalVolume = trades.reduce((sum, t) => sum + (t.size * t.price), 0);
    const is_whale = totalVolume >= 10000; // $10k+ volume = whale

    // Insert to database
    await upsertWallet(walletData, whaleScore, insiderScore);
    await insertPositions(walletAddress, positions);
    await insertTrades(walletAddress, trades);

    console.log(`\n✅ Successfully processed wallet ${walletAddress}`);
    return { success: true, walletAddress, is_whale };
  } catch (error) {
    console.error(`\n❌ Failed to process wallet ${walletAddress}:`, error);
    return { success: false, walletAddress, is_whale: false, error };
  }
}

/**
 * Discover wallet addresses from market holders
 */
async function discoverWallets(limit: number = 20): Promise<string[]> {
  console.log(`\n🔍 Discovering wallets from Polymarket markets...`);

  try {
    // Fetch top markets from Gamma API
    const response = await fetch(`${POLYMARKET_GAMMA_API}/markets?closed=false&limit=10`);
    if (!response.ok) {
      console.error('Failed to fetch markets');
      return [];
    }

    const markets = await response.json();
    const discoveredWallets = new Set<string>(KNOWN_WALLETS);

    // For each market, fetch holders
    for (const market of markets.slice(0, 5)) { // Check top 5 markets
      try {
        const conditionId = market.condition_id;
        if (!conditionId) continue;

        // Fetch holders for this market
        const holdersUrl = `${POLYMARKET_DATA_API}/markets/${conditionId}/holders?limit=${limit}`;
        const holdersResponse = await fetch(holdersUrl);

        if (holdersResponse.ok) {
          const holders = await holdersResponse.json();
          holders.forEach((holder: any) => {
            if (holder.user) {
              discoveredWallets.add(holder.user.toLowerCase());
            }
          });
        }
      } catch (error) {
        console.error(`Error fetching holders for market ${market.condition_id}:`, error);
      }
    }

    const wallets = Array.from(discoveredWallets);
    console.log(`✅ Discovered ${wallets.length} unique wallets`);
    return wallets;
  } catch (error) {
    console.error('Error discovering wallets:', error);
    return KNOWN_WALLETS;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  console.log('\n🚀 Wallet Data Ingestion Script');
  console.log('================================\n');

  let walletsToProcess: string[] = [];

  if (args.includes('--wallet')) {
    // Process single wallet
    const walletIndex = args.indexOf('--wallet');
    const wallet = args[walletIndex + 1];
    if (wallet && wallet.startsWith('0x')) {
      walletsToProcess = [wallet];
    } else {
      console.error('Invalid wallet address. Usage: --wallet 0x...');
      process.exit(1);
    }
  } else if (args.includes('--discover')) {
    // Discover wallets from markets
    const limit = args.includes('--limit')
      ? parseInt(args[args.indexOf('--limit') + 1])
      : 20;
    walletsToProcess = await discoverWallets(limit);
  } else {
    // Default: process known wallets
    walletsToProcess = KNOWN_WALLETS;
  }

  console.log(`\n📋 Processing ${walletsToProcess.length} wallet(s)...\n`);

  const results = [];
  for (const wallet of walletsToProcess) {
    const result = await processWallet(wallet);
    results.push(result);

    // Rate limiting: wait 1 second between wallets
    if (walletsToProcess.indexOf(wallet) < walletsToProcess.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 INGESTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Total Processed: ${results.length}`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n❌ Failed wallets:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.walletAddress}`);
    });
  }

  console.log('\n✅ Data ingestion complete!\n');
}

// Run if executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { processWallet, discoverWallets, calculateWhaleScore, calculateInsiderScore };
