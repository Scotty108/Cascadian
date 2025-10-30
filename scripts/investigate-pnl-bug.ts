#!/usr/bin/env tsx
/**
 * P&L Investigation Script
 *
 * Investigates why only 1% of 28k wallets show as profitable
 * Tests multiple hypotheses in parallel
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { writeFileSync } from 'fs'

interface Investigation {
  name: string
  findings: string[]
  examples: any[]
  severity: 'CRITICAL' | 'WARNING' | 'INFO'
}

const investigations: Investigation[] = []

/**
 * Investigation 1: Sample wallet verification
 * Pick 5 random wallets, manually calculate P&L, compare to stored values
 */
async function investigation1_SampleWalletVerification() {
  console.log('\n🔍 Investigation 1: Sample Wallet Verification')
  console.log('=' .repeat(80))

  const inv: Investigation = {
    name: 'Sample Wallet Verification',
    findings: [],
    examples: [],
    severity: 'INFO'
  }

  try {
    // Get 5 random wallets with >10 trades and >$10k volume
    const walletsResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          COUNT(*) as trade_count,
          SUM(usd_value) as total_volume
        FROM trades_raw
        WHERE market_id != ''
        GROUP BY wallet_address
        HAVING trade_count > 10 AND total_volume > 10000
        ORDER BY rand()
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })

    const wallets = await walletsResult.json<{ wallet_address: string, trade_count: string, total_volume: string }>()
    inv.findings.push(`Sampled ${wallets.length} random wallets`)

    for (const wallet of wallets) {
      console.log(`\n  Analyzing wallet: ${wallet.wallet_address.slice(0, 42)}...`)

      // Get ALL trades for this wallet
      const tradesResult = await clickhouse.query({
        query: `
          SELECT
            trade_id,
            wallet_address,
            market_id,
            condition_id,
            timestamp,
            side,
            entry_price,
            shares,
            usd_value,
            outcome,
            fee_usd,
            pnl_gross,
            pnl_net,
            realized_pnl_usd,
            is_resolved
          FROM trades_raw
          WHERE wallet_address = '${wallet.wallet_address}'
          ORDER BY timestamp
        `,
        format: 'JSONEachRow'
      })

      const trades = await tradesResult.json<any>()

      // Manual P&L calculation
      let manualPnl = 0
      let resolvedCount = 0
      let winCount = 0
      let lossCount = 0

      for (const trade of trades) {
        if (trade.is_resolved === 1 && trade.realized_pnl_usd !== null) {
          const pnl = parseFloat(trade.realized_pnl_usd)
          manualPnl += pnl
          resolvedCount++

          if (pnl > 0) winCount++
          else if (pnl < 0) lossCount++
        }
      }

      const manualWinRate = resolvedCount > 0 ? winCount / resolvedCount : 0

      // Get stored metrics
      const metricsResult = await clickhouse.query({
        query: `
          SELECT
            metric_9_net_pnl_usd,
            metric_2_omega_net,
            metric_12_hit_rate,
            metric_22_resolved_bets
          FROM wallet_metrics_complete
          WHERE wallet_address = '${wallet.wallet_address}'
            AND window = 'lifetime'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      })

      const metrics = await metricsResult.json<any>()
      const storedMetrics = metrics[0] || {}

      const storedPnl = storedMetrics.metric_9_net_pnl_usd ? parseFloat(storedMetrics.metric_9_net_pnl_usd) : 0
      const storedOmega = storedMetrics.metric_2_omega_net ? parseFloat(storedMetrics.metric_2_omega_net) : 0
      const storedWinRate = storedMetrics.metric_12_hit_rate ? parseFloat(storedMetrics.metric_12_hit_rate) : 0

      const pnlDiff = Math.abs(manualPnl - storedPnl)
      const winRateDiff = Math.abs(manualWinRate - storedWinRate)

      const example = {
        wallet_address: wallet.wallet_address.slice(0, 42),
        total_trades: trades.length,
        resolved_trades: resolvedCount,
        manual_pnl: manualPnl.toFixed(2),
        stored_pnl: storedPnl.toFixed(2),
        pnl_difference: pnlDiff.toFixed(2),
        manual_win_rate: (manualWinRate * 100).toFixed(1) + '%',
        stored_win_rate: (storedWinRate * 100).toFixed(1) + '%',
        stored_omega: storedOmega.toFixed(4),
        wins: winCount,
        losses: lossCount,
        match: pnlDiff < 1 ? 'YES' : 'NO'
      }

      inv.examples.push(example)

      console.log(`    Total trades: ${trades.length}, Resolved: ${resolvedCount}`)
      console.log(`    Manual P&L: $${manualPnl.toFixed(2)}`)
      console.log(`    Stored P&L: $${storedPnl.toFixed(2)}`)
      console.log(`    Difference: $${pnlDiff.toFixed(2)} ${pnlDiff < 1 ? '✅' : '❌'}`)
      console.log(`    Manual Win Rate: ${(manualWinRate * 100).toFixed(1)}%`)
      console.log(`    Stored Win Rate: ${(storedWinRate * 100).toFixed(1)}%`)
      console.log(`    Stored Omega: ${storedOmega.toFixed(4)}`)

      if (pnlDiff > 1) {
        inv.findings.push(`❌ MISMATCH: Wallet ${wallet.wallet_address.slice(0, 20)} has P&L diff of $${pnlDiff.toFixed(2)}`)
        inv.severity = 'CRITICAL'
      }
    }

    if (inv.examples.every(e => e.match === 'YES')) {
      inv.findings.push(`✅ All sampled wallets have matching P&L calculations`)
    }

  } catch (error) {
    inv.findings.push(`❌ ERROR: ${error}`)
    inv.severity = 'CRITICAL'
  }

  investigations.push(inv)
}

/**
 * Investigation 2: Check Omega Formula
 * Verify the omega ratio formula is correct
 */
async function investigation2_OmegaFormula() {
  console.log('\n🔍 Investigation 2: Omega Formula Verification')
  console.log('=' .repeat(80))

  const inv: Investigation = {
    name: 'Omega Formula Verification',
    findings: [],
    examples: [],
    severity: 'INFO'
  }

  try {
    // Get a sample of wallets with their omega components
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) as total_gains,
          SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END) as total_losses,
          SUM(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE 0 END) as net_pnl,
          COUNT(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN 1 END) as win_count,
          COUNT(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN 1 END) as loss_count,
          COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_count
        FROM trades_raw
        WHERE market_id != ''
        GROUP BY wallet_address
        HAVING resolved_count > 10
        ORDER BY rand()
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })

    const wallets = await result.json<any>()

    inv.findings.push(`Formula check: Omega = Total Gains / Total Losses (absolute value)`)
    inv.findings.push(`Analyzed ${wallets.length} wallets for formula verification`)

    let negativeOmegaCount = 0
    let zeroLossesCount = 0
    let invertedCount = 0

    for (const wallet of wallets) {
      const gains = parseFloat(wallet.total_gains)
      const losses = parseFloat(wallet.total_losses)
      const netPnl = parseFloat(wallet.net_pnl)
      const winCount = parseInt(wallet.win_count)
      const lossCount = parseInt(wallet.loss_count)

      // Calculate omega manually
      const manualOmega = losses > 0 ? gains / losses : null

      // Get stored omega
      const metricsResult = await clickhouse.query({
        query: `
          SELECT metric_2_omega_net
          FROM wallet_metrics_complete
          WHERE wallet_address = '${wallet.wallet_address}'
            AND window = 'lifetime'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      })

      const metrics = await metricsResult.json<any>()
      const storedOmega = metrics[0]?.metric_2_omega_net ? parseFloat(metrics[0].metric_2_omega_net) : null

      const example: any = {
        wallet: wallet.wallet_address.slice(0, 20),
        gains: gains.toFixed(2),
        losses: losses.toFixed(2),
        net_pnl: netPnl.toFixed(2),
        wins: winCount,
        losses_count: lossCount,
        manual_omega: manualOmega ? manualOmega.toFixed(4) : 'N/A',
        stored_omega: storedOmega ? storedOmega.toFixed(4) : 'N/A',
        is_profitable: netPnl > 0 ? 'YES' : 'NO'
      }

      if (losses === 0 && gains > 0) {
        zeroLossesCount++
        example.issue = 'Zero losses - omega undefined'
        inv.findings.push(`⚠️  Wallet ${wallet.wallet_address.slice(0, 20)} has zero losses (all wins!)`)
      }

      if (manualOmega && manualOmega < 0) {
        negativeOmegaCount++
        example.issue = 'Negative omega - formula error?'
        inv.severity = 'CRITICAL'
      }

      // Check if formula is inverted (losses/gains instead of gains/losses)
      if (manualOmega && storedOmega && Math.abs(manualOmega - (1/storedOmega)) < 0.01) {
        invertedCount++
        example.issue = 'INVERTED FORMULA DETECTED'
        inv.severity = 'CRITICAL'
        inv.findings.push(`❌ CRITICAL: Omega formula appears INVERTED for ${wallet.wallet_address.slice(0, 20)}`)
      }

      inv.examples.push(example)
    }

    if (negativeOmegaCount > 0) {
      inv.findings.push(`❌ Found ${negativeOmegaCount} wallets with negative omega (impossible)`)
    }

    if (zeroLossesCount > 0) {
      inv.findings.push(`ℹ️  Found ${zeroLossesCount} wallets with zero losses (perfect record)`)
    }

    if (invertedCount > 0) {
      inv.findings.push(`❌ CRITICAL BUG: ${invertedCount} wallets show INVERTED omega formula`)
      inv.findings.push(`   Expected: Omega = Gains / Losses`)
      inv.findings.push(`   Actual: Omega = Losses / Gains`)
    }

  } catch (error) {
    inv.findings.push(`❌ ERROR: ${error}`)
    inv.severity = 'CRITICAL'
  }

  investigations.push(inv)
}

