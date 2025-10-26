import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { fetchWalletPnL } from '@/lib/goldsky/client'

async function testWalletPnL() {
  console.log('💰 Fetching wallet PnL from Goldsky PnL subgraph...\n')

  const testWallets = [
    '0x96a8b71cbfdcc8f0af7efc22c28c8bc237ed29d6',
    '0xc5d563a36ae78145c45a50134d48a1215220f80a',
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  ]

  for (const wallet of testWallets) {
    console.log(`Wallet: ${wallet}`)

    try {
      const pnl = await fetchWalletPnL(wallet)

      if (pnl) {
        const realized = parseFloat(pnl.realizedPnl) / 1e6 // Convert from USDC decimals
        const unrealized = parseFloat(pnl.unrealizedPnl) / 1e6
        const total = parseFloat(pnl.totalPnl) / 1e6

        console.log(`  Realized PnL: $${realized.toFixed(2)}`)
        console.log(`  Unrealized PnL: $${unrealized.toFixed(2)}`)
        console.log(`  Total PnL: $${total.toFixed(2)}`)
      } else {
        console.log('  ⚠️  No PnL data found')
      }
    } catch (error) {
      console.log(`  ❌ Error: ${(error as Error).message}`)
    }

    console.log()
  }

  console.log('\n💡 Insight:')
  console.log('We can use Goldsky PnL data directly instead of calculating ourselves!')
  console.log('This gives us instant access to realized and unrealized PnL.')
}

testWalletPnL()
