import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function syncWalletScoresToDB(walletAddresses: string[]) {
  console.log(`🔄 Syncing ${walletAddresses.length} wallet scores to database...\n`)

  let successCount = 0
  let skipCount = 0
  let errorCount = 0

  for (const wallet of walletAddresses) {
    console.log(`Processing: ${wallet}`)

    try {
      const score = await calculateWalletOmegaScore(wallet)

      if (!score) {
        console.log(`  ⏭️  Skipped (no PnL data)\n`)
        skipCount++
        continue
      }

      // Upsert to database
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
        console.log(`  ❌ Error: ${error.message}\n`)
        errorCount++
      } else {
        console.log(
          `  ✅ Saved: Grade ${score.grade} | Omega ${score.omega_ratio.toFixed(2)} | P&L $${score.total_pnl.toFixed(2)}\n`
        )
        successCount++
      }
    } catch (error) {
      console.log(`  ❌ Error: ${(error as Error).message}\n`)
      errorCount++
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log('SYNC SUMMARY')
  console.log('='.repeat(60))
  console.log(`✅ Successfully synced: ${successCount}`)
  console.log(`⏭️  Skipped (no data): ${skipCount}`)
  console.log(`❌ Errors: ${errorCount}`)
  console.log(`📊 Total processed: ${walletAddresses.length}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/sync-wallet-scores-to-db.ts <wallet1> <wallet2> ...')
    console.log('\nExample:')
    console.log('  npx tsx scripts/sync-wallet-scores-to-db.ts 0x123... 0x456...')
    console.log('\nOr use discovered wallets:')
    console.log('  npx tsx scripts/sync-wallet-scores-to-db.ts \\')
    console.log('    0xc5d563a36ae78145c45a50134d48a1215220f80a \\')
    console.log('    0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e \\')
    console.log('    0x241f846866c2de4fb67cdb0ca6b963d85e56ef50')
    process.exit(1)
  }

  await syncWalletScoresToDB(args)
}

main()
