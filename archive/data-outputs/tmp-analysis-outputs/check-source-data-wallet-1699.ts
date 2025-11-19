#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const WALLET = '0x1699e13609a154eabe8234ff078f1000ea5980e2'

async function checkSourceData() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('CHECKING SOURCE DATA FOR WALLET: ' + WALLET)
    console.log('=' .repeat(80))
    console.log('')

    // Check CLOB fills (main source)
    console.log('1. CLOB fills (clob_fills table):')
    console.log('-'.repeat(80))

    const clobFills = await client.query({
      query: `
        SELECT
          count() as total_fills,
          count(DISTINCT asset_id) as unique_assets,
          count(DISTINCT condition_id) as unique_conditions,
          sum(abs(price * size / 1000000)) as total_volume
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const clobData = await clobFills.json<any[]>()

    console.log(`  Total fills: ${clobData[0].total_fills}`)
    console.log(`  Unique assets: ${clobData[0].unique_assets}`)
    console.log(`  Unique conditions: ${clobData[0].unique_conditions}`)
    console.log(`  Total volume: $${parseFloat(clobData[0].total_volume).toLocaleString()}`)
    console.log('')

    // Check ERC1155 transfers (blockchain source)
    console.log('2. ERC1155 transfers (erc1155_transfers table):')
    console.log('-'.repeat(80))

    const erc1155 = await client.query({
      query: `
        SELECT
          count() as total_transfers,
          count(DISTINCT token_id) as unique_tokens,
          sum(abs(toFloat64OrZero(value))) as total_value
        FROM erc1155_transfers
        WHERE from = '${WALLET}' OR to = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const erc1155Data = await erc1155.json<any[]>()

    console.log(`  Total transfers: ${erc1155Data[0].total_transfers}`)
    console.log(`  Unique tokens: ${erc1155Data[0].unique_tokens}`)
    console.log(`  Total value: ${parseFloat(erc1155Data[0].total_value).toLocaleString()}`)
    console.log('')

    // Check trade_cashflows_v3 (our processed table)
    console.log('3. Our processed cashflows (trade_cashflows_v3):')
    console.log('-'.repeat(80))

    const cashflows = await client.query({
      query: `
        SELECT
          count() as total_cashflows,
          count(DISTINCT condition_id_norm) as unique_markets,
          sum(abs(cashflow_usdc)) as total_volume
        FROM trade_cashflows_v3
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const cashflowData = await cashflows.json<any[]>()

    console.log(`  Total cashflows: ${cashflowData[0].total_cashflows}`)
    console.log(`  Unique markets: ${cashflowData[0].unique_markets}`)
    console.log(`  Total volume: $${parseFloat(cashflowData[0].total_volume).toLocaleString()}`)
    console.log('')

    // Check sample fills from CLOB
    console.log('4. Sample CLOB fills for this wallet:')
    console.log('-'.repeat(80))

    const sampleFills = await client.query({
      query: `
        SELECT
          asset_id,
          condition_id,
          side,
          price,
          size,
          price * size / 1000000 as usdc_value,
          timestamp
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
        ORDER BY timestamp DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })
    const fills = await sampleFills.json<any[]>()

    fills.forEach((f, idx) => {
      const display_id = f.condition_id || f.asset_id
      console.log(`  ${idx + 1}. ${display_id.substring(0, 16)}... ${f.side} ${f.size}@${f.price} = $${parseFloat(f.usdc_value).toFixed(2)}`)
    })
    console.log('')

    console.log('=' .repeat(80))
    console.log('FINDINGS:')
    console.log('=' .repeat(80))
    console.log('')

    const clobVolume = parseFloat(clobData[0].total_volume)
    const cashflowVolume = parseFloat(cashflowData[0].total_volume)
    const clobConditions = parseInt(clobData[0].unique_conditions)
    const cashflowMarkets = parseInt(cashflowData[0].unique_markets)

    console.log(`CLOB fills volume: $${clobVolume.toLocaleString()}`)
    console.log(`Our cashflows volume: $${cashflowVolume.toLocaleString()}`)
    console.log(`Coverage: ${(cashflowVolume / clobVolume * 100).toFixed(1)}%`)
    console.log('')

    console.log(`CLOB unique conditions: ${clobConditions}`)
    console.log(`Our unique markets: ${cashflowMarkets}`)
    console.log(`Coverage: ${(cashflowMarkets / clobConditions * 100).toFixed(1)}%`)
    console.log('')

    if (clobVolume > cashflowVolume * 1.5) {
      console.log('⚠️  MAJOR DATA LOSS: We are missing >50% of CLOB fill data!')
      console.log('   Possible causes:')
      console.log('   - market_id to condition_id mapping incomplete')
      console.log('   - trade_cashflows_v3 build process has bugs')
      console.log('   - Data pipeline stopped early')
    }

    if (clobConditions > cashflowMarkets * 1.5) {
      console.log('⚠️  MAJOR MARKET LOSS: We are missing >50% of markets!')
      console.log('   This explains why Polymarket shows 70 trades but we only have 30')
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    throw error
  } finally {
    await client.close()
  }
}

checkSourceData()
