import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

const checkpoint = JSON.parse(fs.readFileSync('runtime/discover-orderbook.checkpoint.json', 'utf-8'))
const wallets = Object.values(checkpoint.walletStats) as WalletStats[]

console.log('📊 Wallet Filtering by Trade Count (≥$10k volume)\n')
console.log('='.repeat(70))

// Base filter: ≥$10k
const base10k = wallets.filter(w => w.totalVolume >= 10000)
console.log(`\nBase: ≥$10k volume`)
console.log(`Total: ${base10k.length.toLocaleString()} wallets\n`)

// Different trade count filters
const tradeFilters = [
  { label: 'All (1+ trade)', minTrades: 1 },
  { label: '>5 trades', minTrades: 6 },
  { label: '>10 trades', minTrades: 11 },
  { label: '>20 trades', minTrades: 21 },
  { label: '>50 trades', minTrades: 51 },
  { label: '>100 trades', minTrades: 101 },
  { label: '>500 trades', minTrades: 501 }
]

console.log('Filter Results (≥$10k + trade filter):\n')
console.log('Trade Filter       | Wallets  | % of ≥$10k | Removed')
console.log('-'.repeat(70))

tradeFilters.forEach(filter => {
  const filtered = base10k.filter(w => w.numTrades >= filter.minTrades)
  const pct = (100 * filtered.length / base10k.length).toFixed(2)
  const removed = base10k.length - filtered.length
  console.log(`${filter.label.padEnd(18)} | ${filtered.length.toLocaleString().padStart(8)} | ${pct.padStart(6)}%    | -${removed.toLocaleString()}`)
})

// Detailed breakdown for >10 trades
console.log('\n' + '='.repeat(70))
console.log('\n🎯 RECOMMENDED: ≥$10k + >10 trades\n')
const recommended = base10k.filter(w => w.numTrades > 10)

console.log(`Total wallets: ${recommended.length.toLocaleString()}`)
console.log(`Total volume: $${recommended.reduce((sum, w) => sum + w.totalVolume, 0).toLocaleString()}`)
console.log(`Avg volume: $${Math.round(recommended.reduce((sum, w) => sum + w.totalVolume, 0) / recommended.length).toLocaleString()}`)
console.log(`Total trades: ${recommended.reduce((sum, w) => sum + w.numTrades, 0).toLocaleString()}`)
console.log(`Avg trades: ${Math.round(recommended.reduce((sum, w) => sum + w.numTrades, 0) / recommended.length).toLocaleString()}`)

// Volume distribution for >10 trades
console.log('\nVolume Distribution (≥$10k + >10 trades):')
const volumeThresholds = [10000, 25000, 50000, 100000, 250000, 500000]
volumeThresholds.forEach(threshold => {
  const count = recommended.filter(w => w.totalVolume >= threshold).length
  const pct = (100 * count / recommended.length).toFixed(2)
  console.log(`  ≥ $${threshold.toLocaleString().padEnd(9)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
})

console.log('\n' + '='.repeat(70))
