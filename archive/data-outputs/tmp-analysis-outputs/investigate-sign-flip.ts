#!/usr/bin/env npx tsx
/**
 * INVESTIGATE SIGN FLIP - Compare 3 wallets between backup and production
 *
 * Goal: Identify where signs re-flipped (extra multiplier or leftover cashflow logic)
 *
 * Three wallets to investigate (still showing negative when should be positive):
 * 1. 0x7f3c8979... Expected +$179K, Actual -$9.5M (-5,393% error)
 * 2. 0x1489046c... Expected +$138K, Actual -$3.7M (-2,773% error)
 * 3. 0x8e9eedf2... Expected +$360K, Actual -$2 (-100% error)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

const WALLETS_TO_INVESTIGATE = [
  '0x7f3c8979e6a0eb28b951dc948bf2969dcdcea24a',
  '0x1489046c1db6d67d2f90886fb91b189165f5c67b',
  '0x8e9eedf26a13a6e20ccf73acfb41fe37d69b0e7e'
]

interface WalletComparison {
  wallet: string
  expected_pnl: number
  backup_summary: {
    total_pnl: number
    num_markets: number
    num_positive: number
    num_negative: number
    num_zero: number
  }
  production_summary: {
    total_pnl: number
    num_markets: number
    num_positive: number
    num_negative: number
    num_zero: number
  }
  sample_markets: Array<{
    condition_id: string
    backup_pnl: number
    production_pnl: number
    delta: number
    sign_flipped: boolean
  }>
}

async function investigateSignFlip() {
  const client = getClickHouseClient()
  const results: WalletComparison[] = []

  console.log('\n🔍 INVESTIGATING SIGN FLIP - 3 Problematic Wallets\n')
  console.log('=' .repeat(80) + '\n')

  const expectedPnL: Record<string, number> = {
    '0x7f3c8979e6a0eb28b951dc948bf2969dcdcea24a': 179000,
    '0x1489046c1db6d67d2f90886fb91b189165f5c67b': 138000,
    '0x8e9eedf26a13a6e20ccf73acfb41fe37d69b0e7e': 360000
  }

  try {
    for (const wallet of WALLETS_TO_INVESTIGATE) {
      console.log(`\n📊 Wallet: ${wallet}`)
      console.log(`   Expected P&L: $${(expectedPnL[wallet] / 1000).toFixed(1)}K\n`)

      // Check if backup table exists
      const backupExistsResult = await client.query({
        query: `
          SELECT count() as exists
          FROM system.tables
          WHERE database = 'default'
            AND name = 'vw_wallet_pnl_calculated_backup'
        `,
        format: 'JSONEachRow'
      })
      const backupExists = await backupExistsResult.json<any>()

      if (parseInt(backupExists[0].exists) === 0) {
        console.log('   ⚠️  WARNING: vw_wallet_pnl_calculated_backup does not exist!')
        console.log('   Checking for alternative backup tables...\n')

        // List all tables with "backup" or "pnl" in name
        const tablesResult = await client.query({
          query: `
            SELECT name, total_rows
            FROM system.tables
            WHERE database = 'default'
              AND (name LIKE '%backup%' OR name LIKE '%pnl%')
            ORDER BY total_rows DESC
            LIMIT 20
          `,
          format: 'JSONEachRow'
        })
        const tables = await tablesResult.json<any>()

        console.log('   Available backup/PnL tables:')
        tables.forEach((t: any) => {
          console.log(`   - ${t.name}: ${parseInt(t.total_rows).toLocaleString()} rows`)
        })

        // Skip to next wallet
        continue
      }

      // Get backup data summary
      console.log('   1️⃣  BACKUP TABLE (vw_wallet_pnl_calculated_backup):')
      const backupSummaryResult = await client.query({
        query: `
          SELECT
            SUM(realized_pnl_usd) as total_pnl,
            COUNT(*) as num_markets,
            SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as num_positive,
            SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as num_negative,
            SUM(CASE WHEN realized_pnl_usd = 0 THEN 1 ELSE 0 END) as num_zero
          FROM vw_wallet_pnl_calculated_backup
          WHERE lower(wallet) = lower('${wallet}')
        `,
        format: 'JSONEachRow'
      })
      const backupSummary = await backupSummaryResult.json<any>()

      if (parseInt(backupSummary[0].num_markets) === 0) {
        console.log(`      ⚠️  No data found in backup for this wallet!`)
        console.log(`      This means the backup doesn't have this wallet's data.`)
        console.log(`      Possible reasons:`)
        console.log(`      - Backup was created after wallet was processed`)
        console.log(`      - Wallet address format mismatch (case sensitivity)`)
        console.log(`      - Backup VIEW definition doesn't include this wallet\n`)

        // Check if wallet exists in production
        const prodCheckResult = await client.query({
          query: `SELECT COUNT(*) as count FROM realized_pnl_by_market_final WHERE lower(wallet) = lower('${wallet}')`,
          format: 'JSONEachRow'
        })
        const prodCheck = await prodCheckResult.json<any>()

        if (parseInt(prodCheck[0].count) > 0) {
          console.log(`      ✅ Wallet DOES exist in production (${parseInt(prodCheck[0].count)} markets)`)
          console.log(`      This confirms backup issue, not wallet issue.\n`)
        }

        continue
      }

      console.log(`      Total P&L: $${(parseFloat(backupSummary[0].total_pnl) / 1000).toFixed(1)}K`)
      console.log(`      Markets: ${backupSummary[0].num_markets}`)
      console.log(`      Positive: ${backupSummary[0].num_positive} | Negative: ${backupSummary[0].num_negative} | Zero: ${backupSummary[0].num_zero}`)

      // Get production data summary
      console.log('\n   2️⃣  PRODUCTION TABLE (realized_pnl_by_market_final):')
      const prodSummaryResult = await client.query({
        query: `
          SELECT
            SUM(realized_pnl_usd) as total_pnl,
            COUNT(*) as num_markets,
            SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as num_positive,
            SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as num_negative,
            SUM(CASE WHEN realized_pnl_usd = 0 THEN 1 ELSE 0 END) as num_zero
          FROM realized_pnl_by_market_final
          WHERE wallet = '${wallet}'
        `,
        format: 'JSONEachRow'
      })
      const prodSummary = await prodSummaryResult.json<any>()

      console.log(`      Total P&L: $${(parseFloat(prodSummary[0].total_pnl) / 1000).toFixed(1)}K`)
      console.log(`      Markets: ${prodSummary[0].num_markets}`)
      console.log(`      Positive: ${prodSummary[0].num_positive} | Negative: ${prodSummary[0].num_negative} | Zero: ${prodSummary[0].num_zero}`)

      // Get sample markets showing sign differences
      console.log('\n   3️⃣  SAMPLE MARKETS (sign flips):')

      // Use lower() and normalize condition_id for JOIN
      const sampleResult = await client.query({
        query: `
          SELECT
            lower(replaceAll(b.condition_id, '0x', '')) as condition_id,
            b.realized_pnl_usd as backup_pnl,
            p.realized_pnl_usd as production_pnl,
            p.realized_pnl_usd - b.realized_pnl_usd as delta,
            CASE
              WHEN (b.realized_pnl_usd > 0 AND p.realized_pnl_usd < 0)
                OR (b.realized_pnl_usd < 0 AND p.realized_pnl_usd > 0)
              THEN true
              ELSE false
            END as sign_flipped
          FROM vw_wallet_pnl_calculated_backup b
          INNER JOIN realized_pnl_by_market_final p
            ON lower(b.wallet) = lower(p.wallet)
            AND lower(replaceAll(b.condition_id, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
          WHERE lower(b.wallet) = lower('${wallet}')
            AND b.realized_pnl_usd != 0
          ORDER BY ABS(p.realized_pnl_usd - b.realized_pnl_usd) DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const samples = await sampleResult.json<any>()

      samples.forEach((row: any, idx: number) => {
        const signSymbol = row.sign_flipped ? '🔄' : '  '
        console.log(`      ${signSymbol} ${idx + 1}. ${row.condition_id.substring(0, 16)}...`)
        console.log(`         Backup: $${(parseFloat(row.backup_pnl) / 1000).toFixed(2)}K → Production: $${(parseFloat(row.production_pnl) / 1000).toFixed(2)}K`)
        console.log(`         Delta: $${(parseFloat(row.delta) / 1000).toFixed(2)}K${row.sign_flipped ? ' ⚠️  SIGN FLIPPED!' : ''}`)
      })

      // Store results
      results.push({
        wallet,
        expected_pnl: expectedPnL[wallet],
        backup_summary: {
          total_pnl: parseFloat(backupSummary[0].total_pnl),
          num_markets: parseInt(backupSummary[0].num_markets),
          num_positive: parseInt(backupSummary[0].num_positive),
          num_negative: parseInt(backupSummary[0].num_negative),
          num_zero: parseInt(backupSummary[0].num_zero)
        },
        production_summary: {
          total_pnl: parseFloat(prodSummary[0].total_pnl),
          num_markets: parseInt(prodSummary[0].num_markets),
          num_positive: parseInt(prodSummary[0].num_positive),
          num_negative: parseInt(prodSummary[0].num_negative),
          num_zero: parseInt(prodSummary[0].num_zero)
        },
        sample_markets: samples.map((s: any) => ({
          condition_id: s.condition_id,
          backup_pnl: parseFloat(s.backup_pnl),
          production_pnl: parseFloat(s.production_pnl),
          delta: parseFloat(s.delta),
          sign_flipped: s.sign_flipped
        }))
      })

      console.log('\n' + '-'.repeat(80))
    }

    // Analysis summary
    console.log('\n\n📈 ANALYSIS SUMMARY\n')
    console.log('=' .repeat(80) + '\n')

    results.forEach((r, idx) => {
      console.log(`${idx + 1}. ${r.wallet}`)
      console.log(`   Expected: $${(r.expected_pnl / 1000).toFixed(1)}K`)
      console.log(`   Backup:   $${(r.backup_summary.total_pnl / 1000).toFixed(1)}K`)
      console.log(`   Production: $${(r.production_summary.total_pnl / 1000).toFixed(1)}K`)

      const backupToExpected = ((r.backup_summary.total_pnl / r.expected_pnl - 1) * 100).toFixed(1)
      const prodToExpected = ((r.production_summary.total_pnl / r.expected_pnl - 1) * 100).toFixed(1)

      console.log(`   Backup vs Expected: ${backupToExpected}% ${parseFloat(backupToExpected) > 0 ? 'higher' : 'lower'}`)
      console.log(`   Production vs Expected: ${prodToExpected}% ${parseFloat(prodToExpected) > 0 ? 'higher' : 'lower'}`)

      // Check for sign consistency
      const backupSign = r.backup_summary.total_pnl > 0 ? '+' : r.backup_summary.total_pnl < 0 ? '-' : '0'
      const prodSign = r.production_summary.total_pnl > 0 ? '+' : r.production_summary.total_pnl < 0 ? '-' : '0'

      if (backupSign !== prodSign) {
        console.log(`   ⚠️  TOTAL SIGN FLIPPED: ${backupSign} → ${prodSign}`)
      }

      // Count individual market sign flips
      const signFlips = r.sample_markets.filter(m => m.sign_flipped).length
      if (signFlips > 0) {
        console.log(`   🔄 ${signFlips}/${r.sample_markets.length} sample markets have sign flips`)
      }

      console.log('')
    })

    // Hypotheses
    console.log('\n💡 HYPOTHESES\n')
    console.log('=' .repeat(80) + '\n')

    console.log('1. **Extra Multiplier Applied:**')
    console.log('   - If backup values were correct but production has wrong sign')
    console.log('   - Check: Was `-1 *` multiplier applied during recovery?')
    console.log('   - Evidence: Compare sign distributions\n')

    console.log('2. **Leftover Negative Cashflow Logic:**')
    console.log('   - If certain markets use old cashflow calculation')
    console.log('   - Check: Do sign-flipped markets share common traits?')
    console.log('   - Evidence: Query market properties for flipped vs non-flipped\n')

    console.log('3. **Partial Sign Correction:**')
    console.log('   - If some code paths got the fix but not others')
    console.log('   - Check: Are there multiple P&L calculation branches?')
    console.log('   - Evidence: Review rebuild-pnl-materialized.ts for conditional logic\n')

    // Save results
    const outputPath = 'tmp/sign_flip_investigation_data.json'
    writeFileSync(outputPath, JSON.stringify(results, null, 2))
    console.log(`\n✅ Raw data saved to: ${outputPath}\n`)

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

investigateSignFlip()
