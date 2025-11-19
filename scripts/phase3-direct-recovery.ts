#!/usr/bin/env npx tsx
/**
 * PHASE 3 DIRECT: Recover condition_ids via direct JOIN
 *
 * Instead of rescanning blocks, use the transaction_hash from trades_raw
 * to JOIN with erc1155_transfers and extract condition_id from token_id
 *
 * This is MUCH faster than block-by-block scanning
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const CH_HOST = process.env.CLICKHOUSE_HOST || ''
  const CH_PASSWORD = process.env.CLICKHOUSE_PASSWORD || ''

  console.log('════════════════════════════════════════════════════════════════════════════')
  console.log('PHASE 3 DIRECT: Recover condition_ids via transaction_hash JOIN')
  console.log('════════════════════════════════════════════════════════════════════════════\n')

  // Step 1: Count trades with empty condition_ids
  console.log('[STEP 1] Analyze target trades...')
  try {
    const countResponse = await fetch(
      `${CH_HOST}/?query=SELECT+COUNT(*)%20as%20count+FROM+trades_raw+WHERE+condition_id+%3D+%27%27`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
        }
      }
    )
    const countText = await countResponse.text()
    console.log(`Trades with empty condition_id: ${countText.trim()}\n`)
  } catch (error) {
    console.error('Error:', error)
  }

  // Step 2: Count available ERC1155 transfers
  console.log('[STEP 2] Check available ERC1155 transfers...')
  try {
    const ercResponse = await fetch(
      `${CH_HOST}/?query=SELECT+COUNT(*)%20as%20count+FROM+erc1155_transfers`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
        }
      }
    )
    const ercText = await ercResponse.text()
    console.log(`ERC1155 transfers available: ${ercText.trim()}\n`)
  } catch (error) {
    console.error('Error:', error)
  }

  // Step 3: Test JOIN to see how many matches we get
  console.log('[STEP 3] Test JOIN pattern (sample)...')
  try {
    const testResponse = await fetch(
      `${CH_HOST}/?query=SELECT+COUNT(*)%20as%20matches%20FROM%20trades_raw%20t%20INNER%20JOIN%20erc1155_transfers%20e%20ON%20t.transaction_hash+%3D+e.tx_hash%20WHERE%20t.condition_id%20%3D%20%27%27%20LIMIT%201`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
        }
      }
    )
    const testText = await testResponse.text()
    console.log(`Potential matches via transaction_hash JOIN: ${testText.trim()}\n`)
  } catch (error) {
    console.error('Error:', error)
  }

  // Step 4: Get schema of erc1155_transfers to understand token_id format
  console.log('[STEP 4] Check erc1155_transfers schema...')
  try {
    const schemaResponse = await fetch(
      `${CH_HOST}/?query=DESCRIBE+erc1155_transfers`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(`default:${CH_PASSWORD}`).toString('base64')}`
        }
      }
    )
    const schemaText = await schemaResponse.text()
    console.log('Schema:')
    console.log(schemaText)
  } catch (error) {
    console.error('Error:', error)
  }

  console.log('\n════════════════════════════════════════════════════════════════════════════')
  console.log('Analysis complete. Ready to build the JOIN recovery query.')
}

main().catch(console.error)