/**
 * Investigation 3: Check Resolution Accuracy
 * Verify that trades are being marked with correct winners
 */
async function investigation3_ResolutionAccuracy() {
  console.log('\n🔍 Investigation 3: Resolution Accuracy Check')
  console.log('=' .repeat(80))

  const inv: Investigation = {
    name: 'Resolution Accuracy Check',
    findings: [],
    examples: [],
    severity: 'INFO'
  }

  try {
    // Sample 20 resolved trades
    const result = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          wallet_address,
          condition_id,
          market_id,
          side,
          outcome,
          realized_pnl_usd,
          is_resolved,
          entry_price,
          shares
        FROM trades_raw
        WHERE is_resolved = 1
          AND market_id != ''
          AND condition_id != ''
        ORDER BY rand()
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })

    const trades = await result.json<any>()
    inv.findings.push(`Sampled ${trades.length} resolved trades`)

    let correctCount = 0
    let incorrectCount = 0
    let ambiguousCount = 0

    for (const trade of trades) {
      const side = trade.side
      const outcome = parseInt(trade.outcome)
      const pnl = parseFloat(trade.realized_pnl_usd)

      // outcome = 1 means YES won, 0 means NO won
      // If side = YES and outcome = 1, should be profitable
      // If side = NO and outcome = 0, should be profitable
      // Otherwise should be losing

      let expectedProfit = false
      if (side === 'YES' && outcome === 1) expectedProfit = true
      if (side === 'NO' && outcome === 0) expectedProfit = true

      const actualProfit = pnl > 0
      const isCorrect = expectedProfit === actualProfit

      const example = {
        trade_id: trade.trade_id.slice(0, 20),
        wallet: trade.wallet_address.slice(0, 20),
        condition_id: trade.condition_id.slice(0, 20),
        side: side,
        outcome: outcome === 1 ? 'YES' : 'NO',
        pnl: pnl.toFixed(2),
        expected_profit: expectedProfit ? 'YES' : 'NO',
        actual_profit: actualProfit ? 'YES' : 'NO',
        correct: isCorrect ? '✅' : '❌'
      }

      if (isCorrect) {
        correctCount++
      } else {
        incorrectCount++
        inv.findings.push(`❌ MISMATCH: Trade ${trade.trade_id.slice(0, 20)} - side=${side}, outcome=${outcome === 1 ? 'YES' : 'NO'}, but P&L=${pnl.toFixed(2)}`)
      }

      inv.examples.push(example)
    }

    const accuracy = (correctCount / trades.length) * 100
    inv.findings.push(`Resolution Accuracy: ${accuracy.toFixed(1)}% (${correctCount}/${trades.length} correct)`)

    if (incorrectCount > trades.length * 0.1) {
      inv.severity = 'CRITICAL'
      inv.findings.push(`❌ CRITICAL: ${incorrectCount} trades (${(incorrectCount/trades.length*100).toFixed(1)}%) have incorrect P&L signs`)
    }

    if (accuracy === 100) {
      inv.findings.push(`✅ All sampled trades have correct win/loss assignments`)
    }

  } catch (error) {
    inv.findings.push(`❌ ERROR: ${error}`)
    inv.severity = 'CRITICAL'
  }

  investigations.push(inv)
}

