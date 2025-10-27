#!/usr/bin/env tsx
/**
 * ANALYZE BEST CATEGORIES
 *
 * Finds the most winnable categories by Omega ratio.
 * Use this to inform category-first strategies.
 *
 * Output:
 * - Average Omega ratio per category
 * - Win rate per category
 * - Number of wallets per category
 * - Recommendations for which categories to focus on
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface CategoryStats {
  category: string
  avg_omega: number
  avg_win_rate: number
  wallet_count: number
  total_pnl: number
  avg_pnl_per_wallet: number
  top_wallet_omega: number
  grade_distribution: Record<string, number>
}

async function analyzeBestCategories() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🔍 Analyzing Categories by Omega Ratio...\n')

  // Get all wallet scores by category
  const { data: wallets, error } = await supabase
    .from('wallet_scores_by_category')
    .select('*')
    .eq('meets_minimum_trades', true)
    .order('category')

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  if (!wallets || wallets.length === 0) {
    console.log('⚠️  No wallet data found in wallet_scores_by_category')
    return
  }

  // Group by category
  const categoryMap = new Map<string, any[]>()

  wallets.forEach((w: any) => {
    const category = w.category || 'Unknown'
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category)!.push(w)
  })

  // Calculate stats per category
  const categoryStats: CategoryStats[] = []

  for (const [category, walletList] of categoryMap.entries()) {
    const validWallets = walletList.filter(w =>
      w.omega_ratio != null &&
      w.win_rate != null &&
      w.total_pnl != null
    )

    if (validWallets.length === 0) continue

    const avgOmega = validWallets.reduce((sum, w) => sum + (w.omega_ratio || 0), 0) / validWallets.length
    const avgWinRate = validWallets.reduce((sum, w) => sum + (w.win_rate || 0), 0) / validWallets.length
    const totalPnl = validWallets.reduce((sum, w) => sum + (w.total_pnl || 0), 0)
    const topOmega = Math.max(...validWallets.map(w => w.omega_ratio || 0))

    // Grade distribution
    const gradeDistribution: Record<string, number> = {}
    validWallets.forEach(w => {
      const grade = w.grade || 'Unknown'
      gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1
    })

    categoryStats.push({
      category,
      avg_omega: avgOmega,
      avg_win_rate: avgWinRate,
      wallet_count: validWallets.length,
      total_pnl: totalPnl,
      avg_pnl_per_wallet: totalPnl / validWallets.length,
      top_wallet_omega: topOmega,
      grade_distribution: gradeDistribution,
    })
  }

  // Sort by average Omega (highest first)
  categoryStats.sort((a, b) => b.avg_omega - a.avg_omega)

  console.log('┌─────────────────────────────────────────────────────────────────────────────┐')
  console.log('│ CATEGORY ANALYSIS (Sorted by Avg Omega Ratio)                              │')
  console.log('├─────────────────────┬─────────┬──────────┬─────────┬──────────┬────────────┤')
  console.log('│ Category            │ Avg Ω   │ Win Rate │ Wallets │ Total P&L│ Top Wallet │')
  console.log('├─────────────────────┼─────────┼──────────┼─────────┼──────────┼────────────┤')

  categoryStats.forEach((stat) => {
    const category = stat.category.padEnd(19).substring(0, 19)
    const avgOmega = stat.avg_omega.toFixed(2).padStart(7)
    const winRate = `${(stat.avg_win_rate * 100).toFixed(1)}%`.padStart(8)
    const walletCount = stat.wallet_count.toString().padStart(7)
    const totalPnl = `$${(stat.total_pnl / 1000).toFixed(1)}k`.padStart(9)
    const topOmega = stat.top_wallet_omega.toFixed(2).padStart(10)

    console.log(`│ ${category} │ ${avgOmega} │ ${winRate} │ ${walletCount} │ ${totalPnl} │ ${topOmega} │`)
  })

  console.log('└─────────────────────┴─────────┴──────────┴─────────┴──────────┴────────────┘')

  // Top 3 recommendations
  console.log('\n🎯 RECOMMENDATIONS (Top 3 Categories to Focus On):\n')

  categoryStats.slice(0, 3).forEach((stat, index) => {
    console.log(`${index + 1}. ${stat.category}`)
    console.log(`   • Average Omega: ${stat.avg_omega.toFixed(2)} (${getOmegaGrade(stat.avg_omega)})`)
    console.log(`   • Win Rate: ${(stat.avg_win_rate * 100).toFixed(1)}%`)
    console.log(`   • ${stat.wallet_count} qualified wallets`)
    console.log(`   • Total P&L: $${(stat.total_pnl / 1000).toFixed(1)}k`)
    console.log(`   • Top wallet Omega: ${stat.top_wallet_omega.toFixed(2)}`)

    // Show grade distribution
    const topGrades = Object.entries(stat.grade_distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([grade, count]) => `${grade}: ${count}`)
      .join(', ')
    console.log(`   • Grade distribution: ${topGrades}`)
    console.log()
  })

  // Strategy recommendations
  console.log('📝 STRATEGY BUILDING TIPS:\n')
  console.log('1. Build separate strategies for each top category')
  console.log('2. Use ENHANCED_FILTER with:')
  console.log('   - category = "' + categoryStats[0].category + '"')
  console.log('   - omega_ratio >= ' + (categoryStats[0].avg_omega * 0.8).toFixed(2))
  console.log('   - win_rate >= ' + (categoryStats[0].avg_win_rate * 0.9).toFixed(2))
  console.log('3. Copy trade top 10-15 wallets in each category')
  console.log('4. Diversify across all 3 top categories\n')

  // Export data
  console.log('💾 Want to export this data?')
  console.log('   Add --export flag to save as JSON\n')
}

function getOmegaGrade(omega: number): string {
  if (omega >= 3.0) return 'S+ tier'
  if (omega >= 2.5) return 'S tier'
  if (omega >= 2.0) return 'A tier'
  if (omega >= 1.5) return 'B tier'
  if (omega >= 1.0) return 'C tier'
  return 'D tier'
}

analyzeBestCategories()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
