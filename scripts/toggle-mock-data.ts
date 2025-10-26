/**
 * Toggle Mock Data Script
 *
 * Switches all hooks from mock data to real API data
 * Run: npx tsx scripts/toggle-mock-data.ts
 */

import * as fs from 'fs'
import * as path from 'path'

const hookFiles = [
  'hooks/use-market-tsi.ts',
  'hooks/use-top-wallets.ts',
  'hooks/use-austin-methodology.ts',
]

const rootDir = path.join(__dirname, '..')

console.log('\n╔═══════════════════════════════════════════════════════════╗')
console.log('║                                                           ║')
console.log('║           🚀 TOGGLING MOCK DATA TO REAL DATA 🚀           ║')
console.log('║                                                           ║')
console.log('╚═══════════════════════════════════════════════════════════╝\n')

let changedCount = 0
let alreadyLiveCount = 0
let errors: string[] = []

for (const hookFile of hookFiles) {
  const filePath = path.join(rootDir, hookFile)

  try {
    // Read file
    const content = fs.readFileSync(filePath, 'utf8')

    // Check if already using real data
    if (content.includes('const useMockData = false')) {
      console.log(`✅ ${hookFile}`)
      console.log(`   Already using REAL data\n`)
      alreadyLiveCount++
      continue
    }

    // Check if mock data flag exists
    if (!content.includes('const useMockData = true')) {
      console.log(`⚠️  ${hookFile}`)
      console.log(`   No 'useMockData' flag found (may already be live)\n`)
      alreadyLiveCount++
      continue
    }

    // Replace mock data flag
    const newContent = content.replace(
      /const useMockData = true/g,
      'const useMockData = false'
    )

    // Write back to file
    fs.writeFileSync(filePath, newContent, 'utf8')

    console.log(`🔄 ${hookFile}`)
    console.log(`   Changed: const useMockData = true → false`)
    console.log(`   Status: NOW USING REAL DATA ✅\n`)

    changedCount++

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.log(`❌ ${hookFile}`)
    console.log(`   Error: ${errorMsg}\n`)
    errors.push(`${hookFile}: ${errorMsg}`)
  }
}

console.log('═══════════════════════════════════════════════════════════')
console.log('\n📊 SUMMARY:\n')
console.log(`   ✅ Files changed: ${changedCount}`)
console.log(`   ✓  Already live: ${alreadyLiveCount}`)
console.log(`   ❌ Errors: ${errors.length}`)

if (errors.length > 0) {
  console.log('\n⚠️  ERRORS:\n')
  errors.forEach(err => console.log(`   ${err}`))
}

console.log('\n═══════════════════════════════════════════════════════════')

if (changedCount > 0) {
  console.log('\n🎉 SUCCESS! All hooks are now using REAL DATA from ClickHouse!\n')
  console.log('🔄 Next steps:')
  console.log('   1. Refresh your browser')
  console.log('   2. Visit the demo pages:')
  console.log('      - /demo/tsi-signals')
  console.log('      - /demo/top-wallets')
  console.log('      - /demo/category-leaderboard')
  console.log('   3. Verify real data is loading\n')
  console.log('⚠️  NOTE: If ClickHouse tables are empty, you\'ll see "No data" messages.')
  console.log('   Run the data pipeline first:\n')
  console.log('   npx tsx scripts/sync-all-wallets-bulk.ts')
  console.log('   npx tsx scripts/enrich-trades.ts')
  console.log('   npx tsx scripts/calculate-tier1-metrics.ts\n')
} else if (alreadyLiveCount === hookFiles.length) {
  console.log('\n✅ All hooks are already using REAL DATA!\n')
  console.log('   No changes needed. Your app is live! 🚀\n')
} else {
  console.log('\n⚠️  No changes made. Check errors above.\n')
}

process.exit(errors.length > 0 ? 1 : 0)
