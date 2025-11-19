#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const ch = createClient({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
})

async function q(sql: string) {
  const r = await ch.query({ query: sql, format: 'JSONEachRow' })
  return await r.json()
}

async function checkZeroMarketIdTrades() {
  console.log('═'.repeat(70))
  console.log('INVESTIGATING 79M "ZERO MARKET_ID" TRADES')
  console.log('═'.repeat(70))
  console.log()

  // Check 1: Do they have transaction_hash?
  console.log('Check 1: Do zero market_id trades have transaction_hash?')
  const txHashCheck = await q(`
    SELECT
      COUNT(*) as total_zero_market_id,
      COUNT(CASE WHEN transaction_hash != '' AND transaction_hash IS NOT NULL THEN 1 END) as with_tx_hash,
      COUNT(CASE WHEN transaction_hash = '' OR transaction_hash IS NULL THEN 1 END) as without_tx_hash
    FROM trades_raw
    WHERE market_id = '' OR lower(market_id) IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000')
  `)
  console.log('  Total zero market_id trades:', Number(txHashCheck[0].total_zero_market_id).toLocaleString())
  console.log('  With transaction_hash:', Number(txHashCheck[0].with_tx_hash).toLocaleString())
  console.log('  Without transaction_hash:', Number(txHashCheck[0].without_tx_hash).toLocaleString())
  const txHashPct = Number(txHashCheck[0].with_tx_hash) / Number(txHashCheck[0].total_zero_market_id) * 100
  console.log(`  Coverage: ${txHashPct.toFixed(1)}%`)
  console.log()

  // Check 2: Sample a few to see what data they have
  console.log('Check 2: Sample trades with zero market_id')
  const samples = await q(`
    SELECT
      wallet_address,
      market_id,
      transaction_hash,
      timestamp,
      side,
      shares,
      entry_price
    FROM trades_raw
    WHERE market_id = '' OR lower(market_id) IN ('0x0','0x')
    LIMIT 5
  `)
  console.log('Sample trades:')
  samples.forEach((trade: any, i: number) => {
    console.log(`\n  Sample ${i + 1}:`)
    console.log(`    Wallet: ${trade.wallet_address}`)
    console.log(`    Market ID: "${trade.market_id}"`)
    console.log(`    TX Hash: ${trade.transaction_hash}`)
    console.log(`    Timestamp: ${trade.timestamp}`)
    console.log(`    Side: ${trade.side}, Shares: ${trade.shares}, Price: ${trade.entry_price}`)
  })
  console.log()

  // Check 3: Can we match tx_hash to erc1155_transfers?
  console.log('Check 3: Can we match transaction_hash to erc1155_transfers?')
  const matchCheck = await q(`
    SELECT COUNT(*) as matches
    FROM trades_raw t
    INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
    WHERE t.market_id = '' OR lower(t.market_id) IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000')
    LIMIT 100000
  `)
  console.log('  Matches (sample 100K):', Number(matchCheck[0].matches).toLocaleString())
  console.log()

  // Check 4: Sample a match to see if we can extract condition_id
  console.log('Check 4: Sample match with erc1155_transfers')
  const sampleMatch = await q(`
    SELECT
      t.wallet_address,
      t.transaction_hash,
      e.condition_id as erc1155_condition_id,
      e.token_id,
      e.amount
    FROM trades_raw t
    INNER JOIN erc1155_transfers e ON lower(t.transaction_hash) = lower(e.tx_hash)
    WHERE t.market_id = '' OR lower(t.market_id) IN ('0x0','0x')
    LIMIT 3
  `)
  if (sampleMatch.length > 0) {
    console.log('  Sample matches:')
    sampleMatch.forEach((match: any, i: number) => {
      console.log(`\n    Match ${i + 1}:`)
      console.log(`      Wallet: ${match.wallet_address}`)
      console.log(`      TX Hash: ${match.transaction_hash}`)
      console.log(`      Condition ID (from ERC1155): ${match.erc1155_condition_id}`)
      console.log(`      Token ID: ${match.token_id}`)
      console.log(`      Amount: ${match.amount}`)
    })
  } else {
    console.log('  No matches found in sample')
  }
  console.log()

  // Check 5: How many can potentially be recovered via tx_hash join?
  console.log('Check 5: Upper bound recovery via tx_hash → erc1155_transfers')
  const recoveryPotential = await q(`
    SELECT COUNT(DISTINCT t.trade_id) as recoverable_trades
    FROM trades_raw t
    WHERE (t.market_id = '' OR lower(t.market_id) IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000'))
      AND t.transaction_hash != ''
      AND EXISTS (
        SELECT 1 FROM erc1155_transfers e
        WHERE lower(e.tx_hash) = lower(t.transaction_hash)
      )
  `)
  console.log('  Recoverable trades (via tx_hash JOIN):', Number(recoveryPotential[0].recoverable_trades).toLocaleString())
  const recoverablePct = Number(recoveryPotential[0].recoverable_trades) / Number(txHashCheck[0].total_zero_market_id) * 100
  console.log(`  Recovery potential: ${recoverablePct.toFixed(1)}%`)
  console.log()

  console.log('═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))
  if (txHashPct > 90 && recoverablePct > 50) {
    console.log('✅ GOOD NEWS: Most zero market_id trades have tx_hash and can be recovered!')
    console.log('   Next step: Create enrichment script using tx_hash → erc1155_transfers JOIN')
    console.log('   Estimated recovery: ' + recoverablePct.toFixed(1) + '%')
  } else if (txHashPct > 50) {
    console.log('⚠️  PARTIAL: Some trades have tx_hash but recovery potential is limited')
    console.log('   Consider combining multiple recovery strategies')
  } else {
    console.log('❌ BAD NEWS: Most trades lack transaction_hash - cannot recover via blockchain')
    console.log('   These are likely placeholder/synthetic trades from early ingestion')
  }
  console.log()
}

checkZeroMarketIdTrades().catch(console.error)
