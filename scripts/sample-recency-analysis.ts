import { orderbookClient } from '../lib/goldsky/client'
import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

const SAMPLE_SIZE = 500 // Sample 500 wallets for statistical confidence
const BATCH_SIZE = 10 // Smaller batch to avoid rate limits

const GET_LAST_TRADE = `
  query GetLastTrade($wallet: String!) {
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

async function fetchLastTrade(wallet: string): Promise<number | null> {
  try {
    const data = await orderbookClient.request<{
      last: Array<{ timestamp: string }>
    }>(GET_LAST_TRADE, { wallet: wallet.toLowerCase() })

    if (!data.last[0]) return null
    return parseInt(data.last[0].timestamp)
  } catch (error: any) {
    console.error(`❌ Error for ${wallet}: ${error.message.split('\n')[0]}`)
    return null
  }
}

async function runSample() {
  console.log('📊 Sample Recency Analysis\n')
  console.log('='.repeat(70))

  // Load the 65k wallets (≥$10k + >10 trades)
  const data = JSON.parse(fs.readFileSync('runtime/wallets_10k_10trades.json', 'utf-8'))
  const allWallets: WalletStats[] = data.wallets

  console.log(`\nTotal wallets: ${allWallets.length.toLocaleString()}`)
  console.log(`Sample size: ${SAMPLE_SIZE}\n`)

  // Random sample
  const shuffled = [...allWallets].sort(() => Math.random() - 0.5)
  const sample = shuffled.slice(0, SAMPLE_SIZE)

  console.log('🔄 Fetching last trade timestamps...\n')

  const now = Date.now() / 1000
  const sixMonthsAgo = now - (6 * 30 * 24 * 60 * 60)
  const oneYearAgo = now - (365 * 24 * 60 * 60)

  let processed = 0
  let errors = 0
  const results: Array<{ wallet: string; lastTrade: number }> = []

  // Process in batches
  for (let i = 0; i < sample.length; i += BATCH_SIZE) {
    const batch = sample.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.all(
      batch.map(async (w) => {
        const lastTrade = await fetchLastTrade(w.wallet)
        if (lastTrade === null) {
          errors++
          return null
        }
        return { wallet: w.wallet, lastTrade }
      })
    )

    results.push(...batchResults.filter(r => r !== null) as Array<{ wallet: string; lastTrade: number }>)

    processed += batch.length
    const progress = (100 * processed / sample.length).toFixed(1)
    const successRate = (100 * results.length / processed).toFixed(1)

    console.log(`Progress: ${processed}/${sample.length} (${progress}%) | Success: ${successRate}% | Errors: ${errors}`)

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  console.log('\n' + '='.repeat(70))
  console.log('\n📊 SAMPLE RESULTS\n')

  const successful = results.length
  const active6mo = results.filter(r => r.lastTrade >= sixMonthsAgo).length
  const active1yr = results.filter(r => r.lastTrade >= oneYearAgo).length

  const pct6mo = (100 * active6mo / successful).toFixed(2)
  const pct1yr = (100 * active1yr / successful).toFixed(2)

  console.log(`Sample analyzed: ${successful} wallets`)
  console.log(`Errors/skipped: ${errors}\n`)

  console.log('Activity Results:')
  console.log(`  Active in last 6 months: ${active6mo} (${pct6mo}%)`)
  console.log(`  Active in last 1 year:   ${active1yr} (${pct1yr}%)`)

  console.log('\n📈 EXTRAPOLATED ESTIMATES (for all 65,030 wallets)\n')

  const est6mo = Math.round(allWallets.length * (active6mo / successful))
  const est1yr = Math.round(allWallets.length * (active1yr / successful))

  console.log(`Estimated active in 6 months: ${est6mo.toLocaleString()} wallets`)
  console.log(`Estimated active in 1 year:   ${est1yr.toLocaleString()} wallets`)

  // Confidence interval (95% - rough estimate)
  const marginOfError = Math.round(1.96 * Math.sqrt((active6mo / successful) * (1 - active6mo / successful) / successful) * allWallets.length)

  console.log(`\n📊 Confidence Interval (6-month estimate):`)
  console.log(`  Range: ${(est6mo - marginOfError).toLocaleString()} - ${(est6mo + marginOfError).toLocaleString()} wallets`)
  console.log(`  (95% confidence level)`)

  // Save sample results
  const output = {
    sampleSize: successful,
    errors,
    totalPopulation: allWallets.length,
    results: {
      active6months: {
        sample: active6mo,
        percentage: parseFloat(pct6mo),
        estimated: est6mo,
        marginOfError
      },
      active1year: {
        sample: active1yr,
        percentage: parseFloat(pct1yr),
        estimated: est1yr
      }
    },
    sampleData: results
  }

  fs.writeFileSync('runtime/recency_sample_results.json', JSON.stringify(output, null, 2))
  console.log('\n💾 Sample results saved: runtime/recency_sample_results.json')

  console.log('\n' + '='.repeat(70))
  console.log('\n💡 RECOMMENDATION:\n')
  console.log(`Based on this sample, you can expect approximately:`)
  console.log(`  • ${est6mo.toLocaleString()} wallets active in last 6 months`)
  console.log(`  • ${est1yr.toLocaleString()} wallets active in last 1 year`)
  console.log(`\nTo get the exact list, run full backfill with improved rate limiting.`)
  console.log('\n✅ Sample analysis complete!')
}

runSample().catch(console.error)
