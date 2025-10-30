#!/usr/bin/env tsx
/**
 * Fast Resolution Application
 * Uses batched SQL UPDATEs instead of per-wallet queries
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  console.log('🚀 Fast Resolution Application\n')

  // Load resolution map
  const resData = JSON.parse(fs.readFileSync('data/expanded_resolution_map.json', 'utf-8'))
  console.log('Loaded', resData.resolutions.length, 'resolutions\n')

  // Filter out resolutions with NULL payouts
  const validResolutions = resData.resolutions.filter((r: any) =>
    r.payout_yes !== null && r.payout_no !== null &&
    r.payout_yes !== undefined && r.payout_no !== undefined
  )
  console.log('Valid resolutions (non-null payouts):', validResolutions.length, '\n')

  const FEE_RATE = 0.002
  let totalUpdated = 0

  // Process in batches of 100 conditions at a time
  const batchSize = 100
  for (let i = 0; i < validResolutions.length; i += batchSize) {
    const batch = validResolutions.slice(i, i + batchSize)

    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(validResolutions.length/batchSize)}...`)

    for (const res of batch) {
      const payoutYes = res.payout_yes
      const payoutNo = res.payout_no

      // Update YES side trades
      try {
        await clickhouse.command({
          query: `
            ALTER TABLE trades_raw
            UPDATE
              outcome = ${payoutYes},
              is_resolved = 1,
              close_price = ${payoutYes}.0,
              pnl_gross = (shares * ${payoutYes}) - usd_value,
              fee_usd = usd_value * ${FEE_RATE},
              pnl_net = ((shares * ${payoutYes}) - usd_value) - (usd_value * ${FEE_RATE})
            WHERE condition_id = '${res.condition_id}'
              AND side = 'YES'
              AND is_resolved = 0
          `
        })
      } catch (e) {
        console.error('Error updating YES trades for', res.condition_id, e)
      }

      // Update NO side trades
      try {
        await clickhouse.command({
          query: `
            ALTER TABLE trades_raw
            UPDATE
              outcome = ${payoutNo},
              is_resolved = 1,
              close_price = ${payoutNo}.0,
              pnl_gross = (shares * ${payoutNo}) - usd_value,
              fee_usd = usd_value * ${FEE_RATE},
              pnl_net = ((shares * ${payoutNo}) - usd_value) - (usd_value * ${FEE_RATE})
            WHERE condition_id = '${res.condition_id}'
              AND side = 'NO'
              AND is_resolved = 0
          `
        })
      } catch (e) {
        console.error('Error updating NO trades for', res.condition_id, e)
      }
    }

    totalUpdated += batch.length
    console.log(`  Updated ${totalUpdated}/${validResolutions.length} conditions`)
  }

  console.log('\n✅ Resolution application complete!')
  console.log('Waiting for mutations to finish...')

  // Wait for mutations
  let pending = 1
  while (pending > 0) {
    const result = await clickhouse.query({
      query: 'SELECT count() as pending FROM system.mutations WHERE is_done = 0 AND table = \'trades_raw\'',
      format: 'JSONEachRow'
    })
    const data: any = await result.json()
    pending = parseInt(data[0].pending)
    if (pending > 0) {
      console.log(`  Waiting for ${pending} mutations...`)
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  console.log('✅ All mutations complete!')
}

main()
