/**
 * Wallet Position Monitoring Service
 *
 * Tracks open positions for all 548 signal wallets (coverage ≥2%).
 * Periodically fetches positions from Polymarket Data-API and stores them in database.
 *
 * Core Product Loop:
 * 1. Signal wallets (audited_wallet_pnl_extended.json) → trusted wallet set
 * 2. Monitor their positions → detect entries/exits
 * 3. Apply escalation rules → populate strategy watchlists
 * 4. Generate alerts → notify users
 *
 * Key Features:
 * - Batch processing with rate limiting
 * - Incremental updates (only changed positions)
 * - Entry/exit event detection
 * - Database persistence
 * - Error handling and retry logic
 */

import { createClient } from '@supabase/supabase-js'
import { getSignalWallets, getSignalWalletCount } from '@/lib/data/wallet-signal-set'
import { processPositionEntry } from '@/lib/services/watchlist-auto-populate'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface WalletPosition {
  wallet_address: string
  market_id: string
  market_title: string
  condition_id?: string
  outcome: 'YES' | 'NO'
  shares: number
  entry_price: number
  current_price: number
  position_value_usd: number
  unrealized_pnl_usd: number
  opened_at?: string
  raw_data: any
}

interface PositionChange {
  type: 'ENTERED' | 'EXITED' | 'UPDATED'
  wallet_address: string
  market_id: string
  outcome: string
  position?: WalletPosition
}

/**
 * Fetch positions for a single wallet from Polymarket Data-API
 */