/**
 * Investigation 4: Check Trade Coverage
 * Verify we're seeing full trade history for wallets
 */
async function investigation4_TradeCoverage() {
  console.log('\n🔍 Investigation 4: Trade Coverage Analysis')
  console.log('=' .repeat(80))

  const inv: Investigation = {
    name: 'Trade Coverage Analysis',
    findings: [],
    examples: [],
    severity: 'INFO'
  }

  try {
    // Pick 5 wallets
    const walletsResult = await clickhouse.query({
      query: `
        SELECT DISTINCT wallet_address
        FROM trades_raw
        WHERE market_id != ''
        ORDER BY rand()
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })

    const wallets = await walletsResult.json<{ wallet_address: string }>()

    for (const wallet of wallets) {
      // Get trade counts at each stage
      const statsResult = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as total_trades,
            COUNT(CASE WHEN market_id != '' THEN 1 END) as enriched_trades,
            COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_trades,
            COUNT(CASE WHEN condition_id != '' THEN 1 END) as has_condition_id,
            MIN(timestamp) as first_trade,
            MAX(timestamp) as last_trade
          FROM trades_raw
          WHERE wallet_address = '${wallet.wallet_address}'
        `,
        format: 'JSONEachRow'
      })

      const stats = await statsResult.json<any>()
      const s = stats[0]

      const enrichmentRate = parseInt(s.total_trades) > 0
        ? (parseInt(s.enriched_trades) / parseInt(s.total_trades) * 100).toFixed(1)
        : '0'

      const resolutionRate = parseInt(s.enriched_trades) > 0
        ? (parseInt(s.resolved_trades) / parseInt(s.enriched_trades) * 100).toFixed(1)
        : '0'

      const example = {
        wallet: wallet.wallet_address.slice(0, 20),
        total_trades: s.total_trades,
        enriched: s.enriched_trades,
        resolved: s.resolved_trades,
        has_condition: s.has_condition_id,
        enrichment_rate: enrichmentRate + '%',
        resolution_rate: resolutionRate + '%',
        first_trade: s.first_trade,
        last_trade: s.last_trade
      }

      inv.examples.push(example)

      console.log(`  Wallet: ${wallet.wallet_address.slice(0, 42)}`)
      console.log(`    Total trades: ${s.total_trades}`)
      console.log(`    Enriched (has market_id): ${s.enriched_trades} (${enrichmentRate}%)`)
      console.log(`    Resolved: ${s.resolved_trades} (${resolutionRate}%)`)
      console.log(`    Has condition_id: ${s.has_condition_id}`)

      if (parseInt(s.enriched_trades) < parseInt(s.total_trades) * 0.9) {
        inv.findings.push(`⚠️  Wallet ${wallet.wallet_address.slice(0, 20)} has low enrichment rate (${enrichmentRate}%)`)
        if (inv.severity === 'INFO') inv.severity = 'WARNING'
      }

      if (parseInt(s.resolved_trades) < parseInt(s.enriched_trades) * 0.5) {
        inv.findings.push(`⚠️  Wallet ${wallet.wallet_address.slice(0, 20)} has low resolution rate (${resolutionRate}%)`)
        if (inv.severity === 'INFO') inv.severity = 'WARNING'
      }
    }

    const avgEnrichment = inv.examples.reduce((acc, e) => acc + parseFloat(e.enrichment_rate), 0) / inv.examples.length
    const avgResolution = inv.examples.reduce((acc, e) => acc + parseFloat(e.resolution_rate), 0) / inv.examples.length

    inv.findings.push(`Average enrichment rate: ${avgEnrichment.toFixed(1)}%`)
    inv.findings.push(`Average resolution rate: ${avgResolution.toFixed(1)}%`)

    if (avgEnrichment < 95) {
      inv.findings.push(`⚠️  Low enrichment rate suggests missing market data`)
      if (inv.severity === 'INFO') inv.severity = 'WARNING'
    }

  } catch (error) {
    inv.findings.push(`❌ ERROR: ${error}`)
    inv.severity = 'CRITICAL'
  }

  investigations.push(inv)
}

