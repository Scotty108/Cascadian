import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { fetchAllWalletTrades, resolveTokenId, OrderFilledEvent } from '@/lib/goldsky/client'
import { clickhouse } from '@/lib/clickhouse/client'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ProcessedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  timestamp: Date
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
}

// Cache for condition -> market_id mapping
const conditionToMarketCache = new Map<string, string>()

// Cache for token ID -> condition mapping
const tokenIdCache = new Map<string, { condition: string; outcome: number }>()

async function resolveConditionToMarket(conditionId: string): Promise<string | null> {
  // Check cache
  if (conditionToMarketCache.has(conditionId)) {
    return conditionToMarketCache.get(conditionId)!
  }

  // Query Supabase for market with this condition
  const { data, error } = await supabase
    .from('markets')
    .select('market_id')
    .eq('condition_id', conditionId)
    .single()

  if (error || !data) {
    console.warn(`   ⚠️  No market found for condition ${conditionId}`)
    return null
  }

  conditionToMarketCache.set(conditionId, data.market_id)
  return data.market_id
}

async function resolveTokenIdToCondition(
  tokenId: string
): Promise<{ condition: string; outcome: number } | null> {
  // Check cache
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  // Token ID "0" is USDC collateral, not an outcome token
  if (tokenId === '0') {
    return null
  }

  // Query Goldsky positions subgraph
  const tokenInfo = await resolveTokenId(tokenId)

  if (!tokenInfo) {
    console.warn(`   ⚠️  Could not resolve token ID ${tokenId}`)
    return null
  }

  const result = {
    condition: tokenInfo.condition.id,
    outcome: parseInt(tokenInfo.outcomeIndex),
  }

  tokenIdCache.set(tokenId, result)
  return result
}

async function processTradeForWallet(
  trade: OrderFilledEvent,
  walletAddress: string
): Promise<ProcessedTrade | null> {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    // Determine which asset is the outcome token (not USDC)
    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      // Both are USDC? Skip
      console.warn(`   ⚠️  Trade ${trade.id} has no outcome token, skipping`)
      return null
    }

    // Get token ID and resolve to condition
    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId
    const tokenInfo = await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    // Resolve condition to market
    const marketId = await resolveConditionToMarket(tokenInfo.condition)

    if (!marketId) {
      return null
    }

    // Calculate amounts and side
    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6 // USDC has 6 decimals
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let side: 'YES' | 'NO'
    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      // Wallet is maker
      if (makerIsToken) {
        // Maker gave tokens, received USDC - this is a SELL
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        // Selling means exiting a position, need to track differently
        // For now, treat as opposite side trade
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Maker gave USDC, received tokens - this is a BUY
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    } else {
      // Wallet is taker
      if (takerIsToken) {
        // Taker gave tokens, received USDC - this is a SELL
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Taker gave USDC, received tokens - this is a BUY
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    }

    return {
      trade_id: trade.id,
      wallet_address: walletAddress,
      market_id: marketId,
      timestamp: new Date(parseInt(trade.timestamp) * 1000),
      side,
      entry_price: price,
      shares,
      usd_value: usdValue,
      transaction_hash: trade.transactionHash,
      is_closed: false, // We'll update this later when we track position lifecycle
    }
  } catch (error) {
    console.error(`   ❌ Error processing trade ${trade.id}:`, error)
    return null
  }
}

async function insertTradesIntoClickHouse(trades: ProcessedTrade[]) {
  if (trades.length === 0) {
    console.log('   No trades to insert')
    return
  }

  console.log(`   📥 Inserting ${trades.length} trades into ClickHouse...`)

  try {
    await clickhouse.insert({
      table: 'trades_raw',
      values: trades.map((t) => ({
        trade_id: t.trade_id,
        wallet_address: t.wallet_address,
        market_id: t.market_id,
        timestamp: Math.floor(t.timestamp.getTime() / 1000),
        side: t.side,
        entry_price: t.entry_price,
        exit_price: null,
        shares: t.shares,
        usd_value: t.usd_value,
        pnl: null,
        is_closed: t.is_closed,
        transaction_hash: t.transaction_hash,
        created_at: Math.floor(Date.now() / 1000),
      })),
      format: 'JSONEachRow',
    })

    console.log(`   ✅ Inserted ${trades.length} trades successfully`)
  } catch (error) {
    console.error('   ❌ Failed to insert trades:', error)
    throw error
  }
}

export async function syncWalletTrades(walletAddress: string): Promise<number> {
  console.log(`\n🔄 Syncing trades for wallet: ${walletAddress}`)

  // Fetch all trades
  console.log('   📡 Fetching trades from Goldsky...')
  const trades = await fetchAllWalletTrades(walletAddress)
  console.log(`   ✅ Fetched ${trades.length} raw trade events`)

  if (trades.length === 0) {
    console.log('   No trades found for this wallet')
    return 0
  }

  // Process trades
  console.log('   🔄 Processing trades...')
  const processedTrades: ProcessedTrade[] = []

  for (const trade of trades) {
    const processed = await processTradeForWallet(trade, walletAddress)
    if (processed) {
      processedTrades.push(processed)
    }
  }

  console.log(`   ✅ Processed ${processedTrades.length} valid trades`)

  // Insert into ClickHouse
  await insertTradesIntoClickHouse(processedTrades)

  return processedTrades.length
}

async function main() {
  const wallets = process.argv.slice(2)

  if (wallets.length === 0) {
    console.log('Usage: npx tsx scripts/sync-wallet-trades.ts <wallet1> <wallet2> ...')
    console.log('\nExample:')
    console.log('  npx tsx scripts/sync-wallet-trades.ts 0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
    process.exit(1)
  }

  console.log('🚀 Starting wallet trade sync...\n')
  console.log(`Syncing ${wallets.length} wallet(s)`)

  let totalTrades = 0

  for (const wallet of wallets) {
    try {
      const count = await syncWalletTrades(wallet)
      totalTrades += count
    } catch (error) {
      console.error(`\n❌ Failed to sync ${wallet}:`, error)
    }
  }

  console.log(`\n\n✅ Sync complete!`)
  console.log(`   Total trades synced: ${totalTrades}`)
  console.log(`\n📊 Next steps:`)
  console.log(`   1. Verify data: npx tsx scripts/verify-clickhouse-data.ts`)
  console.log(`   2. Calculate metrics: npx tsx scripts/calculate-wallet-metrics.ts`)
}

main()