async function fetchWalletPositions(
  walletAddress: string
): Promise<WalletPosition[]> {
  try {
    const response = await fetch(
      `https://data-api.polymarket.com/positions?user=${walletAddress}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Cascadian-Intelligence/1.0',
        },
        // Timeout after 10 seconds
        signal: AbortSignal.timeout(10000),
      }
    )

    if (!response.ok) {
      throw new Error(
        `Data-API error for ${walletAddress}: ${response.status} ${response.statusText}`
      )
    }

    const positions = await response.json()

    if (!Array.isArray(positions)) {
      return []
    }

    // Transform to our schema
    return positions
      .filter((pos: any) => pos.size > 0) // Only open positions
      .map((pos: any) => ({
        wallet_address: walletAddress,
        market_id: pos.market || pos.marketId || pos.id,
        market_title: pos.title || pos.slug || 'Unknown',
        condition_id: pos.conditionId || pos.condition_id,
        outcome: (pos.outcome || 'YES').toUpperCase() as 'YES' | 'NO',
        shares: parseFloat(pos.size || pos.shares || 0),
        entry_price: parseFloat(pos.avgPrice || pos.entry_price || 0),
        current_price: parseFloat(pos.curPrice || pos.current_price || 0),
        position_value_usd: parseFloat(
          pos.currentValue || pos.position_value_usd || 0
        ),
        unrealized_pnl_usd: parseFloat(pos.cashPnl || pos.unrealized_pnl_usd || 0),
        opened_at: pos.opened_at || pos.createdAt,
        raw_data: pos,
      }))
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') {
      console.error(`⏱️  Timeout fetching positions for ${walletAddress}`)
    } else {
      console.error(`❌ Error fetching positions for ${walletAddress}:`, error)
    }
    return []
  }
}

/**
 * Sync positions for a single wallet to database
 * Returns changes detected (entries/exits)
 */
async function syncWalletPositions(
  supabase: any,
  walletAddress: string
): Promise<PositionChange[]> {
  const changes: PositionChange[] = []

  // Fetch current positions from API
  const apiPositions = await fetchWalletPositions(walletAddress)

  // Fetch existing positions from database
  const { data: dbPositions, error: fetchError } = await supabase
    .from('wallet_positions')
    .select('market_id, outcome')
    .eq('wallet_address', walletAddress)

  if (fetchError) {
    console.error(`Error fetching DB positions for ${walletAddress}:`, fetchError)
    return []
  }

  // Create lookup maps
  const apiMap = new Map(
    apiPositions.map((p) => [`${p.market_id}:${p.outcome}`, p])
  )
  const dbMap = new Set(
    ((dbPositions || []) as Array<{ market_id: string; outcome: string }>).map((p) => `${p.market_id}:${p.outcome}`)
  )

  // Detect entries (in API but not in DB)
  for (const [key, position] of apiMap) {
    if (!dbMap.has(key)) {
      changes.push({
        type: 'ENTERED',
        wallet_address: walletAddress,
        market_id: position.market_id,
        outcome: position.outcome,
        position,
      })

      // Auto-populate strategy watchlists when signal wallet enters position
      try {
        await processPositionEntry(
          walletAddress,
          position.market_id,
          position.market_title,
          position.outcome,
          {
            condition_id: position.condition_id,
            shares: position.shares,
            entry_price: position.entry_price,
            position_value_usd: position.position_value_usd,
          }
        )
      } catch (error) {
        console.error(
          `Error auto-populating watchlist for ${position.market_id}:`,
          error
        )
      }
    }
  }

  // Detect exits (in DB but not in API)
  for (const key of dbMap) {
    if (!apiMap.has(key)) {
      const [market_id, outcome] = key.split(':')
      changes.push({
        type: 'EXITED',
        wallet_address: walletAddress,
        market_id,
        outcome,
      })
    }
  }

  // Upsert all API positions (inserts new, updates existing)
  if (apiPositions.length > 0) {
    const { error: upsertError } = await supabase
      .from('wallet_positions')
      .upsert(
        apiPositions.map((p) => ({
          wallet_address: p.wallet_address,
          market_id: p.market_id,
          market_title: p.market_title,
          condition_id: p.condition_id,
          outcome: p.outcome,
          shares: p.shares,
          entry_price: p.entry_price,
          current_price: p.current_price,
          position_value_usd: p.position_value_usd,
          unrealized_pnl_usd: p.unrealized_pnl_usd,
          opened_at: p.opened_at,
          last_updated: new Date().toISOString(),
          raw_data: p.raw_data,
        })) as any,
        {
          onConflict: 'wallet_address,market_id,outcome',
          ignoreDuplicates: false,
        }
      )

    if (upsertError) {
      console.error(`Error upserting positions for ${walletAddress}:`, upsertError)
    }
  }

  // Delete exited positions from database
  for (const change of changes) {
    if (change.type === 'EXITED') {
      await supabase
        .from('wallet_positions')
        .delete()
        .eq('wallet_address', walletAddress)
        .eq('market_id', change.market_id)
        .eq('outcome', change.outcome)
    }
  }

  return changes
}

/**
 * Monitor all signal wallets and sync their positions
 *
 * @param options.batchSize - Number of wallets to process in parallel (default: 5)
 * @param options.delayMs - Delay between batches in milliseconds (default: 1000)
 * @param options.onProgress - Callback for progress updates
 * @returns Total changes detected
 */
export async function monitorAllSignalWallets(options: {
  batchSize?: number
  delayMs?: number
  onProgress?: (processed: number, total: number, changes: number) => void
} = {}) {
  const { batchSize = 5, delayMs = 1000, onProgress } = options

  const supabase = createClient(supabaseUrl, supabaseKey)
  const signalWallets = getSignalWallets()
  const total = signalWallets.length

  console.log(`\n🔍 Starting wallet position monitoring...`)
  console.log(`📊 Monitoring ${total} signal wallets`)
  console.log(`⚙️  Batch size: ${batchSize}, Delay: ${delayMs}ms\n`)

  let processed = 0
  let totalChanges = 0
  const allChanges: PositionChange[] = []

  // Process in batches
  for (let i = 0; i < signalWallets.length; i += batchSize) {
    const batch = signalWallets.slice(i, i + batchSize)

    // Process batch in parallel
    const batchChanges = await Promise.all(
      batch.map((wallet) => syncWalletPositions(supabase, wallet.address))
    )

    // Flatten and collect changes
    const changes = batchChanges.flat()
    allChanges.push(...changes)
    totalChanges += changes.length
    processed += batch.length

    // Report progress
    if (onProgress) {
      onProgress(processed, total, totalChanges)
    }

    // Log progress
    if (changes.length > 0) {
      console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}: ${changes.length} changes detected`)
    }

    // Delay before next batch (rate limiting)
    if (i + batchSize < signalWallets.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  console.log(`\n✨ Monitoring complete!`)
  console.log(`📊 Processed: ${processed}/${total} wallets`)
  console.log(`🔄 Changes detected: ${totalChanges}`)
  console.log(`  ├─ Entries: ${allChanges.filter((c) => c.type === 'ENTERED').length}`)
  console.log(`  └─ Exits: ${allChanges.filter((c) => c.type === 'EXITED').length}`)

  return {
    processed,
    total,
    totalChanges,
    changes: allChanges,
  }
}

/**
 * Monitor positions for specific wallets (subset)
 */
export async function monitorWallets(walletAddresses: string[]) {
  const supabase = createClient(supabaseUrl, supabaseKey)
  const allChanges: PositionChange[] = []

  for (const address of walletAddresses) {
    const changes = await syncWalletPositions(supabase, address)
    allChanges.push(...changes)
  }

  return allChanges
}

/**
 * Get current position count for all signal wallets
 */
export async function getSignalWalletPositionStats() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('wallet_positions')
    .select('wallet_address, market_id, unrealized_pnl_usd')

  if (error) {
    console.error('Error fetching position stats:', error)
    return null
  }

  const walletCount = new Set(data.map((p) => p.wallet_address)).size
  const marketCount = new Set(data.map((p) => p.market_id)).size
  const totalPositions = data.length
  const totalPnL = data.reduce((sum, p) => sum + (p.unrealized_pnl_usd || 0), 0)

  return {
    walletCount,
    marketCount,
    totalPositions,
    totalPnL,
  }
}

/**
 * Get all active markets from signal wallets
 * (markets where at least one signal wallet has an open position)
 */
export async function getActiveMarketsFromSignalWallets() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data, error } = await supabase
    .from('wallet_positions')
    .select('market_id, market_title, outcome, wallet_address')
    .order('market_id')

  if (error) {
    console.error('Error fetching active markets:', error)
    return []
  }

  // Group by market
  const marketMap = new Map<string, {
    market_id: string
    market_title: string
    wallets: string[]
    yes_wallets: string[]
    no_wallets: string[]
  }>()

  for (const pos of data) {
    if (!marketMap.has(pos.market_id)) {
      marketMap.set(pos.market_id, {
        market_id: pos.market_id,
        market_title: pos.market_title,
        wallets: [],
        yes_wallets: [],
        no_wallets: [],
      })
    }

    const market = marketMap.get(pos.market_id)!
    if (!market.wallets.includes(pos.wallet_address)) {
      market.wallets.push(pos.wallet_address)
    }

    if (pos.outcome === 'YES' && !market.yes_wallets.includes(pos.wallet_address)) {
      market.yes_wallets.push(pos.wallet_address)
    } else if (pos.outcome === 'NO' && !market.no_wallets.includes(pos.wallet_address)) {
      market.no_wallets.push(pos.wallet_address)
    }
  }

  return Array.from(marketMap.values()).sort((a, b) => b.wallets.length - a.wallets.length)
}
