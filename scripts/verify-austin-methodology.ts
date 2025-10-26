/**
 * Verification Script: Austin Methodology
 *
 * Quick verification that all components are properly installed
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

interface CheckResult {
  name: string
  path: string
  exists: boolean
  size?: number
  error?: string
}

const checks: CheckResult[] = []

function checkFile(name: string, relativePath: string): void {
  const path = join(ROOT, relativePath)
  const exists = existsSync(path)

  const result: CheckResult = {
    name,
    path: relativePath,
    exists,
  }

  if (exists) {
    try {
      const stats = require('fs').statSync(path)
      result.size = stats.size
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error'
    }
  }

  checks.push(result)
}

console.log('🔍 Verifying Austin Methodology Installation\n')
console.log('=' .repeat(70))

// Core Implementation
console.log('\n📦 Core Implementation:')
checkFile('Austin Methodology', 'lib/metrics/austin-methodology.ts')
checkFile('React Hooks', 'hooks/use-austin-methodology.ts')

// API Endpoints
console.log('\n🌐 API Endpoints:')
checkFile('Categories List', 'app/api/austin/categories/route.ts')
checkFile('Category Detail', 'app/api/austin/categories/[category]/route.ts')
checkFile('Recommendation', 'app/api/austin/recommend/route.ts')
checkFile('Refresh', 'app/api/austin/refresh/route.ts')

// Cron Jobs
console.log('\n⏰ Cron Jobs:')
checkFile('Cron API', 'app/api/cron/refresh-category-analytics/route.ts')
checkFile('Cron Script', 'scripts/cron-refresh-categories.ts')
checkFile('Test Script', 'scripts/test-austin-methodology.ts')

// Documentation
console.log('\n📚 Documentation:')
checkFile('Main Guide', 'lib/metrics/AUSTIN_METHODOLOGY.md')
checkFile('Quick Start', 'lib/metrics/AUSTIN_METHODOLOGY_QUICKSTART.md')
checkFile('Status Report', 'AUSTIN_METHODOLOGY_COMPLETE.md')

// Configuration
console.log('\n⚙️  Configuration:')
checkFile('Vercel Config', 'vercel.json')

// Dependencies
console.log('\n🔗 Dependencies:')
checkFile('ClickHouse Client', 'lib/clickhouse/client.ts')
checkFile('Supabase Client', 'lib/supabase.ts')

// Database Migrations
console.log('\n💾 Database Migrations:')
checkFile('ClickHouse Migration', 'migrations/clickhouse/005_create_category_analytics.sql')
checkFile('Supabase Migration', 'supabase/migrations/20251025110000_create_wallet_category_tags.sql')

// Summary
console.log('\n' + '='.repeat(70))
console.log('\n📊 Summary:')

const allFiles = checks.filter((c) => c.exists).length
const missingFiles = checks.filter((c) => !c.exists).length
const totalSize = checks.reduce((sum, c) => sum + (c.size || 0), 0)

console.log(`   Total Files: ${checks.length}`)
console.log(`   Found: ${allFiles}`)
console.log(`   Missing: ${missingFiles}`)
console.log(`   Total Size: ${(totalSize / 1024).toFixed(2)} KB`)

// Detailed Results
console.log('\n📋 Detailed Results:')
checks.forEach((check) => {
  const status = check.exists ? '✅' : '❌'
  const size = check.size ? `(${(check.size / 1024).toFixed(1)} KB)` : ''
  console.log(`   ${status} ${check.name.padEnd(25)} ${size}`)
  if (!check.exists) {
    console.log(`      Missing: ${check.path}`)
  }
})

// Verify vercel.json has cron job
console.log('\n🔍 Verifying Cron Configuration:')
try {
  const vercelConfig = JSON.parse(
    readFileSync(join(ROOT, 'vercel.json'), 'utf-8')
  )

  const hasCron = vercelConfig.crons?.some(
    (cron: any) => cron.path === '/api/cron/refresh-category-analytics'
  )

  if (hasCron) {
    console.log('   ✅ Cron job configured in vercel.json')
    const cronConfig = vercelConfig.crons.find(
      (cron: any) => cron.path === '/api/cron/refresh-category-analytics'
    )
    console.log(`   Schedule: ${cronConfig.schedule} (every 5 minutes)`)
  } else {
    console.log('   ❌ Cron job NOT found in vercel.json')
  }
} catch (error) {
  console.log('   ⚠️  Could not verify vercel.json:', error)
}

// Check for imports
console.log('\n🔍 Verifying Type Imports:')
try {
  const content = readFileSync(
    join(ROOT, 'lib/metrics/austin-methodology.ts'),
    'utf-8'
  )

  const hasClickHouseImport = content.includes("from '@/lib/clickhouse/client'")
  const hasSupabaseImport = content.includes("from '@/lib/supabase'")
  const hasTypeExports = content.includes('export interface CategoryAnalysis')

  console.log(`   ${hasClickHouseImport ? '✅' : '❌'} ClickHouse import`)
  console.log(`   ${hasSupabaseImport ? '✅' : '❌'} Supabase import`)
  console.log(`   ${hasTypeExports ? '✅' : '❌'} TypeScript interfaces`)
} catch (error) {
  console.log('   ⚠️  Could not verify imports:', error)
}

// Final Status
console.log('\n' + '='.repeat(70))

if (missingFiles === 0) {
  console.log('\n✅ VERIFICATION COMPLETE: All files present!')
  console.log('\n📋 Next Steps:')
  console.log('   1. Run migrations: Apply ClickHouse and Supabase migrations')
  console.log('   2. Test functionality: npx tsx scripts/test-austin-methodology.ts')
  console.log('   3. Start cron job: Deploy to Vercel or run cron script')
  console.log('   4. Monitor: Check logs and metrics')
  process.exit(0)
} else {
  console.log('\n❌ VERIFICATION FAILED: Missing files detected')
  console.log(`\n   ${missingFiles} file(s) missing. Review details above.`)
  process.exit(1)
}
