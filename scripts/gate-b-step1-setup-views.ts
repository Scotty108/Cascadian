#!/usr/bin/env npx tsx

/**
 * GATE B RECOVERY - STEP 1: Setup SQL Views and Staging Table
 *
 * Creates canonical views for:
 * - Resolution CIDs (_res_cid)
 * - Existing fact CIDs (_fact_cid)
 * - Missing CIDs (_still_missing_cids)
 * - Candidate CTF addresses (_candidate_ctf_addresses)
 *
 * Also creates repair_pairs_temp staging table for blockchain backfill.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function setupViews() {
  console.log('='.repeat(100))
  console.log('GATE B RECOVERY - STEP 1: Setup SQL Views and Staging Table')
  console.log('='.repeat(100))

  try {
    // Canonical resolution CIDs
    console.log('\n[1/5] Creating _res_cid view (canonical resolution CIDs)...')
    await clickhouse.command({
      query: `
        CREATE OR REPLACE VIEW _res_cid AS
        SELECT lower(concat('0x', lpad(replaceOne(lower(condition_id_norm),'0x',''),64,'0'))) AS cid
        FROM market_resolutions_final
        WHERE condition_id_norm != '';
      `
    })

    const resCount = await clickhouse.query({
      query: 'SELECT count() as count FROM _res_cid',
      format: 'JSONEachRow'
    })
    const resCidCount = await resCount.json<{ count: string }>()
    console.log(`✅ _res_cid created: ${parseInt(resCidCount[0].count).toLocaleString()} resolution CIDs`)

    // Existing CIDs in fact table
    console.log('\n[2/5] Creating _fact_cid view (existing fact CIDs)...')
    await clickhouse.command({
      query: `
        CREATE OR REPLACE VIEW _fact_cid AS
        SELECT DISTINCT cid FROM fact_trades_clean;
      `
    })

    const factCount = await clickhouse.query({
      query: 'SELECT count() as count FROM _fact_cid',
      format: 'JSONEachRow'
    })
    const factCidCount = await factCount.json<{ count: string }>()
    console.log(`✅ _fact_cid created: ${parseInt(factCidCount[0].count).toLocaleString()} existing CIDs`)

    // Still-missing CIDs
    console.log('\n[3/5] Creating _still_missing_cids view (target CIDs for recovery)...')
    await clickhouse.command({
      query: `
        CREATE OR REPLACE VIEW _still_missing_cids AS
        SELECT cid FROM _res_cid
        WHERE cid NOT IN (SELECT cid FROM _fact_cid);
      `
    })

    const missingCount = await clickhouse.query({
      query: 'SELECT count() as count FROM _still_missing_cids',
      format: 'JSONEachRow'
    })
    const missingCidCount = await missingCount.json<{ count: string }>()
    console.log(`✅ _still_missing_cids created: ${parseInt(missingCidCount[0].count).toLocaleString()} missing CIDs to recover`)

    // Candidate CTF addresses
    console.log('\n[4/5] Creating _candidate_ctf_addresses view...')
    await clickhouse.command({
      query: `
        CREATE OR REPLACE VIEW _candidate_ctf_addresses AS
        WITH overlap AS (
          SELECT cid FROM _res_cid WHERE cid IN (SELECT cid FROM _fact_cid)
        ),
        addr_from_maps AS (
          SELECT lower(market_address) AS addr FROM erc1155_condition_map
          WHERE lower(concat('0x', lpad(replaceOne(lower(condition_id),'0x',''),64,'0'))) IN (SELECT cid FROM overlap)
        ),
        addr_from_logs AS (
          SELECT DISTINCT lower(contract) AS addr
          FROM erc1155_transfers
          WHERE length(token_id) > 0
        )
        SELECT DISTINCT addr FROM addr_from_maps
        UNION ALL
        SELECT DISTINCT addr FROM addr_from_logs
        UNION ALL
        SELECT lower('0x4D97DCd97eC945f40cF65F87097ACe5EA0476045') AS addr;
      `
    })

    const addrCount = await clickhouse.query({
      query: 'SELECT count() as count FROM _candidate_ctf_addresses',
      format: 'JSONEachRow'
    })
    const addrCountResult = await addrCount.json<{ count: string }>()
    console.log(`✅ _candidate_ctf_addresses created: ${parseInt(addrCountResult[0].count).toLocaleString()} candidate addresses`)

    // Create repair_pairs_temp staging table
    console.log('\n[5/5] Creating repair_pairs_temp staging table...')
    await clickhouse.command({
      query: `
        DROP TABLE IF EXISTS repair_pairs_temp;
      `
    })

    await clickhouse.command({
      query: `
        CREATE TABLE repair_pairs_temp
        (
          tx_hash String,
          cid String
        )
        ENGINE = MergeTree
        ORDER BY (cid, tx_hash);
      `
    })
    console.log('✅ repair_pairs_temp table created')

    // Summary
    console.log('\n' + '='.repeat(100))
    console.log('SETUP COMPLETE - Summary:')
    console.log('='.repeat(100))
    console.log(`Total resolution CIDs:     ${parseInt(resCidCount[0].count).toLocaleString()}`)
    console.log(`Existing in fact table:    ${parseInt(factCidCount[0].count).toLocaleString()}`)
    console.log(`Missing CIDs to recover:   ${parseInt(missingCidCount[0].count).toLocaleString()}`)
    console.log(`Candidate CTF addresses:   ${parseInt(addrCountResult[0].count).toLocaleString()}`)
    console.log(`\nCurrent Gate B Coverage: ${(100 * parseInt(factCidCount[0].count) / parseInt(resCidCount[0].count)).toFixed(2)}%`)
    console.log(`Target Gate B Coverage:  ≥85.00%`)
    console.log(`\nNext: Run gate-b-step2-blockchain-backfill.ts to fetch missing events`)

  } catch (error) {
    console.error('❌ Error during setup:', error)
    throw error
  }
}

setupViews().catch(console.error)