/**
 * Investigation 5: Overall Statistics
 * Get high-level stats on the whole dataset
 */
async function investigation5_OverallStats() {
  console.log('\n🔍 Investigation 5: Overall Statistics')
  console.log('=' .repeat(80))

  const inv: Investigation = {
    name: 'Overall Statistics',
    findings: [],
    examples: [],
    severity: 'INFO'
  }

  try {
    // Get overall stats
    const result = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT wallet_address) as total_wallets,
          COUNT(*) as total_trades,
          COUNT(CASE WHEN is_resolved = 1 THEN 1 END) as resolved_trades,
          COUNT(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN 1 END) as winning_trades,
          COUNT(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN 1 END) as losing_trades,
          COUNT(CASE WHEN is_resolved = 1 AND realized_pnl_usd = 0 THEN 1 END) as breakeven_trades,
          SUM(CASE WHEN is_resolved = 1 THEN realized_pnl_usd ELSE 0 END) as total_pnl,
          SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd > 0 THEN realized_pnl_usd ELSE 0 END) as total_gains,
          SUM(CASE WHEN is_resolved = 1 AND realized_pnl_usd < 0 THEN -realized_pnl_usd ELSE 0 END) as total_losses
        FROM trades_raw
        WHERE market_id != ''
      `,
      format: 'JSONEachRow'
    })

    const stats = await result.json<any>()
    const s = stats[0]

    inv.findings.push(`Total wallets: ${s.total_wallets}`)
    inv.findings.push(`Total trades: ${s.total_trades}`)
    inv.findings.push(`Resolved trades: ${s.resolved_trades}`)
    inv.findings.push(`Winning trades: ${s.winning_trades}`)
    inv.findings.push(`Losing trades: ${s.losing_trades}`)
    inv.findings.push(`Breakeven trades: ${s.breakeven_trades}`)

    const winRate = parseInt(s.resolved_trades) > 0
      ? (parseInt(s.winning_trades) / parseInt(s.resolved_trades) * 100).toFixed(1)
      : '0'

    inv.findings.push(`Overall win rate: ${winRate}%`)
    inv.findings.push(`Total P&L: $${parseFloat(s.total_pnl).toFixed(2)}`)
    inv.findings.push(`Total gains: $${parseFloat(s.total_gains).toFixed(2)}`)
    inv.findings.push(`Total losses: $${parseFloat(s.total_losses).toFixed(2)}`)

    const overallOmega = parseFloat(s.total_losses) > 0
      ? (parseFloat(s.total_gains) / parseFloat(s.total_losses)).toFixed(4)
      : 'N/A'

    inv.findings.push(`Overall omega ratio: ${overallOmega}`)

    // Get wallet profitability stats
    const walletStatsResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_wallets_with_metrics,
          COUNT(CASE WHEN metric_2_omega_net >= 1.0 THEN 1 END) as profitable_wallets,
          COUNT(CASE WHEN metric_2_omega_net < 1.0 AND metric_2_omega_net IS NOT NULL THEN 1 END) as unprofitable_wallets,
          COUNT(CASE WHEN metric_2_omega_net IS NULL THEN 1 END) as null_omega_wallets,
          AVG(metric_2_omega_net) as avg_omega,
          AVG(metric_9_net_pnl_usd) as avg_pnl,
          AVG(metric_12_hit_rate) as avg_win_rate
        FROM wallet_metrics_complete
        WHERE window = 'lifetime'
      `,
      format: 'JSONEachRow'
    })

    const walletStats = await walletStatsResult.json<any>()
    const ws = walletStats[0]

    inv.findings.push(`\n--- Wallet Metrics ---`)
    inv.findings.push(`Wallets with metrics: ${ws.total_wallets_with_metrics}`)
    inv.findings.push(`Profitable wallets (Ω ≥ 1.0): ${ws.profitable_wallets}`)
    inv.findings.push(`Unprofitable wallets (Ω < 1.0): ${ws.unprofitable_wallets}`)
    inv.findings.push(`Wallets with NULL omega: ${ws.null_omega_wallets}`)

    const profitableRate = parseInt(ws.total_wallets_with_metrics) > 0
      ? (parseInt(ws.profitable_wallets) / parseInt(ws.total_wallets_with_metrics) * 100).toFixed(1)
      : '0'

    inv.findings.push(`Profitable wallet rate: ${profitableRate}%`)

    if (parseFloat(profitableRate) < 10) {
      inv.findings.push(`❌ CRITICAL: Only ${profitableRate}% of wallets show as profitable!`)
      inv.findings.push(`   This is suspiciously low - likely indicates a bug`)
      inv.severity = 'CRITICAL'
    }

    inv.findings.push(`Average omega: ${parseFloat(ws.avg_omega).toFixed(4)}`)
    inv.findings.push(`Average P&L: $${parseFloat(ws.avg_pnl).toFixed(2)}`)
    inv.findings.push(`Average win rate: ${(parseFloat(ws.avg_win_rate) * 100).toFixed(1)}%`)

    inv.examples.push({
      stat: 'Overall',
      ...s,
      ...ws,
      profitable_rate: profitableRate + '%'
    })

  } catch (error) {
    inv.findings.push(`❌ ERROR: ${error}`)
    inv.severity = 'CRITICAL'
  }

  investigations.push(inv)
}

