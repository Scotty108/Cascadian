import * as fs from 'fs'

interface EnhancedWalletStats {
  wallet: string
  totalVolume: number
  numTrades: number
  firstTradeTimestamp: string
  lastTradeTimestamp: string
  daysSinceFirstTrade: number
  daysSinceLastTrade: number
  isActiveIn4Months: boolean
  isActiveIn6Months: boolean
}

const INPUT_FILE = 'runtime/wallets_with_timestamps.json'

// Parse command line args
const args = process.argv.slice(2)
const filters: any = {}

args.forEach(arg => {
  const [key, value] = arg.split('=')
  if (key && value) {
    filters[key.replace('--', '')] = value
  }
})

async function queryWallets() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ File not found: ${INPUT_FILE}`)
    console.error('Run backfill-wallet-timestamps.ts first!')
    process.exit(1)
  }

  console.log('🔍 Loading enhanced wallet data...\n')
  const data = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'))
  let wallets: EnhancedWalletStats[] = data.wallets

  console.log(`📊 Total wallets in dataset: ${wallets.length.toLocaleString()}\n`)

  // Apply filters
  const minVolume = parseFloat(filters.minVolume || '0')
  const minTrades = parseInt(filters.minTrades || '0')
  const activeMonths = parseInt(filters.activeMonths || '0')
  const maxDaysSinceLastTrade = activeMonths ? activeMonths * 30 : Infinity

  console.log('Filters applied:')
  if (minVolume > 0) console.log(`  • Minimum volume: $${minVolume.toLocaleString()}`)
  if (minTrades > 0) console.log(`  • Minimum trades: ${minTrades}`)
  if (activeMonths > 0) console.log(`  • Active in last ${activeMonths} months`)
  console.log('')

  wallets = wallets.filter(w => {
    if (w.totalVolume < minVolume) return false
    if (w.numTrades <= minTrades) return false
    if (w.daysSinceLastTrade > maxDaysSinceLastTrade) return false
    return true
  })

  console.log(`✅ Filtered results: ${wallets.length.toLocaleString()} wallets\n`)

  // Summary stats
  const volumeThresholds = [100, 500, 1000, 5000, 10000, 50000, 100000]
  console.log('Volume Breakdown:')
  volumeThresholds.forEach(threshold => {
    const count = wallets.filter(w => w.totalVolume >= threshold).length
    const pct = (100 * count / wallets.length).toFixed(2)
    console.log(`  ≥ $${threshold.toLocaleString().padEnd(8)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
  })

  console.log('\nTrade Count Breakdown:')
  const tradeBuckets = [
    { label: '1-5 trades', min: 1, max: 5 },
    { label: '6-10 trades', min: 6, max: 10 },
    { label: '11-50 trades', min: 11, max: 50 },
    { label: '51-100 trades', min: 51, max: 100 },
    { label: '101+ trades', min: 101, max: Infinity }
  ]
  tradeBuckets.forEach(bucket => {
    const count = wallets.filter(w => w.numTrades >= bucket.min && w.numTrades <= bucket.max).length
    const pct = (100 * count / wallets.length).toFixed(2)
    console.log(`  ${bucket.label.padEnd(15)}: ${count.toLocaleString().padStart(6)} (${pct}%)`)
  })

  console.log('\nActivity Breakdown:')
  const active4mo = wallets.filter(w => w.isActiveIn4Months).length
  const active6mo = wallets.filter(w => w.isActiveIn6Months).length
  console.log(`  Active in 4 months: ${active4mo.toLocaleString()} (${(100*active4mo/wallets.length).toFixed(2)}%)`)
  console.log(`  Active in 6 months: ${active6mo.toLocaleString()} (${(100*active6mo/wallets.length).toFixed(2)}%)`)

  // Top 20 by volume
  console.log('\n🏆 Top 20 Wallets by Volume:')
  const top20 = wallets.sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 20)
  top20.forEach((w, i) => {
    const activeStatus = w.isActiveIn4Months ? '✅ 4mo' : w.isActiveIn6Months ? '⚠️  6mo' : '❌ old'
    console.log(`  ${(i + 1).toString().padStart(2)}. ${w.wallet} | $${w.totalVolume.toLocaleString().padStart(12)} | ${w.numTrades.toString().padStart(5)} trades | ${activeStatus}`)
  })

  // Save filtered results
  if (wallets.length < data.wallets.length) {
    const outputFile = 'runtime/filtered_wallets.json'
    fs.writeFileSync(outputFile, JSON.stringify({
      filters: { minVolume, minTrades, activeMonths },
      totalWallets: wallets.length,
      wallets
    }, null, 2))
    console.log(`\n💾 Filtered results saved to ${outputFile}`)

    const csvFile = outputFile.replace('.json', '.csv')
    const csvLines = [
      'wallet,totalVolume,numTrades,daysSinceLastTrade,isActiveIn4Months'
    ]
    wallets.forEach(w => {
      csvLines.push([
        w.wallet,
        w.totalVolume.toFixed(2),
        w.numTrades,
        w.daysSinceLastTrade,
        w.isActiveIn4Months
      ].join(','))
    })
    fs.writeFileSync(csvFile, csvLines.join('\n'))
    console.log(`📄 CSV saved to ${csvFile}`)
  }
}

console.log('═'.repeat(60))
console.log('  WALLET QUERY TOOL')
console.log('═'.repeat(60))
console.log('')
console.log('Usage:')
console.log('  npx tsx scripts/query-wallets.ts [filters]')
console.log('')
console.log('Filters:')
console.log('  --minVolume=10000      Minimum lifetime volume ($)')
console.log('  --minTrades=5          Minimum number of trades')
console.log('  --activeMonths=4       Active within N months')
console.log('')
console.log('Example:')
console.log('  npx tsx scripts/query-wallets.ts --minVolume=10000 --minTrades=5 --activeMonths=4')
console.log('')
console.log('═'.repeat(60))
console.log('')

queryWallets().catch(console.error)
