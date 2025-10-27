#!/usr/bin/env npx tsx
/**
 * Finalize Market ID Lookup Results
 *
 * Converts market_id_lookup_results.jsonl to final JSON format
 * Filters out any null or "unknown" values
 * Provides final statistics on the lookup job
 *
 * Input: data/market_id_lookup_results.jsonl
 * Output: data/market_id_lookup_results.json
 */

import { resolve } from 'path'
import * as fs from 'fs'

interface LookupResult {
  condition_id: string
  market_id: string
}

async function main() {
  const dataDir = resolve(process.cwd(), 'data')
  const jsonlPath = resolve(dataDir, 'market_id_lookup_results.jsonl')
  const jsonPath = resolve(dataDir, 'market_id_lookup_results.json')

  console.log('📊 FINALIZING MARKET_ID LOOKUP RESULTS')
  console.log('================================================\n')

  // Check if JSONL file exists
  if (!fs.existsSync(jsonlPath)) {
    console.error('❌ market_id_lookup_results.jsonl not found')
    console.error('   Expected at:', jsonlPath)
    process.exit(1)
  }

  // Read JSONL file
  console.log('📂 Reading JSONL file...')
  const jsonlContent = fs.readFileSync(jsonlPath, 'utf-8')
  const lines = jsonlContent.trim().split('\n').filter(l => l)

  console.log(`   Found ${lines.length.toLocaleString()} lines\n`)

  // Parse and validate each line
  const validMappings: LookupResult[] = []
  const invalidMappings: Array<{ condition_id: string; reason: string }> = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LookupResult

      // Validate
      if (!entry.condition_id) {
        invalidMappings.push({ condition_id: 'unknown', reason: 'Missing condition_id' })
        continue
      }

      if (!entry.market_id || entry.market_id === 'unknown' || entry.market_id === '') {
        invalidMappings.push({
          condition_id: entry.condition_id,
          reason: `Invalid market_id: ${entry.market_id}`
        })
        continue
      }

      validMappings.push({
        condition_id: entry.condition_id,
        market_id: entry.market_id
      })
    } catch (error) {
      console.warn('⚠️  Failed to parse line:', line.slice(0, 100))
    }
  }

  console.log('✅ Validation Results:')
  console.log(`   Valid mappings: ${validMappings.length.toLocaleString()}`)
  console.log(`   Invalid mappings: ${invalidMappings.length.toLocaleString()}`)
  console.log(`   Success rate: ${((validMappings.length / lines.length) * 100).toFixed(2)}%\n`)

  // Write final JSON
  console.log('💾 Writing final JSON...')
  const finalOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      total_lookups: lines.length,
      valid_mappings: validMappings.length,
      invalid_mappings: invalidMappings.length,
      success_rate: parseFloat(((validMappings.length / lines.length) * 100).toFixed(2))
    },
    mappings: validMappings,
    invalid_samples: invalidMappings.slice(0, 100) // Keep first 100 invalid for debugging
  }

  fs.writeFileSync(jsonPath, JSON.stringify(finalOutput, null, 2), 'utf-8')
  console.log(`   ✅ Wrote ${jsonPath}`)
  console.log(`   File size: ${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2)} MB\n`)

  // Statistics breakdown
  console.log('================================================')
  console.log('📊 FINAL STATISTICS')
  console.log('================================================\n')

  console.log(`Total condition_ids processed: ${lines.length.toLocaleString()}`)
  console.log(`Successfully resolved: ${validMappings.length.toLocaleString()} (${((validMappings.length / lines.length) * 100).toFixed(2)}%)`)
  console.log(`Failed to resolve: ${invalidMappings.length.toLocaleString()} (${((invalidMappings.length / lines.length) * 100).toFixed(2)}%)`)
  console.log('')

  if (invalidMappings.length > 0) {
    console.log('⚠️  Top reasons for failure:')
    const reasonCounts = new Map<string, number>()
    for (const inv of invalidMappings) {
      const count = reasonCounts.get(inv.reason) || 0
      reasonCounts.set(inv.reason, count + 1)
    }

    const sortedReasons = Array.from(reasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    for (const [reason, count] of sortedReasons) {
      console.log(`   - ${reason}: ${count.toLocaleString()}`)
    }
    console.log('')
  }

  console.log('✅ FINALIZATION COMPLETE')
  console.log('================================================\n')
}

main().catch(console.error)