/**
 * Generate markdown report
 */
function generateReport() {
  console.log('\n📝 Generating Investigation Report...')

  let markdown = `# P&L and Omega Ratio Investigation Report

**Generated:** ${new Date().toISOString()}

**Context:** 28,000 wallets were loaded from Goldsky with filters: >10 trades and >$10k volume.
However, only 68 wallets (1%) show as profitable (omega >= 1.0). This investigation aims to find the bug.

---

`

  for (const inv of investigations) {
    const icon = inv.severity === 'CRITICAL' ? '🔴' : inv.severity === 'WARNING' ? '⚠️' : '✅'

    markdown += `## ${icon} ${inv.name}\n\n`
    markdown += `**Severity:** ${inv.severity}\n\n`

    markdown += `### Findings\n\n`
    for (const finding of inv.findings) {
      markdown += `- ${finding}\n`
    }
    markdown += `\n`

    if (inv.examples.length > 0) {
      markdown += `### Examples\n\n`
      markdown += '```json\n'
      markdown += JSON.stringify(inv.examples, null, 2)
      markdown += '\n```\n\n'
    }

    markdown += `---\n\n`
  }

  // Summary
  const criticalIssues = investigations.filter(i => i.severity === 'CRITICAL')
  const warnings = investigations.filter(i => i.severity === 'WARNING')

  markdown += `## Summary\n\n`
  markdown += `- **Total Investigations:** ${investigations.length}\n`
  markdown += `- **Critical Issues:** ${criticalIssues.length}\n`
  markdown += `- **Warnings:** ${warnings.length}\n\n`

  if (criticalIssues.length > 0) {
    markdown += `### 🔴 Critical Issues Found\n\n`
    for (const issue of criticalIssues) {
      markdown += `1. **${issue.name}**\n`
      for (const finding of issue.findings.filter(f => f.includes('❌') || f.includes('CRITICAL'))) {
        markdown += `   - ${finding}\n`
      }
    }
    markdown += `\n`
  }

  markdown += `## Recommended Next Steps\n\n`

  if (criticalIssues.some(i => i.findings.some(f => f.includes('INVERTED')))) {
    markdown += `1. **FIX OMEGA FORMULA** - The omega ratio appears to be calculated as Losses/Gains instead of Gains/Losses\n`
    markdown += `   - Update computation script at line 206-216 in scripts/compute-wallet-metrics.ts\n`
    markdown += `   - Re-run metrics computation for all wallets\n`
  }

  if (criticalIssues.some(i => i.findings.some(f => f.includes('Resolution')))) {
    markdown += `1. **FIX RESOLUTION LOGIC** - Trades are being marked with incorrect win/loss outcomes\n`
    markdown += `   - Review the outcome assignment logic in enrichment process\n`
    markdown += `   - Verify condition_id to outcome mapping\n`
  }

  if (warnings.some(i => i.findings.some(f => f.includes('enrichment')))) {
    markdown += `1. **IMPROVE ENRICHMENT COVERAGE** - Some trades are missing market_id or condition_id\n`
    markdown += `   - Re-run enrichment process for incomplete trades\n`
  }

  markdown += `\n---\n\n`
  markdown += `**Investigation completed at:** ${new Date().toISOString()}\n`

  return markdown
}

