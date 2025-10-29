import * as fs from 'fs'

interface WalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
}

const CHECKPOINT_FILE = 'runtime/discover-orderbook.checkpoint.json'

console.log('📊 Exporting Filtered Wallets\n')

// Load checkpoint
const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'))
const walletStats: Record<string, WalletStats> = checkpoint.walletStats
const wallets = Object.values(walletStats)

console.log(`Total wallets discovered: ${wallets.length.toLocaleString()}\n`)

// Filter: ≥$10k + >5 trades
const filtered = wallets.filter(w => w.totalVolume >= 10000 && w.numTrades > 5)

console.log('Filters applied:')
console.log('  • Minimum volume: $10,000')
console.log('  • Minimum trades: >5')
console.log(`\n✅ Filtered results: ${filtered.length.toLocaleString()} wallets\n`)

// Sort by volume descending
filtered.sort((a, b) => b.totalVolume - a.totalVolume)

// Export JSON
const jsonOutput = {
  exportedAt: new Date().toISOString(),
  filters: {
    minVolume: 10000,
    minTrades: 5
  },
  totalWallets: filtered.length,
  summary: {
    totalVolume: filtered.reduce((sum, w) => sum + w.totalVolume, 0),
    avgVolume: filtered.reduce((sum, w) => sum + w.totalVolume, 0) / filtered.length,
    totalTrades: filtered.reduce((sum, w) => sum + w.numTrades, 0),
    avgTrades: filtered.reduce((sum, w) => sum + w.numTrades, 0) / filtered.length
  },
  wallets: filtered
}

fs.writeFileSync('runtime/wallets_10k_plus.json', JSON.stringify(jsonOutput, null, 2))
console.log('💾 JSON saved: runtime/wallets_10k_plus.json')

// Export CSV
const csvLines = ['wallet,lifetime_volume_usd,num_trades']
filtered.forEach(w => {
  csvLines.push(`${w.wallet},${w.totalVolume.toFixed(2)},${w.numTrades}`)
})

fs.writeFileSync('runtime/wallets_10k_plus.csv', csvLines.join('\n'))
console.log('💾 CSV saved: runtime/wallets_10k_plus.csv')

// Export simple list (just addresses)
const addressList = filtered.map(w => w.wallet).join('\n')
fs.writeFileSync('runtime/wallets_10k_plus_addresses.txt', addressList)
console.log('💾 Address list: runtime/wallets_10k_plus_addresses.txt')

// Summary stats
console.log('\n📊 Summary Statistics:')
console.log(`Total wallets: ${filtered.length.toLocaleString()}`)
console.log(`Total volume: $${jsonOutput.summary.totalVolume.toLocaleString()}`)
console.log(`Average volume: $${jsonOutput.summary.avgVolume.toLocaleString()}`)
console.log(`Total trades: ${jsonOutput.summary.totalTrades.toLocaleString()}`)
console.log(`Average trades: ${Math.round(jsonOutput.summary.avgTrades).toLocaleString()}`)

// Volume distribution
console.log('\nVolume Distribution:')
const thresholds = [10000, 25000, 50000, 100000, 250000, 500000, 1000000]
thresholds.forEach(threshold => {
  const count = filtered.filter(w => w.totalVolume >= threshold).length
  const pct = (100 * count / filtered.length).toFixed(2)
  console.log(`  ≥ $${threshold.toLocaleString().padEnd(9)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
})

// Trade distribution
console.log('\nTrade Count Distribution:')
const tradeBuckets = [
  { label: '6-10 trades', min: 6, max: 10 },
  { label: '11-50 trades', min: 11, max: 50 },
  { label: '51-100 trades', min: 51, max: 100 },
  { label: '101-500 trades', min: 101, max: 500 },
  { label: '501+ trades', min: 501, max: Infinity }
]
tradeBuckets.forEach(bucket => {
  const count = filtered.filter(w => w.numTrades >= bucket.min && w.numTrades <= bucket.max).length
  const pct = (100 * count / filtered.length).toFixed(2)
  console.log(`  ${bucket.label.padEnd(16)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
})

// Top 20
console.log('\n🏆 Top 20 Wallets by Volume:')
filtered.slice(0, 20).forEach((w, i) => {
  console.log(`  ${(i + 1).toString().padStart(2)}. ${w.wallet} | $${w.totalVolume.toLocaleString().padStart(14)} | ${w.numTrades.toLocaleString().padStart(6)} trades`)
})

console.log('\n✅ Export complete!')
