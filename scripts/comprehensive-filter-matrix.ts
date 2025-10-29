import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

const checkpoint = JSON.parse(fs.readFileSync('runtime/discover-orderbook.checkpoint.json', 'utf-8'))
const wallets = Object.values(checkpoint.walletStats) as WalletStats[]

console.log('📊 COMPREHENSIVE WALLET FILTER MATRIX\n')
console.log('='.repeat(100))

// Volume thresholds to test
const volumeThresholds = [5000, 10000, 25000, 50000, 100000]

// Trade filters to test
const tradeFilters = [
  { label: '>5', min: 6 },
  { label: '>10', min: 11 },
  { label: '>20', min: 21 },
  { label: '>50', min: 51 },
  { label: '>100', min: 101 }
]

// Build matrix
console.log('\n📈 WALLET COUNT MATRIX\n')
console.log('Volume Filter  | >5 trades | >10 trades | >20 trades | >50 trades | >100 trades')
console.log('-'.repeat(100))

const results: Record<string, Record<string, number>> = {}

volumeThresholds.forEach(volThreshold => {
  const baseWallets = wallets.filter(w => w.totalVolume >= volThreshold)
  const row: number[] = []

  results[`$${volThreshold.toLocaleString()}`] = {}

  tradeFilters.forEach(tradeFilter => {
    const filtered = baseWallets.filter(w => w.numTrades >= tradeFilter.min)
    row.push(filtered.length)
    results[`$${volThreshold.toLocaleString()}`][tradeFilter.label] = filtered.length
  })

  console.log(
    `≥ $${volThreshold.toLocaleString().padEnd(10)} | ${row.map(n => n.toLocaleString().padStart(9)).join(' | ')}`
  )
})

// Your specific request: $5k + different trade filters
console.log('\n' + '='.repeat(100))
console.log('\n🎯 DETAILED BREAKDOWN: ≥$5,000 Volume\n')

const base5k = wallets.filter(w => w.totalVolume >= 5000)
console.log(`Total ≥$5k wallets: ${base5k.length.toLocaleString()}\n`)

tradeFilters.forEach(filter => {
  const filtered = base5k.filter(w => w.numTrades >= filter.min)
  const pct = (100 * filtered.length / base5k.length).toFixed(2)
  const avgVol = filtered.reduce((sum, w) => sum + w.totalVolume, 0) / filtered.length
  const avgTrades = filtered.reduce((sum, w) => sum + w.numTrades, 0) / filtered.length

  console.log(`${filter.label} trades:`)
  console.log(`  Wallets: ${filtered.length.toLocaleString()} (${pct}% of ≥$5k)`)
  console.log(`  Avg Volume: $${Math.round(avgVol).toLocaleString()}`)
  console.log(`  Avg Trades: ${Math.round(avgTrades).toLocaleString()}`)
  console.log('')
})

// Your specific request: $10k + different trade filters
console.log('='.repeat(100))
console.log('\n🎯 DETAILED BREAKDOWN: ≥$10,000 Volume\n')

const base10k = wallets.filter(w => w.totalVolume >= 10000)
console.log(`Total ≥$10k wallets: ${base10k.length.toLocaleString()}\n`)

tradeFilters.forEach(filter => {
  const filtered = base10k.filter(w => w.numTrades >= filter.min)
  const pct = (100 * filtered.length / base10k.length).toFixed(2)
  const avgVol = filtered.reduce((sum, w) => sum + w.totalVolume, 0) / filtered.length
  const avgTrades = filtered.reduce((sum, w) => sum + w.numTrades, 0) / filtered.length

  console.log(`${filter.label} trades:`)
  console.log(`  Wallets: ${filtered.length.toLocaleString()} (${pct}% of ≥$10k)`)
  console.log(`  Avg Volume: $${Math.round(avgVol).toLocaleString()}`)
  console.log(`  Avg Trades: ${Math.round(avgTrades).toLocaleString()}`)
  console.log('')
})

// Highlight your specific criteria
console.log('='.repeat(100))
console.log('\n⭐ YOUR CRITERIA: ≥$10k + >10 trades\n')

const yourFilter = base10k.filter(w => w.numTrades > 10)
console.log(`✅ Total Wallets: ${yourFilter.length.toLocaleString()}`)
console.log(`✅ Total Volume: $${yourFilter.reduce((sum, w) => sum + w.totalVolume, 0).toLocaleString()}`)
console.log(`✅ Avg Volume: $${Math.round(yourFilter.reduce((sum, w) => sum + w.totalVolume, 0) / yourFilter.length).toLocaleString()}`)
console.log(`✅ Avg Trades: ${Math.round(yourFilter.reduce((sum, w) => sum + w.numTrades, 0) / yourFilter.length).toLocaleString()}`)

// Sub-segmentation by volume
console.log('\nSub-Tiers (≥$10k + >10 trades):')
const subTiers = [
  { label: '$10k-$25k', min: 10000, max: 25000 },
  { label: '$25k-$50k', min: 25000, max: 50000 },
  { label: '$50k-$100k', min: 50000, max: 100000 },
  { label: '$100k+', min: 100000, max: Infinity }
]

subTiers.forEach(tier => {
  const count = yourFilter.filter(w => w.totalVolume >= tier.min && w.totalVolume < tier.max).length
  const pct = (100 * count / yourFilter.length).toFixed(2)
  console.log(`  ${tier.label.padEnd(15)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
})

console.log('\n' + '='.repeat(100))

// Export the specific filter
const exportData = {
  filters: { minVolume: 10000, minTrades: 10 },
  totalWallets: yourFilter.length,
  wallets: yourFilter.map(w => ({
    wallet: w.wallet,
    totalVolume: w.totalVolume,
    numTrades: w.numTrades
  }))
}

fs.writeFileSync('runtime/wallets_10k_10trades.json', JSON.stringify(exportData, null, 2))
console.log('\n💾 Exported: runtime/wallets_10k_10trades.json')

// CSV export
const csvLines = ['wallet,lifetime_volume_usd,num_trades']
yourFilter.forEach(w => {
  csvLines.push(`${w.wallet},${w.totalVolume.toFixed(2)},${w.numTrades}`)
})
fs.writeFileSync('runtime/wallets_10k_10trades.csv', csvLines.join('\n'))
console.log('💾 Exported: runtime/wallets_10k_10trades.csv')

console.log('\n✅ Analysis complete!\n')
