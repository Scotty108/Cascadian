/**
 * Compare PnL from different data sources
 * - Polymarket Data-API (closed-positions endpoint)
 * - Goldsky (via our omega score calculation)
 */

const TEST_WALLET = '0x059fd0a47dbf42f2d723ddb5739cee6f3e6f9728'

async function main() {
  console.log(`\n🔍 Comparing PnL Data Sources for ${TEST_WALLET}\n`)
  console.log('=' .repeat(80))

  // Source 1: Polymarket Data-API closed positions
  console.log('\n📊 Source 1: Polymarket Data-API (closed-positions)\n')
  try {
    const response = await fetch(`http://localhost:3000/api/polymarket/wallet/${TEST_WALLET}/closed-positions?limit=1000`)
    const data = await response.json()

    if (data.success && data.data) {
      console.log(`Found ${data.data.length} closed positions`)

      // Calculate total realized PnL from Polymarket
      const totalRealizedPnL = data.data.reduce((sum: number, pos: any) => {
        return sum + (pos.realizedPnl || 0)
      }, 0)

      console.log(`Total Realized PnL (raw): $${totalRealizedPnL.toFixed(2)}`)

      // Show sample positions
      console.log('\nSample positions:')
      data.data.slice(0, 5).forEach((pos: any, i: number) => {
        console.log(`  ${i + 1}. ${pos.title?.slice(0, 50)}...`)
        console.log(`     PnL: $${(pos.realizedPnl || 0).toFixed(2)}`)
      })

      // Count wins/losses
      const wins = data.data.filter((p: any) => (p.realizedPnl || 0) > 0).length
      const losses = data.data.filter((p: any) => (p.realizedPnl || 0) < 0).length
      console.log(`\nWins: ${wins}, Losses: ${losses}, Total: ${data.data.length}`)

    } else {
      console.error('Failed to fetch from Polymarket API:', data.error)
    }
  } catch (error) {
    console.error('Error fetching Polymarket data:', error)
  }

  // Source 2: Goldsky (via omega score calculation)
  console.log('\n\n📊 Source 2: Goldsky (via calculateWalletOmegaScore)\n')
  try {
    const { calculateWalletOmegaScore } = await import('@/lib/metrics/omega-from-goldsky')
    const omegaScore = await calculateWalletOmegaScore(TEST_WALLET)

    if (omegaScore) {
      console.log(`Closed Positions: ${omegaScore.closed_positions}`)
      console.log(`Total PnL: $${omegaScore.total_pnl.toFixed(2)}`)
      console.log(`Total Gains: $${omegaScore.total_gains.toFixed(2)}`)
      console.log(`Total Losses: $${omegaScore.total_losses.toFixed(2)}`)
      console.log(`Win Rate: ${(omegaScore.win_rate * 100).toFixed(1)}%`)
    }
  } catch (error) {
    console.error('Error fetching Goldsky data:', error)
  }

  // Expected from Polymarket UI
  console.log('\n\n📊 Expected from Polymarket UI:\n')
  console.log('All-Time P/L: -$113.66')
  console.log('Active Positions P/L: ~-$2.34')
  console.log('Therefore Realized P/L should be: ~-$111.32')

  console.log('\n' + '='.repeat(80) + '\n')
}

main().catch(console.error)
