import * as fs from 'fs'

const checkpoint = JSON.parse(fs.readFileSync('runtime/discover-orderbook.checkpoint.json', 'utf-8'))
const walletStats = checkpoint.walletStats

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

const wallets = Object.values(walletStats) as WalletStats[]

const total = wallets.length

console.log('Wallet Filter Analysis')
console.log('='.repeat(60))
console.log(`Total wallets discovered: ${total.toLocaleString()}`)
console.log(`Checkpoint at: ${checkpoint.totalEvents.toLocaleString()} events\n`)

console.log('⚠️  NOTE: Current checkpoint does NOT track last active timestamp.')
console.log('To add "active in last 4 months" filter, we need to enhance the discovery script.\n')

// Different trade count filters
const filters = [
  { label: 'All wallets', minTrades: 0 },
  { label: '>1 trade', minTrades: 2 },
  { label: '>5 trades', minTrades: 6 },
  { label: '>10 trades', minTrades: 11 },
  { label: '>20 trades', minTrades: 21 }
]

const thresholds = [100, 500, 1000, 5000, 10000, 50000, 100000]

filters.forEach(filter => {
  const filtered = wallets.filter(w => w.numTrades >= filter.minTrades)

  console.log(`\n${filter.label.toUpperCase()} (${filtered.length.toLocaleString()} wallets, ${(100*filtered.length/total).toFixed(2)}% of total)`)
  console.log('-'.repeat(60))

  thresholds.forEach(threshold => {
    const count = filtered.filter(w => w.totalVolume >= threshold).length
    const pctOfFiltered = filtered.length > 0 ? (100 * count / filtered.length).toFixed(2) : '0.00'
    const pctOfTotal = (100 * count / total).toFixed(2)
    console.log(`  ≥ $${threshold.toLocaleString().padEnd(8)}: ${count.toLocaleString().padStart(6)} (${pctOfFiltered}% of filtered, ${pctOfTotal}% of all)`)
  })
})

// Focus on >5 trades with trade stats
console.log('\n\n>5 TRADES - DETAILED BREAKDOWN')
console.log('='.repeat(60))
const moreThan5 = wallets.filter(w => w.numTrades > 5)
console.log(`Total wallets: ${moreThan5.length.toLocaleString()} (${(100*moreThan5.length/total).toFixed(2)}% of all)\n`)

const tradeCounts = moreThan5.map(w => w.numTrades).sort((a, b) => a - b)
const median = tradeCounts[Math.floor(tradeCounts.length / 2)]
const avg = tradeCounts.reduce((a, b) => a + b, 0) / tradeCounts.length
const max = Math.max(...tradeCounts)
const min = Math.min(...tradeCounts)

console.log('Trade Distribution:')
console.log(`  Min: ${min}, Median: ${median}, Average: ${avg.toFixed(1)}, Max: ${max.toLocaleString()}\n`)

console.log('Trade Count Buckets:')
const buckets = [
  { label: '6-10 trades', min: 6, max: 10 },
  { label: '11-50 trades', min: 11, max: 50 },
  { label: '51-100 trades', min: 51, max: 100 },
  { label: '101+ trades', min: 101, max: Infinity }
]
buckets.forEach(bucket => {
  const count = moreThan5.filter(w => w.numTrades >= bucket.min && w.numTrades <= bucket.max).length
  const pct = (100 * count / moreThan5.length).toFixed(2)
  console.log(`  ${bucket.label.padEnd(15)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
})

// Special focus: >$10k wallets
console.log('\n\n>$10K VOLUME WALLETS')
console.log('='.repeat(60))
const over10k = wallets.filter(w => w.totalVolume >= 10000)
console.log(`Total: ${over10k.length.toLocaleString()}\n`)

const tradeFilters = [
  { label: 'All >$10k', minTrades: 0 },
  { label: '>$10k + >1 trade', minTrades: 2 },
  { label: '>$10k + >5 trades', minTrades: 6 },
  { label: '>$10k + >10 trades', minTrades: 11 },
  { label: '>$10k + >20 trades', minTrades: 21 }
]

tradeFilters.forEach(tf => {
  const count = over10k.filter(w => w.numTrades >= tf.minTrades).length
  const pct = (100 * count / over10k.length).toFixed(2)
  console.log(`${tf.label.padEnd(22)}: ${count.toLocaleString().padStart(6)} (${pct}% of >$10k)`)
})

console.log('\n\n💡 RECOMMENDATION: ">$10k + >5 trades" for quality active traders')
console.log('   This filters out both low-volume and one-off traders.')
