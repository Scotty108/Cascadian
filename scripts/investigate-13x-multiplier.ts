import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient, positionsClient } from '@/lib/goldsky/client'

async function investigate13xMultiplier() {
  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  console.log('🔍 Investigating 13.24x Multiplier\n')

  // Theory: Goldsky might be using a different decimal system
  // Or tracking something 13x (like including both sides of trades?)

  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 10) {
        id
        user
        tokenId
        amount
        avgPrice
        realizedPnl
        totalBought
      }
    }
  `

  const data = await pnlClient.request<any>(query, {
    wallet: wallet.toLowerCase(),
  })

  console.log('Sample position from PnL subgraph:')
  const pos = data.userPositions[0]
  console.log(JSON.stringify(pos, null, 2))

  // Check what the units actually represent
  console.log('\n\n📊 Field analysis:')
  console.log(`realizedPnl (raw): ${pos.realizedPnl}`)
  console.log(`realizedPnl ÷ 1e6: ${parseFloat(pos.realizedPnl) / 1e6}`)
  console.log(`realizedPnl ÷ 1e12: ${parseFloat(pos.realizedPnl) / 1e12}`)
  console.log(`realizedPnl ÷ 13.24e6: ${parseFloat(pos.realizedPnl) / (13.24 * 1e6)}`)

  console.log(`\navgPrice (raw): ${pos.avgPrice}`)
  console.log(`avgPrice ÷ 1e6: ${parseFloat(pos.avgPrice) / 1e6}`)

  console.log(`\ntotalBought (raw): ${pos.totalBought}`)
  console.log(`totalBought ÷ 1e6: ${parseFloat(pos.totalBought) / 1e6}`)

  // Theory: Check if PnL is in a different unit
  // Prediction markets use basis points or other weird units sometimes

  console.log('\n\n💡 Testing different interpretations:')

  // Maybe realizedPnl is in wei (1e18) not USDC (1e6)?
  console.log(`1. As wei (÷1e18): $${parseFloat(pos.realizedPnl) / 1e18}`)

  // Maybe it's in cents (1e8)?
  console.log(`2. As cents (÷1e8): $${parseFloat(pos.realizedPnl) / 1e8}`)

  // Maybe the PnL subgraph uses different decimals?
  console.log(`3. As micro-USDC (÷1e12): $${parseFloat(pos.realizedPnl) / 1e12}`)

  // Check the ratio more precisely
  const totalRaw = await getTotalPnL(wallet)
  const expectedPnL = 31904.33
  const ratio = totalRaw / expectedPnL

  console.log('\n\n🔍 Precise multiplier analysis:')
  console.log(`Total PnL (sum): ${totalRaw.toFixed(2)}`)
  console.log(`Expected PnL: ${expectedPnL}`)
  console.log(`Ratio: ${ratio.toFixed(6)}`)
  console.log(`\nThis suggests Goldsky is using a unit that's ${ratio.toFixed(2)}x larger`)

  // Check if it's a known constant
  if (Math.abs(ratio - 10) < 0.5) {
    console.log('✅ Might be base-10 related (counting in dimes instead of dollars?)')
  } else if (Math.abs(ratio - 13.24) < 0.1) {
    console.log('❓ 13.24x is unusual - not a standard multiplier')
    console.log('   Could be: multiple outcome tokens per market?')
    console.log('   Or: some aggregate/composite calculation?')
  }

  // Final recommendation
  console.log('\n\n💡 SOLUTION:')
  console.log(`Divide all PnL values by ${ratio.toFixed(4)} to match Polymarket`)
  console.log(`\nUpdated calculation:`)
  console.log(`realizedPnl / ${ratio.toFixed(4)} / 1e6 = correct USD value`)
}

async function getTotalPnL(wallet: string): Promise<number> {
  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
        realizedPnl
      }
    }
  `

  const data = await pnlClient.request<any>(query, {
    wallet: wallet.toLowerCase(),
  })

  return data.userPositions.reduce((sum: number, p: any) => {
    return sum + parseFloat(p.realizedPnl) / 1e6
  }, 0)
}

investigate13xMultiplier()
