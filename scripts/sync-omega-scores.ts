import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function syncOmegaScores() {
  console.log('📊 Syncing Omega Scores to Database\n')

  // Test wallets with data
  const wallets = [
    '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50', // Grade A, high Omega
    '0x537494c54dee9162534675712f2e625c9713042e', // Grade B
    '0x066ea9d5dacc81ea3a0535ffe13209d55571ceb2', // Grade B
  ]

  for (const wallet of wallets) {
    console.log(`\n🔄 Processing ${wallet}...`)

    try {
      // Calculate Omega score
      const score = await calculateWalletOmegaScore(wallet)

      if (!score) {
        console.log('  ⚠️  No data found for wallet')
        continue
      }

      // Save to database
      const { error } = await supabase.from('wallet_scores').upsert(
        {
          wallet_address: score.wallet_address,
          omega_ratio: score.omega_ratio,
          omega_momentum: score.omega_momentum,
          total_positions: score.total_positions,
          closed_positions: score.closed_positions,
          total_pnl: score.total_pnl,
          total_gains: score.total_gains,
          total_losses: score.total_losses,
          win_rate: score.win_rate,
          avg_gain: score.avg_gain,
          avg_loss: score.avg_loss,
          momentum_direction: score.momentum_direction,
          grade: score.grade,
          meets_minimum_trades: score.meets_minimum_trades,
          calculated_at: new Date().toISOString(),
        },
        {
          onConflict: 'wallet_address',
        }
      )

      if (error) {
        console.log(`  ❌ Database error: ${error.message}`)
      } else {
        console.log(`  ✅ Saved: Grade ${score.grade} | Omega ${score.omega_ratio.toFixed(2)} | P&L $${score.total_pnl.toFixed(2)}`)
      }
    } catch (error) {
      console.log(`  ❌ Error: ${(error as Error).message}`)
    }
  }

  console.log('\n\n✅ Sync Complete!')

  // Verify what's in the database
  console.log('\n📋 Current Database Contents:\n')
  const { data, error } = await supabase
    .from('wallet_scores')
    .select('wallet_address, grade, omega_ratio, total_pnl, momentum_direction')
    .order('omega_ratio', { ascending: false })

  if (error) {
    console.log(`❌ Query error: ${error.message}`)
  } else {
    data?.forEach((row, i) => {
      console.log(`${i + 1}. [${row.grade}] ${row.wallet_address.substring(0, 10)}...`)
      console.log(`   Omega: ${row.omega_ratio.toFixed(2)} | P&L: $${parseFloat(row.total_pnl).toFixed(2)} | ${row.momentum_direction}`)
    })
  }
}

syncOmegaScores()
