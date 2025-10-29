import { orderbookClient } from '../lib/goldsky/client'
import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

interface EnhancedWalletStats extends WalletStats {
  firstTradeTimestamp: string
  lastTradeTimestamp: string
  daysSinceFirstTrade: number
  daysSinceLastTrade: number
  isActiveIn4Months: boolean
  isActiveIn6Months: boolean
  isActiveIn1Year: boolean
}

const INPUT_FILE = 'runtime/wallets_10k_10trades.json'
const OUTPUT_FILE = 'runtime/wallets_with_timestamps.json'
const CHECKPOINT_FILE = 'runtime/backfill_checkpoint.json'
const BATCH_SIZE = 5 // Small batch to avoid overloading
const DELAY_BETWEEN_BATCHES = 1000 // 1 second between batches
const CHECKPOINT_INTERVAL = 100 // Save every 100 wallets
const MAX_RETRIES = 3

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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWalletTimestampsWithRetry(wallet: string, retries = 0): Promise<{ first: string, last: string } | null> {
  try {
    const data = await orderbookClient.request<{
      first: Array<{ timestamp: string }>
      last: Array<{ timestamp: string }>
    }>(GET_FIRST_LAST_TRADE, { wallet: wallet.toLowerCase() })

    if (!data.first[0] || !data.last[0]) {
      return null
    }

    return {
      first: data.first[0].timestamp,
      last: data.last[0].timestamp
    }
  } catch (error: any) {
    const errorMsg = error.message || String(error)

    // Check if it's a timeout or rate limit error
    if ((errorMsg.includes('timeout') || errorMsg.includes('502') || errorMsg.includes('503')) && retries < MAX_RETRIES) {
      const backoffDelay = Math.pow(2, retries) * 1000 // Exponential backoff: 1s, 2s, 4s
      console.log(`⏳ Retry ${retries + 1}/${MAX_RETRIES} for ${wallet} after ${backoffDelay}ms`)
      await sleep(backoffDelay)
      return fetchWalletTimestampsWithRetry(wallet, retries + 1)
    }

    return null
  }
}

