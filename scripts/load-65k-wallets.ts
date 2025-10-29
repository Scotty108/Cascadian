/**
 * Load 65k wallets from CSV into ClickHouse wallets_dim table
 *
 * Input: runtime/wallets_10k_10trades.csv (65,029 wallets)
 * Output: Inserts into wallets_dim, ready for Goldsky ingestion
 */

import { config } from 'dotenv'
import { clickhouse } from '@/lib/clickhouse/client'
import { createReadStream } from 'fs'
import { createInterface } from 'readline'
import path from 'path'

// Load .env.local explicitly
config({ path: path.join(process.cwd(), '.env.local') })

const CSV_PATH = path.join(process.cwd(), 'runtime/wallets_10k_10trades.csv')
const BATCH_SIZE = 1000

interface WalletDimRow {
  wallet_address: string
  first_seen: Date
  last_seen: Date
  total_volume_usd: number
  total_trades: number
  is_active: boolean
  created_at: Date
}

/**
 * Check how many wallets already exist
 */
async function checkExistingWallets() {
  console.log('📊 Checking existing wallets in wallets_dim...\n')

  const result = await clickhouse.query({
    query: 'SELECT COUNT() as count FROM wallets_dim',
    format: 'JSONEachRow'
  })

  const data = await result.json<{ count: string }>()
  const existingCount = parseInt(data[0].count)

  console.log(`   Current wallets in database: ${existingCount.toLocaleString()}`)

  return existingCount
}

/**
 * Load wallets from CSV using native readline
 */
async function loadWalletsFromCSV(): Promise<WalletDimRow[]> {
  console.log('\n📂 Loading wallets from CSV...\n')

  return new Promise((resolve, reject) => {
    const wallets: WalletDimRow[] = []
    const now = new Date()
    let isFirstLine = true

    const fileStream = createReadStream(CSV_PATH)
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity
    })

    rl.on('line', (line) => {
      // Skip header line
      if (isFirstLine) {
        isFirstLine = false
        return
      }

      // Parse CSV line: wallet,lifetime_volume_usd,num_trades
      const [wallet, lifetime_volume_usd, num_trades] = line.split(',')

      if (wallet && wallet.startsWith('0x')) {
        wallets.push({
          wallet_address: wallet.toLowerCase().trim(),
          first_seen: now, // Will be updated by Goldsky data
          last_seen: now,
          total_volume_usd: parseFloat(lifetime_volume_usd),
          total_trades: parseInt(num_trades),
          is_active: true,
          created_at: now
        })
      }
    })

    rl.on('close', () => {
      console.log(`   ✅ Loaded ${wallets.length.toLocaleString()} wallets from CSV`)
      resolve(wallets)
    })

    rl.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Get list of wallet addresses already in database
 */
async function getExistingWalletAddresses(): Promise<Set<string>> {
  console.log('\n🔍 Fetching existing wallet addresses...\n')

  const result = await clickhouse.query({
    query: 'SELECT wallet_address FROM wallets_dim',
    format: 'JSONEachRow'
  })

  const rows = await result.json<{ wallet_address: string }>()
  const addresses = new Set(rows.map(r => r.wallet_address.toLowerCase()))

  console.log(`   ✅ Found ${addresses.size.toLocaleString()} existing wallet addresses`)

  return addresses
}

/**
 * Insert new wallets in batches
 */
async function insertWallets(wallets: WalletDimRow[]) {
  console.log(`\n💾 Inserting ${wallets.length.toLocaleString()} new wallets...\n`)

  const startTime = Date.now()
  let totalInserted = 0

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, Math.min(i + BATCH_SIZE, wallets.length))

    await clickhouse.insert({
      table: 'wallets_dim',
      values: batch,
      format: 'JSONEachRow'
    })

    totalInserted += batch.length
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(wallets.length / BATCH_SIZE)

    console.log(`   Batch ${batchNum}/${totalBatches}: Inserted ${batch.length} wallets (total: ${totalInserted.toLocaleString()})`)
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n   ✅ Inserted ${totalInserted.toLocaleString()} wallets in ${duration}s`)
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   LOAD 65K WALLETS FROM CSV                                   ')
  console.log('═══════════════════════════════════════════════════════════════\n')

  try {
    // Check existing wallets
    const existingCount = await checkExistingWallets()

    // Load wallets from CSV
    const allWallets = await loadWalletsFromCSV()

    // Get existing addresses to avoid duplicates
    const existingAddresses = await getExistingWalletAddresses()

    // Filter out wallets that already exist
    const newWallets = allWallets.filter(w => !existingAddresses.has(w.wallet_address))

    console.log(`\n📈 Summary:`)
    console.log(`   - Wallets in CSV: ${allWallets.length.toLocaleString()}`)
    console.log(`   - Already in database: ${existingCount.toLocaleString()}`)
    console.log(`   - New wallets to insert: ${newWallets.length.toLocaleString()}`)

    if (newWallets.length === 0) {
      console.log('\n✅ All wallets already in database. Nothing to insert.')
      return
    }

    // Insert new wallets
    await insertWallets(newWallets)

    // Final verification
    const finalCount = await checkExistingWallets()

    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('✅ WALLET LOADING COMPLETE')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`   Total wallets in database: ${finalCount.toLocaleString()}`)
    console.log(`   New wallets added: ${newWallets.length.toLocaleString()}`)
    console.log('═══════════════════════════════════════════════════════════════\n')

    console.log('📋 Next Steps:')
    console.log('   1. Run Goldsky ingestion: npm run goldsky:full')
    console.log('   2. Run enrichment pipeline: npm run enrich:full')
    console.log('   3. Compute metrics: npm run metrics:compute')
    console.log('\n   Estimated total time: 8-12 hours\n')

  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

main()
