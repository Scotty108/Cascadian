#!/usr/bin/env npx tsx

/**
 * Wallet P&L Comparison Checker
 *
 * Loads target wallets from CSV and compares base-wallet P&L (no executors)
 * Outputs comparison report to tmp/wallet_pnl_comparison_report.md + JSON
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'
import fs from 'fs'
import path from 'path'

// CLI arguments
const args = process.argv.slice(2)
const payoutSourceArg = args.find(a => a.startsWith('--payout-source='))
const PAYOUT_SOURCE = payoutSourceArg ? payoutSourceArg.split('=')[1] : 'market_resolutions_final'

interface WalletTarget {
  wallet: string
  expected_volume?: number
  expected_pnl?: number
  label?: string
}

interface WalletResult {
  wallet: string
  label?: string
  actual_realized_pnl: number
  actual_unrealized_pnl: number
  actual_net_pnl: number
  actual_volume: number
  actual_trades: number
  actual_markets: number
  expected_volume?: number
  expected_pnl?: number
  volume_delta?: number
  pnl_delta?: number
  settlement_value: number
  resolved_positions: number
  open_positions: number
}

async function loadTargetWallets(): Promise<WalletTarget[]> {
  const csvPath = '/tmp/target_wallets_to_compare.csv'

  if (!fs.existsSync(csvPath)) {
    console.log(`⚠️  CSV file not found: ${csvPath}`)
    console.log('   Creating sample CSV with XCN wallet...\n')

    const sampleCSV = `wallet,expected_volume,expected_pnl,label
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b,1500000,80000,XCN Strategy
`
    fs.writeFileSync(csvPath, sampleCSV)
    console.log(`✅ Created sample CSV: ${csvPath}\n`)
  }

  const content = fs.readFileSync(csvPath, 'utf-8')
  const lines = content.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase())

  // Support both schemas:
  // 1) wallet, expected_volume, expected_pnl, label (current default)
  // 2) wallet_address, pnl_usd, total_gains_usd, total_losses_usd (user-provided)

  const idx = (nameVariants: string[]) => headers.findIndex(h => nameVariants.includes(h))

  const walletIdx = idx(['wallet', 'wallet_address'])
  const expVolIdx = idx(['expected_volume', 'volume'])
  const expPnlIdx = idx(['expected_pnl', 'pnl', 'pnl_usd'])
  const labelIdx = idx(['label'])

  if (walletIdx === -1) {
    throw new Error('CSV missing wallet column (wallet or wallet_address)')
  }

  const wallets: WalletTarget[] = []

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = lines[i].split(',').map(v => v.trim())
    const wallet: WalletTarget = {
      wallet: values[walletIdx],
      expected_volume: expVolIdx >= 0 && values[expVolIdx] ? parseFloat(values[expVolIdx]) : undefined,
      expected_pnl: expPnlIdx >= 0 && values[expPnlIdx] ? parseFloat(values[expPnlIdx]) : undefined,
      label: labelIdx >= 0 ? values[labelIdx] || undefined : undefined,
    }
    wallets.push(wallet)
  }

  return wallets
}

async function calculateWalletPnL(wallet: string): Promise<Omit<WalletResult, 'wallet' | 'label' | 'expected_volume' | 'expected_pnl' | 'volume_delta' | 'pnl_delta'>> {
  // Query with settlements (provisional $1 binary payout)
  const query = `
    WITH trades_by_market AS (
      SELECT
        condition_id_norm_v3 AS cid,
        outcome_index_v3 AS outcome_idx,
        sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
        sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
        shares_buy - shares_sell AS net_shares,
        sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
        sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
        count() AS trades
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${wallet}')
        AND condition_id_norm_v3 != ''
      GROUP BY cid, outcome_idx
    ),
    with_resolutions AS (
      SELECT
        t.*,
        r.winning_outcome,
        r.winning_index,
        r.resolved_at,
        r.payout_numerators,
        r.payout_denominator,
        COALESCE(r.winning_outcome, r.winning_index) AS winning_outcome_norm,
        (length(r.payout_numerators) > 0 AND toFloat64(r.payout_denominator) > 0) AS has_payout,
        -- Real payout calculation with guard against NaN/array bounds/zero denom
        if(
          r.payout_denominator = 0
            OR r.payout_denominator IS NULL
            OR length(r.payout_numerators) < t.outcome_idx + 1,
          0,
          toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator)
        ) AS payout_per_share,
        t.net_shares * payout_per_share AS settlement_value
      FROM trades_by_market t
      LEFT JOIN ${PAYOUT_SOURCE} r
        ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
    ),
    resolved_only AS (
      SELECT * FROM with_resolutions WHERE winning_outcome_norm IS NOT NULL OR has_payout
    ),
    unresolved AS (
      SELECT * FROM with_resolutions WHERE NOT (winning_outcome_norm IS NOT NULL OR has_payout)
    )
    SELECT
      (SELECT COALESCE(sum(proceeds_sell - cost_buy + settlement_value), 0) FROM resolved_only) AS realized_pnl,
      (SELECT COALESCE(sum(proceeds_sell - cost_buy), 0) FROM unresolved) AS unrealized_pnl,
      (SELECT COALESCE(sum(cost_buy + proceeds_sell), 0) FROM with_resolutions) AS total_volume,
      (SELECT COALESCE(sum(trades), 0) FROM with_resolutions) AS total_trades,
      (SELECT count(DISTINCT cid) FROM with_resolutions) AS total_markets,
      (SELECT COALESCE(sum(settlement_value), 0) FROM resolved_only) AS settlement_value,
      (SELECT count() FROM resolved_only) AS resolved_positions,
      (SELECT count() FROM unresolved) AS open_positions
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })
  const data = await result.json<any>()
  const row = data[0]

  return {
    actual_realized_pnl: parseFloat(row.realized_pnl || 0),
    actual_unrealized_pnl: parseFloat(row.unrealized_pnl || 0),
    actual_net_pnl: parseFloat(row.realized_pnl || 0) + parseFloat(row.unrealized_pnl || 0),
    actual_volume: parseFloat(row.total_volume || 0),
    actual_trades: parseInt(row.total_trades || 0),
    actual_markets: parseInt(row.total_markets || 0),
    settlement_value: parseFloat(row.settlement_value || 0),
    resolved_positions: parseInt(row.resolved_positions || 0),
    open_positions: parseInt(row.open_positions || 0),
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('WALLET P&L COMPARISON CHECKER')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log(`Payout Source: ${PAYOUT_SOURCE}`)
  console.log()

  // Load target wallets
  console.log('Loading target wallets from CSV...')
  const targets = await loadTargetWallets()
  console.log(`Loaded ${targets.length} wallet(s)\n`)

  // Calculate P&L for each wallet
  const results: WalletResult[] = []

  for (const target of targets) {
    console.log(`Processing ${target.wallet.substring(0, 10)}... (${target.label || 'unlabeled'})`)

    const pnl = await calculateWalletPnL(target.wallet)

    const result: WalletResult = {
      wallet: target.wallet,
      label: target.label,
      ...pnl,
      expected_volume: target.expected_volume,
      expected_pnl: target.expected_pnl,
      volume_delta: target.expected_volume ? pnl.actual_volume - target.expected_volume : undefined,
      pnl_delta: target.expected_pnl ? pnl.actual_net_pnl - target.expected_pnl : undefined,
    }

    results.push(result)

    console.log(`  ✓ Actual P&L: $${pnl.actual_net_pnl.toLocaleString()}`)
    console.log(`  ✓ Volume: $${pnl.actual_volume.toLocaleString()}`)
    console.log()
  }

  // Generate markdown report
  const mdLines: string[] = []
  mdLines.push('# Wallet P&L Comparison Report')
  mdLines.push('')
  mdLines.push(`**Generated:** ${new Date().toISOString()}`)
  mdLines.push(`**Wallets Analyzed:** ${results.length}`)
  mdLines.push(`**Payout Source:** ${PAYOUT_SOURCE}`)
  mdLines.push('')
  mdLines.push('---')
  mdLines.push('')

  results.forEach((r, i) => {
    mdLines.push(`## ${i + 1}. ${r.label || 'Wallet'} (\`${r.wallet.substring(0, 10)}...\`)`)
    mdLines.push('')
    mdLines.push('### Actual Results (Base Wallet Only)')
    mdLines.push('')
    mdLines.push('| Metric | Value |')
    mdLines.push('|--------|-------|')
    mdLines.push(`| Realized P&L | $${r.actual_realized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })} |`)
    mdLines.push(`| Unrealized P&L | $${r.actual_unrealized_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })} |`)
    mdLines.push(`| **Net P&L** | **$${r.actual_net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}** |`)
    mdLines.push(`| Total Volume | $${r.actual_volume.toLocaleString('en-US', { minimumFractionDigits: 2 })} |`)
    mdLines.push(`| Total Trades | ${r.actual_trades.toLocaleString('en-US')} |`)
    mdLines.push(`| Unique Markets | ${r.actual_markets.toLocaleString('en-US')} |`)
    mdLines.push(`| Settlement Value | $${r.settlement_value.toLocaleString('en-US', { minimumFractionDigits: 2 })} |`)
    mdLines.push(`| Resolved Positions | ${r.resolved_positions} |`)
    mdLines.push(`| Open Positions | ${r.open_positions} |`)
    mdLines.push('')

    if (r.expected_volume !== undefined || r.expected_pnl !== undefined) {
      mdLines.push('### Expected vs Actual')
      mdLines.push('')
      mdLines.push('| Metric | Expected | Actual | Delta |')
      mdLines.push('|--------|----------|--------|-------|')

      if (r.expected_volume !== undefined) {
        const deltaSymbol = r.volume_delta! >= 0 ? '+' : ''
        const match = Math.abs(r.volume_delta!) / r.expected_volume < 0.1 ? '✅' : '❌'
        mdLines.push(`| Volume | $${r.expected_volume.toLocaleString()} | $${r.actual_volume.toLocaleString()} | ${deltaSymbol}$${r.volume_delta!.toLocaleString()} ${match} |`)
      }

      if (r.expected_pnl !== undefined) {
        const deltaSymbol = r.pnl_delta! >= 0 ? '+' : ''
        const match = Math.abs(r.pnl_delta!) / Math.abs(r.expected_pnl) < 0.1 ? '✅' : '❌'
        mdLines.push(`| P&L | $${r.expected_pnl.toLocaleString()} | $${r.actual_net_pnl.toLocaleString()} | ${deltaSymbol}$${r.pnl_delta!.toLocaleString()} ${match} |`)
      }

      mdLines.push('')
    }

    mdLines.push('---')
    mdLines.push('')
  })

  mdLines.push('## Summary')
  mdLines.push('')
  mdLines.push('| Wallet | Label | Net P&L | Volume | Trades |')
  mdLines.push('|--------|-------|---------|--------|--------|')
  results.forEach(r => {
    mdLines.push(`| \`${r.wallet.substring(0, 10)}...\` | ${r.label || '-'} | $${r.actual_net_pnl.toLocaleString()} | $${r.actual_volume.toLocaleString()} | ${r.actual_trades.toLocaleString()} |`)
  })
  mdLines.push('')

  // Write markdown report
  const mdPath = '/tmp/wallet_pnl_comparison_report.md'
  fs.writeFileSync(mdPath, mdLines.join('\n'))
  console.log(`✅ Markdown report: ${mdPath}`)

  // Write JSON report
  const jsonPath = '/tmp/wallet_pnl_comparison_report.json'
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  console.log(`✅ JSON report: ${jsonPath}`)
  console.log()
}

main().catch(console.error)
