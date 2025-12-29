#!/usr/bin/env npx tsx
/**
 * Wallet-wide FIFO P&L calculator (trading-only) per market/outcome.
 *
 * Goal: mirror Polymarket-style “net total” by compressing churn inside a market
 * using FIFO inventory, instead of naive proceeds – cost aggregation.
 *
 * Usage:
 *   npx tsx scripts/101-wallet-fifo-pnl.ts --wallet 0x7f3c8979d0afa00007bae4747d5347122af05613 \
 *     [--date-from 2024-01-01] [--date-to 2025-12-31]
 *
 * Outputs:
 *   - Total trades, volume
 *   - Realized P&L (FIFO), broken into gains / losses
 *   - Top 10 markets by absolute P&L
 *
 * Notes:
 *   - Fees are included: effective_cost = usd_value + fee for BUY, effective_proceeds = usd_value - fee for SELL.
 *   - Settlement is NOT included here; this is pure trading P&L. Extend later if needed.
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

const args = process.argv.slice(2)
function argVal(flag: string) {
  const p = args.find(a => a.startsWith(flag + '='))
  return p ? p.split('=')[1] : undefined
}

const WALLET = (argVal('--wallet') || '0x7f3c8979d0afa00007bae4747d5347122af05613').toLowerCase()
const DATE_FROM = argVal('--date-from')
const DATE_TO = argVal('--date-to')

async function fetchTrades(): Promise<Trade[]> {
  const conditions: string[] = [`lower(wallet_address) = '${WALLET}'`, `condition_id_norm_v3 != ''`]
  if (DATE_FROM) conditions.push(`toDate(timestamp) >= toDate('${DATE_FROM}')`)
  if (DATE_TO) conditions.push(`toDate(timestamp) <= toDate('${DATE_TO}')`)

  const where = conditions.join(' AND ')

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
    WHERE ${where}
    ORDER BY cid, outcome_idx, ts, tx;
  `

  const res = await clickhouse.query({ query, format: 'JSONEachRow' })
  const rows = await res.json<Trade[]>()
  return rows
}

type Key = string
const keyOf = (t: Trade): Key => `${t.cid}::${t.outcome_idx}`

async function main() {
  console.log('══════════════════════════════════════════════════════════')
  console.log(' FIFO P&L (trading-only) per market/outcome')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`Wallet: ${WALLET}`)
  if (DATE_FROM || DATE_TO) console.log(`Window: ${DATE_FROM || '…'} → ${DATE_TO || '…'}`)
  console.log()

  const trades = await fetchTrades()
  if (!trades.length) {
    console.log('No trades found.')
    await clickhouse.close()
    return
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
      // SELL
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

      // If we sold more than we own, treat extra as zero-cost inventory (matches Polymarket behavior: no profit without inventory)
      if (qtyToSell > 1e-12) {
        // No inventory: no profit attributed.
        qtyToSell = 0
      }

      a.realized += realizedHere
      a.sells += t.shares
    }
  }

  // Summaries
  let gains = 0
  let losses = 0
  let netPnl = 0
  const top: { key: Key; pnl: number; volume: number; fills: number }[] = []

  agg.forEach((v, k) => {
    const pnl = v.realized
    netPnl += pnl
    if (pnl >= 0) gains += pnl
    else losses -= pnl
    top.push({ key: k, pnl, volume: v.volume, fills: v.fills })
  })

  top.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))

  console.log(`Trades:  ${totalTrades.toLocaleString()}`)
  console.log(`Volume:  $${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`Gains:   $${gains.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`Losses:  $${losses.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`Net P&L: $${netPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log()
  console.log('Top 10 markets by |P&L| (cid::outcome_idx):')
  top.slice(0, 10).forEach((m, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${m.key} | P&L $${m.pnl.toFixed(2)} | Vol $${m.volume.toFixed(2)} | Fills ${m.fills}`
    )
  })

  await clickhouse.close()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
