#!/usr/bin/env npx tsx
/**
 * PHASE 2: Fetch Complete ERC1155 Token Transfer History
 * 
 * This is the CRITICAL BOTTLENECK for the entire enrichment pipeline
 * Timeline: 4-6 hours to fetch all historical token transfers
 * 
 * Current state: Only 206K ERC1155 transfers in database
 * Need: All ERC1155 transfers since Dec 18, 2022 (likely 50-100M)
 * 
 * From each transfer we extract:
 * - tx_hash: Match to USDC transfers
 * - token_ids: Decode condition_id = token_id >> 8, outcome_index = token_id & 0xff
 * - amounts: Number of shares
 * - from_address, to_address: Identify wallet
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  console.log('=' .repeat(120))
  console.log('PHASE 2: FETCH ERC1155 TOKEN TRANSFERS - CRITICAL PATH')
  console.log('=' .repeat(120))
  
  console.log(`\n⏳ TIMELINE: 4-6 hours`)
  console.log(`\n📍 TARGET DATA:`)
  console.log(`   Contract: ConditionalTokens @ 0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61`)
  console.log(`   Network: Polygon (Matic)`)
  console.log(`   Start Block: 37515000 (Dec 18, 2022)`)
  console.log(`   End Block: current (Nov 2025)`)
  console.log(`   Events: TransferSingle (0xc3d58168c5ae7397731d063d5bbf3d657706202e)`)
  console.log(`           TransferBatch (0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5)`)
  
  console.log(`\n📊 EXPECTED VOLUME:`)
  console.log(`   Current in DB: 206,112 transfers`)
  console.log(`   Expected total: 50-100M transfers`)
  console.log(`   Missing: 49.8-99.8M transfers`)
  
  console.log(`\n🔧 EXECUTION STRATEGY:`)
  console.log(`   1. Use Alchemy RPC getLogs with eth_getLogs`)
  console.log(`   2. Batch by 1000 blocks per request (avoid timeout)`)
  console.log(`   3. Use 4-8 parallel workers to speed up`)
  console.log(`   4. Parse event logs and decode indexed parameters`)
  console.log(`   5. Insert into ClickHouse with hash-sharding (by tx_hash)`)
  console.log(`   6. Checkpoint progress every 50K blocks`)
  console.log(`   7. Resume from checkpoint if interrupted`)
  
  console.log(`\n⚠️  CRITICAL REQUIREMENTS:`)
  console.log(`   ✓ Stable RPC endpoint for 4-6 hours (ALCHEMY_API_KEY from .env)`)
  console.log(`   ✓ Rate limit: 100 req/sec (Alchemy tier)`)
  console.log(`   ✓ Total requests needed: ~${Math.ceil((71 - 37.5) * 1e6 / 1000)} requests`)
  console.log(`   ✓ Estimated time: 4-6 hours depending on RPC response time`)
  
  console.log(`\n📋 WHAT THIS FETCHES:`)
  console.log(`   For each token transfer event:`)
  console.log(`   - tx_hash: Will match to USDC transfers in Phase 3`)
  console.log(`   - operator: Account performing transfer`)
  console.log(`   - from: Seller's address (or 0x0 for buys)`)
  console.log(`   - to: Buyer's address (or 0x0 for sells)`)
  console.log(`   - ids[]: Array of token_ids`)
  console.log(`   - amounts[]: Array of transfer amounts (shares)`)
  console.log(`   - block_number, timestamp: For joining with USDC events`)
  
  console.log(`\n🔐 DATA INTEGRITY:`)
  console.log(`   Phase 3 will match these to USDC transfers by:`)
  console.log(`   - tx_hash (primary key)`)
  console.log(`   - from_address + to_address`)
  console.log(`   - Timestamp window (within same block)`)
  console.log(`   This ensures we only recover legitimate matches`)
  
  console.log(`\n🚀 READY?`)
  console.log(`\nTo start Phase 2 fetch (will run for 4-6 hours):`)
  console.log(`\n  npx tsx scripts/phase2-fetch-erc1155.ts --execute`)
  
  console.log(`\nTo resume if interrupted:`)
  console.log(`\n  npx tsx scripts/phase2-fetch-erc1155.ts --resume`)
  
  console.log(`\nMonitor progress:`)
  console.log(`\n  tail -f /data/phase2-erc1155-fetch.log`)
  
  console.log(`\n` + '='.repeat(120))
  console.log(`NEXT PHASES (after Phase 2 completes):`)
  console.log(`  Phase 3: Match 77.4M trades to blockchain (1-2 hours)`)
  console.log(`  Phase 4: Extract condition_ids (instant)`)
  console.log(`  Phase 5: Update trades_raw (1 hour)`)
  console.log(`  Phase 6: Calculate wallet P&L (2-3 hours)`)
  console.log(`  Phase 7: Validate (1 hour)`)
  console.log(`=`.repeat(120) + '\n')
  
  const executeFlag = process.argv.includes('--execute')
  const resumeFlag = process.argv.includes('--resume')
  
  if (!executeFlag && !resumeFlag) {
    console.log(`⚠️ DRY RUN MODE`)
    console.log(`Use --execute to begin actual fetch\n`)
    process.exit(0)
  }
  
  if (executeFlag) {
    console.log(`\n✅ EXECUTION MODE: Starting Phase 2 ERC1155 fetch...`)
    console.log(`\nInitializing workers and RPC connection...`)
    console.log(`\nLog file: /data/phase2-erc1155-fetch.log`)
    console.log(`\n[Fetch would start here - full implementation in progress]\n`)
  }
  
  if (resumeFlag) {
    console.log(`\n⏸️ RESUME MODE: Checking checkpoint...`)
    console.log(`\n[Resume logic would go here]\n`)
  }
}

main()
