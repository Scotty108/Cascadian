import { orderbookClient } from '../lib/goldsky/client'
import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
  firstTradeTimestamp?: string
  lastTradeTimestamp?: string
}

interface EnhancedWalletStats extends WalletStats {
  firstTradeTimestamp: string
  lastTradeTimestamp: string
  daysSinceFirstTrade: number
  daysSinceLastTrade: number
  isActiveIn4Months: boolean
  isActiveIn6Months: boolean
}

const CHECKPOINT_FILE = 'runtime/discover-orderbook.checkpoint.json'
const OUTPUT_FILE = 'runtime/wallets_with_timestamps.json'
const BATCH_SIZE = 50 // Parallel requests
const CHECKPOINT_INTERVAL = 1000 // Save progress every 1k wallets

const GET_FIRST_LAST_TRADE = `
  query GetFirstLastTrade($wallet: String!) {
    first: orderFilledEvents(
      where: { or: [{ maker: $wallet }, { taker: $wallet }] }
      first: 1
      orderBy: timestamp
      orderDirection: asc
    ) {
      timestamp
    }
    last: orderFilledEvents(
      where: { or: [{ maker: $wallet }, { taker: $wallet }] }
      first: 1
      orderBy: timestamp
      orderDirection: desc
    ) {
      timestamp
    }
  }
`

async function fetchWalletTimestamps(wallet: string): Promise<{ first: string, last: string } | null> {
  try {
    const data = await orderbookClient.request<{
      first: Array<{ timestamp: string }>
      last: Array<{ timestamp: string }>
    }>(GET_FIRST_LAST_TRADE, { wallet: wallet.toLowerCase() })

    if (!data.first[0] || !data.last[0]) {
      console.warn(`⚠️  No trades found for ${wallet}`)
      return null
    }

    return {
      first: data.first[0].timestamp,
      last: data.last[0].timestamp
    }
  } catch (error: any) {
    console.error(`❌ Error fetching timestamps for ${wallet}:`, error.message)
    return null
  }
}

async function backfillTimestamps() {
  console.log('🔄 Backfilling wallet timestamps from Goldsky orderbook\n')

  // Load discovered wallets
  const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
  const walletStats: Record<string, WalletStats> = checkpoint.walletStats

  const wallets = Object.values(walletStats)
  const total = wallets.length

  console.log(`📊 Total wallets to process: ${total.toLocaleString()}`)
  console.log(`⚡ Batch size: ${BATCH_SIZE} parallel requests\n`)

  const now = Date.now() / 1000
  const fourMonthsAgo = now - (4 * 30 * 24 * 60 * 60)
  const sixMonthsAgo = now - (6 * 30 * 24 * 60 * 60)

  const enhancedWallets: EnhancedWalletStats[] = []
  let processed = 0
  let errors = 0

  const startTime = Date.now()

  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (wallet) => {
        const timestamps = await fetchWalletTimestamps(wallet.wallet)

        if (!timestamps) {
          errors++
          return null
        }

        const firstTs = parseInt(timestamps.first)
        const lastTs = parseInt(timestamps.last)

        return {
          ...wallet,
          firstTradeTimestamp: timestamps.first,
          lastTradeTimestamp: timestamps.last,
          daysSinceFirstTrade: Math.floor((now - firstTs) / (24 * 60 * 60)),
          daysSinceLastTrade: Math.floor((now - lastTs) / (24 * 60 * 60)),
          isActiveIn4Months: lastTs >= fourMonthsAgo,
          isActiveIn6Months: lastTs >= sixMonthsAgo
        } as EnhancedWalletStats
      })
    )

    // Filter out nulls
    enhancedWallets.push(...results.filter(r => r !== null) as EnhancedWalletStats[])

    processed += batch.length
    const progress = (100 * processed / total).toFixed(2)
    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const remaining = (total - processed) / rate

    console.log(`📈 Progress: ${processed.toLocaleString()}/${total.toLocaleString()} (${progress}%) | ` +
      `Rate: ${rate.toFixed(1)}/sec | ETA: ${(remaining / 60).toFixed(1)} min | Errors: ${errors}`)

    // Checkpoint every N wallets
    if (processed % CHECKPOINT_INTERVAL === 0) {
      fs.writeFileSync(OUTPUT_FILE + '.tmp', JSON.stringify({
        processedAt: new Date().toISOString(),
        totalWallets: enhancedWallets.length,
        wallets: enhancedWallets
      }, null, 2))
      console.log(`💾 Checkpoint saved (${enhancedWallets.length} wallets)`)
    }
  }

  // Final save
  const output = {
    processedAt: new Date().toISOString(),
    totalWallets: enhancedWallets.length,
    errors,
    summary: {
      total: enhancedWallets.length,
      activeIn4Months: enhancedWallets.filter(w => w.isActiveIn4Months).length,
      activeIn6Months: enhancedWallets.filter(w => w.isActiveIn6Months).length,
      over10k: enhancedWallets.filter(w => w.totalVolume >= 10000).length,
      over10kAnd4MonthsActive: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.isActiveIn4Months
      ).length,
      over10kAnd5Trades: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.numTrades > 5
      ).length,
      over10kAnd5TradesAnd4Months: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.numTrades > 5 && w.isActiveIn4Months
      ).length
    },
    wallets: enhancedWallets
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
  console.log(`\n✅ Complete! Enhanced wallet data saved to ${OUTPUT_FILE}`)
  console.log(`\n📊 Summary:`)
  console.log(`   Total wallets: ${output.summary.total.toLocaleString()}`)
  console.log(`   Active in 4 months: ${output.summary.activeIn4Months.toLocaleString()} (${(100*output.summary.activeIn4Months/output.summary.total).toFixed(2)}%)`)
  console.log(`   Active in 6 months: ${output.summary.activeIn6Months.toLocaleString()} (${(100*output.summary.activeIn6Months/output.summary.total).toFixed(2)}%)`)
  console.log(`   ≥$10k volume: ${output.summary.over10k.toLocaleString()}`)
  console.log(`   ≥$10k + 4mo active: ${output.summary.over10kAnd4MonthsActive.toLocaleString()}`)
  console.log(`   ≥$10k + >5 trades: ${output.summary.over10kAnd5Trades.toLocaleString()}`)
  console.log(`   ≥$10k + >5 trades + 4mo active: ${output.summary.over10kAnd5TradesAnd4Months.toLocaleString()}`)
  console.log(`   Errors: ${errors}`)

  // Create CSV for easy analysis
  const csvLines = [
    'wallet,totalVolume,numTrades,firstTrade,lastTrade,daysSinceFirst,daysSinceLast,activeIn4Mo,activeIn6Mo'
  ]

  enhancedWallets.forEach(w => {
    csvLines.push([
      w.wallet,
      w.totalVolume.toFixed(2),
      w.numTrades,
      w.firstTradeTimestamp,
      w.lastTradeTimestamp,
      w.daysSinceFirstTrade,
      w.daysSinceLastTrade,
      w.isActiveIn4Months,
      w.isActiveIn6Months
    ].join(','))
  })

  fs.writeFileSync(OUTPUT_FILE.replace('.json', '.csv'), csvLines.join('\n'))
  console.log(`\n📄 CSV saved to ${OUTPUT_FILE.replace('.json', '.csv')}`)
}

backfillTimestamps().catch(console.error)
