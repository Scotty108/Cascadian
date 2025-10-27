import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const condition_id = '0x700803904cd5bc5caac110bb58bee0097d2fbb328e0dc4ee494135cf79a46386'
const wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

interface Fill {
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  timestamp: string
}

interface InventoryLot {
  price: number
  shares: number
}

async function main() {
  const result = await clickhouse.query({
    query: `
      SELECT side, entry_price, shares, timestamp
      FROM trades_raw
      WHERE wallet_address = '${wallet}' AND condition_id = '${condition_id}'
      ORDER BY timestamp ASC
    `,
    format: 'JSONEachRow',
  })

  const fills = await result.json() as Fill[]
  console.log(`Total fills: ${fills.length}\n`)

  // Track first 50 pairs that get closed
  const yesInventory: InventoryLot[] = []
  const noInventory: InventoryLot[] = []
  const closedPairs: Array<{yes_price: number, no_price: number, shares: number, spread: number}> = []

  for (const fill of fills) {
    if (fill.side === 'YES') {
      let remainingShares = fill.shares

      while (remainingShares > 0 && noInventory.length > 0 && closedPairs.length < 50) {
        const oldestNoLot = noInventory[0]
        const sharesToClose = Math.min(remainingShares, oldestNoLot.shares)

        closedPairs.push({
          no_price: oldestNoLot.price,
          yes_price: fill.entry_price,
          shares: sharesToClose,
          spread: 1 - (oldestNoLot.price + fill.entry_price)
        })

        remainingShares -= sharesToClose
        oldestNoLot.shares -= sharesToClose

        if (oldestNoLot.shares === 0) {
          noInventory.shift()
        }
      }

      if (remainingShares > 0) {
        yesInventory.push({ price: fill.entry_price, shares: remainingShares })
      }
    } else {
      let remainingShares = fill.shares

      while (remainingShares > 0 && yesInventory.length > 0 && closedPairs.length < 50) {
        const oldestYesLot = yesInventory[0]
        const sharesToClose = Math.min(remainingShares, oldestYesLot.shares)

        closedPairs.push({
          yes_price: oldestYesLot.price,
          no_price: fill.entry_price,
          shares: sharesToClose,
          spread: 1 - (oldestYesLot.price + fill.entry_price)
        })

        remainingShares -= sharesToClose
        oldestYesLot.shares -= sharesToClose

        if (oldestYesLot.shares === 0) {
          yesInventory.shift()
        }
      }

      if (remainingShares > 0) {
        noInventory.push({ price: fill.entry_price, shares: remainingShares })
      }
    }
  }

  console.log('First 50 closed pairs:')
  console.log('YES Price | NO Price | Total Cost | Spread | Shares')
  console.log('------------------------------------------------------')

  for (const pair of closedPairs) {
    const totalCost = pair.yes_price + pair.no_price
    console.log(
      `${pair.yes_price.toFixed(4).padStart(9)} | ` +
      `${pair.no_price.toFixed(4).padStart(8)} | ` +
      `${totalCost.toFixed(4).padStart(10)} | ` +
      `${pair.spread.toFixed(4).padStart(6)} | ` +
      `${pair.shares.toFixed(2)}`
    )
  }

  const avgSpread = closedPairs.reduce((sum, p) => sum + p.spread * p.shares, 0) / closedPairs.reduce((sum, p) => sum + p.shares, 0)
  console.log(`\nAverage weighted spread: ${avgSpread.toFixed(4)}`)
}

main()
