#!/usr/bin/env npx tsx
/**
 * Batch FIFO P&L check for all wallets in comparison report
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

interface Trade {
  cid: string
  outcome_idx: number
  direction: 'BUY' | 'SELL'
  shares: number
  usd: number
  fee: number
  ts: number
  tx: string
}

interface Lot {
  qty: number
  costPerShare: number
}

const WALLETS = [
  { addr: '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', label: 'Wallet 1' },
  { addr: '0x662244931c392df70bd064fa91f838eea0bfd7a9', label: 'Wallet 2' },
  { addr: '0x2e0b70d482e6b389e81dea528be57d825dd48070', label: 'Wallet 3' },
  { addr: '0x3b6fd06a595d71c70afb3f44414be1c11304340b', label: 'Wallet 4' },
  { addr: '0xd748c701ad93cfec32a3420e10f3b08e68612125', label: 'Wallet 5' },
  { addr: '0x2a019dc0089ea8c6edbbafc8a7cc9ba77b4b6397', label: 'Wallet 6' },
  { addr: '0xd06f0f7719df1b3b75b607923536b3250825d4a6', label: 'Wallet 7' },
  { addr: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', label: 'Wallet 8' },
  { addr: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', label: 'Wallet 9' },
  { addr: '0x7f3c8979d0afa00007bae4747d5347122af05613', label: 'Wallet 10' },
  { addr: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', label: 'Wallet 11' },
  { addr: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', label: 'Wallet 12' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', label: 'XCN Strategy' },
  { addr: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', label: 'Wallet 14' },
]

async function fetchTrades(wallet: string): Promise<Trade[]> {
  const query = `
    SELECT
      lower(condition_id_norm_v3) AS cid,
      toInt8(outcome_index_v3) AS outcome_idx,
      trade_direction AS direction,
      toFloat64(shares) AS shares,
      toFloat64(usd_value) AS usd,
      toFloat64(fee) AS fee,
      toUInt32(timestamp) AS ts,
      transaction_hash AS tx
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
      AND condition_id_norm_v3 != ''
    ORDER BY cid, outcome_idx, ts, tx;
  `

  try {
    const res = await clickhouse.query({ query, format: 'JSONEachRow' })
    const rows = await res.json<Trade[]>()
    return rows
  } catch (err) {
    console.error(`Error fetching trades for ${wallet}:`, err)
    return []
  }
}

type Key = string
const keyOf = (t: Trade): Key => `${t.cid}::${t.outcome_idx}`

async function calculateFIFO(wallet: string) {
  const trades = await fetchTrades(wallet)

  if (!trades.length) {
    return {
      trades: 0,
      volume: 0,
      gains: 0,
      losses: 0,
      netPnl: 0,
    }
  }

  let totalVolume = 0
  let totalTrades = 0

  interface MarketAgg {
    realized: number
    buys: number
    sells: number
    volume: number
    fills: number
    lots: Lot[]
  }
  const agg = new Map<Key, MarketAgg>()

  for (const t of trades) {
    totalTrades += 1
    totalVolume += t.usd
    const k = keyOf(t)
    if (!agg.has(k)) agg.set(k, { realized: 0, buys: 0, sells: 0, volume: 0, fills: 0, lots: [] })
    const a = agg.get(k)!
    a.volume += t.usd
    a.fills += 1

    if (t.direction === 'BUY') {
      const effectiveCost = t.usd + t.fee
      const lot: Lot = {
        qty: t.shares,
        costPerShare: effectiveCost / t.shares,
      }
      a.lots.push(lot)
      a.buys += t.shares
    } else {
      const effectiveProceeds = t.usd - t.fee
      const sellPrice = effectiveProceeds / t.shares
      let qtyToSell = t.shares
      let realizedHere = 0

      while (qtyToSell > 1e-12 && a.lots.length) {
        const lot = a.lots[0]
        const take = Math.min(lot.qty, qtyToSell)
        realizedHere += take * (sellPrice - lot.costPerShare)
        lot.qty -= take
        qtyToSell -= take
        if (lot.qty <= 1e-12) a.lots.shift()
      }

      if (qtyToSell > 1e-12) {
        qtyToSell = 0
      }

      a.realized += realizedHere
      a.sells += t.shares
    }
  }

  let gains = 0
  let losses = 0
  let netPnl = 0

  agg.forEach((v) => {
    const pnl = v.realized
    netPnl += pnl
    if (pnl >= 0) gains += pnl
    else losses -= pnl
  })

  return {
    trades: totalTrades,
    volume: totalVolume,
    gains,
    losses,
    netPnl,
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                    BATCH FIFO P&L CHECK - ALL WALLETS                       ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log()

  const results: any[] = []

  for (const wallet of WALLETS) {
    process.stdout.write(`${wallet.label.padEnd(15)} ... `)
    const result = await calculateFIFO(wallet.addr)
    results.push({ ...wallet, ...result })
    console.log(`${result.trades.toLocaleString()} trades | P&L: $${result.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  }

  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('SUMMARY TABLE')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log()
  console.log('Wallet          Trades      Volume           Gains           Losses          Net P&L')
  console.log('─────────────────────────────────────────────────────────────────────────────────────')

  for (const r of results) {
    const trades = String(r.trades).padStart(10)
    const volume = `$${r.volume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(15)
    const gains = `$${r.gains.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(15)
    const losses = `$${r.losses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(15)
    const netPnl = `$${r.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(15)
    console.log(`${r.label.padEnd(15)} ${trades} ${volume} ${gains} ${losses} ${netPnl}`)
  }

  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log('KEY FINDINGS')
  console.log('═══════════════════════════════════════════════════════════════════════════════')
  console.log()

  const winners = results.filter(r => r.netPnl > 0)
  const losers = results.filter(r => r.netPnl < 0)
  const zeros = results.filter(r => r.netPnl === 0)

  console.log(`Winners (FIFO P&L > $0):  ${winners.length}`)
  winners.forEach(r => {
    console.log(`  ${r.label.padEnd(15)} $${r.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  })

  console.log()
  console.log(`Losers (FIFO P&L < $0):   ${losers.length}`)
  losers.slice(0, 5).forEach(r => {
    console.log(`  ${r.label.padEnd(15)} $${r.netPnl.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  })

  console.log()
  console.log(`Zero/No Trades:           ${zeros.length}`)
  zeros.forEach(r => {
    console.log(`  ${r.label.padEnd(15)} ${r.trades} trades`)
  })

  console.log()
  await clickhouse.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
