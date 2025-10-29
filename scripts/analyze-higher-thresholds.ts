import * as fs from 'fs'

const checkpoint = JSON.parse(fs.readFileSync('runtime/discover-orderbook.checkpoint.json', 'utf-8'))
const walletStats = checkpoint.walletStats

const wallets = Object.values(walletStats) as Array<{ totalVolume: number }>

const total = wallets.length
const ge_100 = wallets.filter(w => w.totalVolume >= 100).length
const ge_500 = wallets.filter(w => w.totalVolume >= 500).length
const ge_1k = wallets.filter(w => w.totalVolume >= 1000).length
const ge_5k = wallets.filter(w => w.totalVolume >= 5000).length
const ge_10k = wallets.filter(w => w.totalVolume >= 10000).length
const ge_50k = wallets.filter(w => w.totalVolume >= 50000).length
const ge_100k = wallets.filter(w => w.totalVolume >= 100000).length

console.log('Current Thresholds at', checkpoint.totalEvents, 'events:')
console.log('Total wallets:', total)
console.log('≥ $100:    ', ge_100.toLocaleString(), `(${(100*ge_100/total).toFixed(2)}%)`)
console.log('≥ $500:    ', ge_500.toLocaleString(), `(${(100*ge_500/total).toFixed(2)}%)`)
console.log('≥ $1,000:  ', ge_1k.toLocaleString(), `(${(100*ge_1k/total).toFixed(2)}%)`)
console.log('≥ $5,000:  ', ge_5k.toLocaleString(), `(${(100*ge_5k/total).toFixed(2)}%)`)
console.log('≥ $10,000: ', ge_10k.toLocaleString(), `(${(100*ge_10k/total).toFixed(2)}%)`)
console.log('≥ $50,000: ', ge_50k.toLocaleString(), `(${(100*ge_50k/total).toFixed(2)}%)`)
console.log('≥ $100,000:', ge_100k.toLocaleString(), `(${(100*ge_100k/total).toFixed(2)}%)`)