async function backfillTimestamps() {
  console.log('🔄 Improved Backfill with Rate Limiting\n')

  // Load input wallets
  const input = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'))
  const wallets: WalletStats[] = input.wallets

  console.log(`📊 Total wallets: ${wallets.length.toLocaleString()}`)
  console.log(`⚡ Batch size: ${BATCH_SIZE}`)
  console.log(`⏱️  Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`)
  console.log(`💾 Checkpoint every: ${CHECKPOINT_INTERVAL} wallets\n`)

  // Load checkpoint if exists
  let startIndex = 0
  let enhancedWallets: EnhancedWalletStats[] = []

  if (fs.existsSync(CHECKPOINT_FILE)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
    startIndex = checkpoint.lastIndex + 1
    enhancedWallets = checkpoint.wallets
    console.log(`📂 Resuming from checkpoint: ${startIndex.toLocaleString()}/${wallets.length.toLocaleString()}\n`)
  }

  const now = Date.now() / 1000
  const fourMonthsAgo = now - (4 * 30 * 24 * 60 * 60)
  const sixMonthsAgo = now - (6 * 30 * 24 * 60 * 60)
  const oneYearAgo = now - (365 * 24 * 60 * 60)

  let processed = startIndex
  let errors = 0
  let timeouts = 0
  const startTime = Date.now()

  // Process in batches
  for (let i = startIndex; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)

    const results = await Promise.all(
      batch.map(async (wallet) => {
        const timestamps = await fetchWalletTimestampsWithRetry(wallet.wallet)

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
          isActiveIn6Months: lastTs >= sixMonthsAgo,
          isActiveIn1Year: lastTs >= oneYearAgo
        } as EnhancedWalletStats
      })
    )

    enhancedWallets.push(...results.filter(r => r !== null) as EnhancedWalletStats[])

    processed += batch.length
    const progress = (100 * processed / wallets.length).toFixed(2)
    const elapsed = (Date.now() - startTime) / 1000
    const rate = (processed - startIndex) / elapsed
    const remaining = (wallets.length - processed) / rate
    const successful = enhancedWallets.length - (startIndex > 0 ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8')).wallets.length : 0)
    const successRate = (100 * successful / (processed - startIndex)).toFixed(1)

    console.log(
      `📈 ${processed.toLocaleString()}/${wallets.length.toLocaleString()} (${progress}%) | ` +
      `Rate: ${rate.toFixed(1)}/sec | Success: ${successRate}% | ` +
      `ETA: ${(remaining / 60).toFixed(0)}min | Errors: ${errors}`
    )

    // Checkpoint
    if (processed % CHECKPOINT_INTERVAL === 0) {
      const checkpoint = {
        lastIndex: i + batch.length - 1,
        processedAt: new Date().toISOString(),
        wallets: enhancedWallets
      }
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint))
      console.log(`💾 Checkpoint saved (${enhancedWallets.length.toLocaleString()} wallets)\n`)
    }

    // Delay between batches
    await sleep(DELAY_BETWEEN_BATCHES)
  }

  // Final output
  const active4mo = enhancedWallets.filter(w => w.isActiveIn4Months).length
  const active6mo = enhancedWallets.filter(w => w.isActiveIn6Months).length
  const active1yr = enhancedWallets.filter(w => w.isActiveIn1Year).length

  const output = {
    processedAt: new Date().toISOString(),
    totalWallets: enhancedWallets.length,
    errors,
    summary: {
      total: enhancedWallets.length,
      activeIn4Months: active4mo,
      activeIn6Months: active6mo,
      activeIn1Year: active1yr,
      over10k: enhancedWallets.filter(w => w.totalVolume >= 10000).length,
      over10kAnd4MonthsActive: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.isActiveIn4Months
      ).length,
      over10kAnd6MonthsActive: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.isActiveIn6Months
      ).length,
      over10kAnd1YearActive: enhancedWallets.filter(w =>
        w.totalVolume >= 10000 && w.isActiveIn1Year
      ).length
    },
    wallets: enhancedWallets
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2))
  console.log(`\n✅ Complete! Enhanced wallet data saved to ${OUTPUT_FILE}`)
  console.log(`\n📊 Final Summary:`)
  console.log(`   Total wallets: ${output.summary.total.toLocaleString()}`)
  console.log(`   Active in 4 months: ${active4mo.toLocaleString()} (${(100*active4mo/output.summary.total).toFixed(2)}%)`)
  console.log(`   Active in 6 months: ${active6mo.toLocaleString()} (${(100*active6mo/output.summary.total).toFixed(2)}%)`)
  console.log(`   Active in 1 year: ${active1yr.toLocaleString()} (${(100*active1yr/output.summary.total).toFixed(2)}%)`)
  console.log(`   ≥$10k + 4mo active: ${output.summary.over10kAnd4MonthsActive.toLocaleString()}`)
  console.log(`   ≥$10k + 6mo active: ${output.summary.over10kAnd6MonthsActive.toLocaleString()}`)
  console.log(`   ≥$10k + 1yr active: ${output.summary.over10kAnd1YearActive.toLocaleString()}`)
  console.log(`   Errors: ${errors}`)

  // CSV export
  const csvLines = ['wallet,totalVolume,numTrades,lastTrade,daysSinceLast,active4mo,active6mo,active1yr']
  enhancedWallets.forEach(w => {
    csvLines.push([
      w.wallet,
      w.totalVolume.toFixed(2),
      w.numTrades,
      w.lastTradeTimestamp,
      w.daysSinceLastTrade,
      w.isActiveIn4Months ? '1' : '0',
      w.isActiveIn6Months ? '1' : '0',
      w.isActiveIn1Year ? '1' : '0'
    ].join(','))
  })
  fs.writeFileSync(OUTPUT_FILE.replace('.json', '.csv'), csvLines.join('\n'))
  console.log(`\n📄 CSV saved to ${OUTPUT_FILE.replace('.json', '.csv')}`)
}

backfillTimestamps().catch(console.error)
