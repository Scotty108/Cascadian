import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { pnlClient } from '@/lib/goldsky/client'

async function analyzePnLStructure() {
  const wallet = '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50'

  console.log('🔍 Deep Analysis of PnL Structure\n')
  console.log(`Wallet: ${wallet}`)
  console.log(`Expected PnL: $31,904 (from Polymarket)`)
  console.log(`Calculated PnL: $422,409 (from Goldsky)\n`)

  const query = `
    query GetWalletPositions($wallet: String!) {
      userPositions(where: { user: $wallet }, first: 1000) {
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

  const positions = data.userPositions
  console.log(`Total positions: ${positions.length}\n`)

  // Group by condition ID (markets have 2 tokens per condition)
  // Token IDs are huge numbers, but they encode condition + outcome
  // Let's see if we're double-counting per market

  // Hypothesis 1: Each market contributes to PnL twice (YES and NO tokens)
  const positionsWithPnL = positions.filter((p: any) => parseFloat(p.realizedPnl) !== 0)
  console.log(`Positions with non-zero PnL: ${positionsWithPnL.length}\n`)

  // Calculate different scenarios
  const totalPnL = positionsWithPnL.reduce((sum: number, p: any) => {
    return sum + parseFloat(p.realizedPnl)
  }, 0)

  console.log('📊 Different calculation methods:\n')
  console.log(`1. Sum all PnL (÷1e6): $${(totalPnL / 1e6).toFixed(2)}`)
  console.log(`2. Divide by 2 (YES/NO): $${(totalPnL / 1e6 / 2).toFixed(2)}`)
  console.log(`3. Divide by 13.24 (ratio): $${(totalPnL / 1e6 / 13.24).toFixed(2)}`)
  console.log(`4. Only positive PnL: $${(positionsWithPnL.filter((p: any) => parseFloat(p.realizedPnl) > 0).reduce((s: number, p: any) => s + parseFloat(p.realizedPnl), 0) / 1e6).toFixed(2)}`)
  console.log(`5. Positive - Negative: $${(positionsWithPnL.filter((p: any) => parseFloat(p.realizedPnl) > 0).reduce((s: number, p: any) => s + parseFloat(p.realizedPnl), 0) / 1e6 - Math.abs(positionsWithPnL.filter((p: any) => parseFloat(p.realizedPnl) < 0).reduce((s: number, p: any) => s + parseFloat(p.realizedPnl), 0) / 1e6)).toFixed(2)}`)

  // Check if positions come in pairs (same market, different outcomes)
  console.log('\n\n🔍 Checking for paired positions (same market)...\n')

  // Token IDs in prediction markets often encode:
  // - Condition ID (the market)
  // - Outcome index (0 = NO, 1 = YES usually)

  // Let's look at token ID patterns
  const tokenIds = positionsWithPnL.map((p: any) => p.tokenId).sort()

  // Sample first 20 token IDs to see patterns
  console.log('Sample token IDs (first 10):')
  tokenIds.slice(0, 10).forEach((id: string, i: number) => {
    const pnl = positionsWithPnL.find((p: any) => p.tokenId === id)?.realizedPnl
    console.log(`${i + 1}. ${id} → PnL: ${(parseFloat(pnl) / 1e6).toFixed(2)}`)
  })

  // Try to find related positions by checking if token IDs differ only slightly
  console.log('\n\n🔍 Looking for complementary positions...\n')

  // Group positions by approximate token ID (first 50 chars) to find markets
  const tokenGroups = new Map<string, any[]>()
  positionsWithPnL.forEach((p: any) => {
    const prefix = p.tokenId.substring(0, 50) // Group by similar IDs
    if (!tokenGroups.has(prefix)) {
      tokenGroups.set(prefix, [])
    }
    tokenGroups.get(prefix)!.push(p)
  })

  const multiPositionGroups = Array.from(tokenGroups.values()).filter(g => g.length > 1)
  console.log(`Found ${multiPositionGroups.length} groups with multiple positions\n`)

  if (multiPositionGroups.length > 0) {
    console.log('Sample group with multiple positions:')
    const sampleGroup = multiPositionGroups[0]
    sampleGroup.forEach((p: any) => {
      console.log(`  Token: ${p.tokenId}`)
      console.log(`  PnL: ${(parseFloat(p.realizedPnl) / 1e6).toFixed(2)}`)
      console.log(`  Amount: ${p.amount}`)
      console.log()
    })
  }

  // Final theory: Check if amount=0 means closed position
  const closedPositions = positionsWithPnL.filter((p: any) => parseFloat(p.amount) === 0)
  const openPositions = positionsWithPnL.filter((p: any) => parseFloat(p.amount) !== 0)

  console.log('\n\n📊 Position states:')
  console.log(`Closed positions (amount=0): ${closedPositions.length}`)
  console.log(`Open positions (amount>0): ${openPositions.length}`)

  const closedPnL = closedPositions.reduce((s: number, p: any) => s + parseFloat(p.realizedPnl), 0) / 1e6
  const openPnL = openPositions.reduce((s: number, p: any) => s + parseFloat(p.realizedPnl), 0) / 1e6

  console.log(`\nClosed PnL: $${closedPnL.toFixed(2)}`)
  console.log(`Open PnL: $${openPnL.toFixed(2)}`)

  console.log('\n\n💡 Hypothesis:')
  if (Math.abs(closedPnL - 31904) < 1000) {
    console.log('✅ ONLY counting CLOSED positions (amount=0) gives correct PnL!')
    console.log(`   Closed PnL: $${closedPnL.toFixed(2)} ≈ $31,904`)
  } else if (Math.abs(totalPnL / 1e6 / 2 - 31904) < 1000) {
    console.log('✅ Dividing by 2 gives correct PnL (YES/NO double counting)')
  } else {
    console.log('❓ Still investigating... need more analysis')
    console.log(`   Try manually checking a few positions on Polymarket`)
  }
}

analyzePnLStructure()
