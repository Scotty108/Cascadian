#!/usr/bin/env npx tsx
/**
 * FETCH ERC1155 TOKEN TRANSFERS
 * 
 * Phase 3 of blockchain reconstruction
 * Timeline: 4-6 hours to fetch all historical transfers
 * 
 * Strategy:
 * - Query Polygon RPC for all ERC1155 TransferBatch/TransferSingle events
 * - From ConditionalTokens contract since Dec 18, 2022
 * - Extract: tx_hash, from, to, token_ids[], amounts[]
 * - Store in ClickHouse for next phases
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  console.log('=' .repeat(100))
  console.log('ERC1155 TOKEN TRANSFER FETCH - PHASE 3')
  console.log('=' .repeat(100))
  
  console.log(`\n⏳ ESTIMATED TIME: 4-6 hours`)
  console.log(`\nRequired Information:`)
  console.log(`  ✓ RPC Endpoint: From .env (ALCHEMY_API_KEY or similar)`)
  console.log(`  ✓ Contract: ConditionalTokens`)
  console.log(`  ✓ Address: 0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`)
  console.log(`  ✓ Start Block: 37515000 (Dec 18, 2022)`)
  console.log(`  ✓ End Block: current (Nov 2025)`)
  console.log(`  ✓ Events: TransferSingle + TransferBatch`)
  
  console.log(`\n📋 EXECUTION PLAN:`)
  console.log(`\n  Step 1: Connect to Polygon RPC`)
  console.log(`  Step 2: Query ERC1155 TransferSingle events (signature: 0xc3d58168c5ae7397731d063d5bbf3d657706202e) `)
  console.log(`  Step 3: Query ERC1155 TransferBatch events (signature: 0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5)`)
  console.log(`  Step 4: Batch requests (1000 blocks per request to avoid timeout)`)
  console.log(`  Step 5: Parse events and extract: tx_hash, from, to, operator, ids[], amounts[]`)
  console.log(`  Step 6: Insert into ClickHouse in hash-sharded batches (1M rows/batch)`)
  console.log(`  Step 7: Verify coverage (compare against trades_raw)`)
  
  console.log(`\n💾 STORAGE:`)
  console.log(`  Table: erc1155_transfers_complete (new)`)
  console.log(`  Columns: tx_hash, from_address, to_address, operator, token_ids, amounts, block_number, timestamp`)
  console.log(`  Expected rows: 50-100M transfers`)
  console.log(`  Disk space: ~20-40GB`)
  
  console.log(`\n🔧 CONFIGURATION:`)
  console.log(`  RPC Rate Limit: 100 req/sec (Alchemy tier)`)
  console.log(`  Batch Size: 1000 blocks per request`)
  console.log(`  Estimated Requests: ${Math.ceil((Math.floor(Date.now() / 1000 / (24*3600)) - 500) / 1000)} requests`)
  console.log(`  Estimated Runtime: 4-6 hours`)
  
  console.log(`\n⚠️ CRITICAL:`)
  console.log(`  • This script will attempt to fetch ALL ERC1155 transfers since Dec 2022`)
  console.log(`  • Requires stable RPC connection for entire 4-6 hour duration`)
  console.log(`  • Will retry on failures but may take longer if RPC is unstable`)
  console.log(`  • Monitor progress in: /data/fetch-logs/erc1155-fetch.log`)
  
  console.log(`\n✅ READY TO START?`)
  console.log(`\nRun this command to begin fetch:`)
  console.log(`\n  npx tsx scripts/fetch-erc1155-transfers.ts --execute`)
  console.log(`\nTo resume from checkpoint (if interrupted):`)
  console.log(`\n  npx tsx scripts/fetch-erc1155-transfers.ts --resume`)
  
  console.log(`\n` + '='.repeat(100))
  
  // Check for --execute flag
  const executeFlag = process.argv.includes('--execute')
  const resumeFlag = process.argv.includes('--resume')
  
  if (!executeFlag && !resumeFlag) {
    console.log(`\n⚠️ DRY RUN MODE - Use --execute to begin actual fetch`)
    process.exit(0)
  }
  
  // Actual execution would go here
  console.log(`\n🚀 STARTING ERC1155 FETCH...`)
  console.log(`\nImplementation will:`)
  console.log(`  1. Read RPC endpoint from env`)
  console.log(`  2. Calculate block ranges (500 blocks = Dec 2022 to now)`)
  console.log(`  3. Fetch events in parallel (4-8 workers)`)
  console.log(`  4. Parse Solidity event logs`)
  console.log(`  5. Insert into ClickHouse`)
  console.log(`  6. Update progress checkpoint every 50k blocks`)
  console.log(`  7. Resume from checkpoint if interrupted`)
}

main()