/**
 * Main execution
 */
async function main() {
  console.log('═'.repeat(80))
  console.log('       P&L AND OMEGA RATIO BUG INVESTIGATION')
  console.log('═'.repeat(80))
  console.log('')
  console.log('Running 5 parallel investigations...')
  console.log('')

  const startTime = Date.now()

  // Run all investigations
  await investigation1_SampleWalletVerification()
  await investigation2_OmegaFormula()
  await investigation3_ResolutionAccuracy()
  await investigation4_TradeCoverage()
  await investigation5_OverallStats()

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n' + '═'.repeat(80))
  console.log('✅ ALL INVESTIGATIONS COMPLETE')
  console.log('═'.repeat(80))
  console.log(`Total time: ${duration}s`)
  console.log('')

  // Generate and save report
  const report = generateReport()
  const reportPath = '/Users/scotty/Projects/Cascadian-app/runtime/metrics-investigation.md'
  writeFileSync(reportPath, report)

  console.log(`📄 Report saved to: ${reportPath}`)
  console.log('')

  // Print summary
  const criticalIssues = investigations.filter(i => i.severity === 'CRITICAL')
  const warnings = investigations.filter(i => i.severity === 'WARNING')

  if (criticalIssues.length > 0) {
    console.log('🔴 CRITICAL ISSUES FOUND:')
    for (const issue of criticalIssues) {
      console.log(`   - ${issue.name}`)
    }
    console.log('')
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:')
    for (const warning of warnings) {
      console.log(`   - ${warning.name}`)
    }
    console.log('')
  }

  if (criticalIssues.length === 0 && warnings.length === 0) {
    console.log('✅ No critical issues or warnings found')
    console.log('   The low profitability rate may be accurate for this dataset')
    console.log('')
  }
}

if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}
