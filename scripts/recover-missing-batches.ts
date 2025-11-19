import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function recover() {
  try {
    console.log('🔧 RECOVERING MISSING ROWS FROM FAILED BATCHES')
    console.log('═'.repeat(70))
    console.log()
    console.log('Failed batches: 73, 75, 77, 80')
    console.log('Strategy: Use 500K micro-batches to avoid HTTP header overflow')
    console.log()

    // Batch 73: offset 144M (2M rows)
    console.log('Recovering Batch 73 (offset 144.0M - 146.0M)...')
    let offset = 144_000_000
    let recovered = 0
    for (let i = 0; i < 4; i++) {
      process.stdout.write(`  Micro ${i + 1}/4 (${(offset / 1_000_000).toFixed(1)}M)... `)
      try {
        await clickhouse.query({
          query: `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id, t.wallet_address, t.market_id, t.timestamp, t.side, t.entry_price, t.exit_price,
  t.shares, t.usd_value, t.pnl, t.is_closed, t.transaction_hash, t.created_at, t.close_price,
  t.fee_usd, t.slippage_usd, t.hours_held, t.bankroll_at_entry, t.outcome, t.fair_price_at_entry,
  t.pnl_gross, t.pnl_net, t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win, t.tx_timestamp, t.canonical_category, t.raw_tags, t.realized_pnl_usd, t.is_resolved,
  t.resolved_outcome
FROM (SELECT * FROM trades_raw LIMIT 500000 OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })
        console.log('✓')
        offset += 500000
        recovered += 500000
      } catch (e: any) {
        console.log('✗')
        if (e.message.includes('Header overflow')) {
          console.log('    Still hitting header overflow, waiting 3s...')
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    console.log(`  Result: ${(recovered / 1_000_000).toFixed(1)}M rows recovered`)
    console.log()

    // Batch 75: offset 148M (2M rows)
    console.log('Recovering Batch 75 (offset 148.0M - 150.0M)...')
    offset = 148_000_000
    recovered = 0
    for (let i = 0; i < 4; i++) {
      process.stdout.write(`  Micro ${i + 1}/4 (${(offset / 1_000_000).toFixed(1)}M)... `)
      try {
        await clickhouse.query({
          query: `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id, t.wallet_address, t.market_id, t.timestamp, t.side, t.entry_price, t.exit_price,
  t.shares, t.usd_value, t.pnl, t.is_closed, t.transaction_hash, t.created_at, t.close_price,
  t.fee_usd, t.slippage_usd, t.hours_held, t.bankroll_at_entry, t.outcome, t.fair_price_at_entry,
  t.pnl_gross, t.pnl_net, t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win, t.tx_timestamp, t.canonical_category, t.raw_tags, t.realized_pnl_usd, t.is_resolved,
  t.resolved_outcome
FROM (SELECT * FROM trades_raw LIMIT 500000 OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })
        console.log('✓')
        offset += 500000
        recovered += 500000
      } catch (e: any) {
        console.log('✗')
        if (e.message.includes('Header overflow')) {
          console.log('    Still hitting header overflow, waiting 3s...')
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    console.log(`  Result: ${(recovered / 1_000_000).toFixed(1)}M rows recovered`)
    console.log()

    // Batch 77: offset 152M (2M rows)
    console.log('Recovering Batch 77 (offset 152.0M - 154.0M)...')
    offset = 152_000_000
    recovered = 0
    for (let i = 0; i < 4; i++) {
      process.stdout.write(`  Micro ${i + 1}/4 (${(offset / 1_000_000).toFixed(1)}M)... `)
      try {
        await clickhouse.query({
          query: `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id, t.wallet_address, t.market_id, t.timestamp, t.side, t.entry_price, t.exit_price,
  t.shares, t.usd_value, t.pnl, t.is_closed, t.transaction_hash, t.created_at, t.close_price,
  t.fee_usd, t.slippage_usd, t.hours_held, t.bankroll_at_entry, t.outcome, t.fair_price_at_entry,
  t.pnl_gross, t.pnl_net, t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win, t.tx_timestamp, t.canonical_category, t.raw_tags, t.realized_pnl_usd, t.is_resolved,
  t.resolved_outcome
FROM (SELECT * FROM trades_raw LIMIT 500000 OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })
        console.log('✓')
        offset += 500000
        recovered += 500000
      } catch (e: any) {
        console.log('✗')
        if (e.message.includes('Header overflow')) {
          console.log('    Still hitting header overflow, waiting 3s...')
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    console.log(`  Result: ${(recovered / 1_000_000).toFixed(1)}M rows recovered`)
    console.log()

    // Batch 80: offset 158M (remaining rows to 160.9M)
    console.log('Recovering Batch 80 (offset 158.0M - 160.9M)...')
    offset = 158_000_000
    recovered = 0
    // Only ~2.9M rows remain
    for (let i = 0; i < 6; i++) {
      process.stdout.write(`  Micro ${i + 1}/6 (${(offset / 1_000_000).toFixed(1)}M)... `)
      try {
        await clickhouse.query({
          query: `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id, t.wallet_address, t.market_id, t.timestamp, t.side, t.entry_price, t.exit_price,
  t.shares, t.usd_value, t.pnl, t.is_closed, t.transaction_hash, t.created_at, t.close_price,
  t.fee_usd, t.slippage_usd, t.hours_held, t.bankroll_at_entry, t.outcome, t.fair_price_at_entry,
  t.pnl_gross, t.pnl_net, t.return_pct,
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win, t.tx_timestamp, t.canonical_category, t.raw_tags, t.realized_pnl_usd, t.is_resolved,
  t.resolved_outcome
FROM (SELECT * FROM trades_raw LIMIT 500000 OFFSET ${offset}) t
LEFT JOIN condition_market_map m ON t.market_id = m.market_id
          `
        })
        console.log('✓')
        offset += 500000
        recovered += 500000
        if (offset >= 160_900_000) break
      } catch (e: any) {
        console.log('✗')
        if (e.message.includes('Header overflow')) {
          console.log('    Still hitting header overflow, waiting 3s...')
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    console.log(`  Result: ${(recovered / 1_000_000).toFixed(1)}M rows recovered`)
    console.log()

    // Final verification
    console.log('═'.repeat(70))
    console.log('FINAL COVERAGE VERIFICATION')
    console.log('═'.repeat(70))
    const result = await clickhouse.query({
      query: `SELECT COUNT(*) as total, COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id FROM trades_raw_enriched_final`
    })

    const data = JSON.parse(await result.text()).data[0]
    const totalRows = parseInt(data.total)
    const withId = parseInt(data.with_id)
    const coverage = ((withId / totalRows) * 100).toFixed(2)

    console.log(`Total rows: ${totalRows.toLocaleString()}`)
    console.log(`With condition_id: ${withId.toLocaleString()}`)
    console.log(`Coverage: ${coverage}%`)
    console.log()

    // Compare to original
    const improvement = (parseFloat(coverage) - 51.47).toFixed(2)
    console.log(`IMPROVEMENT: 51.47% → ${coverage}% (+${improvement} pp)`)
    console.log()

    if (totalRows === 160_900_000) {
      console.log('✅ 100% COMPLETE! All 160.9M rows enriched!')
    } else {
      console.log(`⚠️  ${totalRows.toLocaleString()} of 160,900,000 rows (${((totalRows/160900000)*100).toFixed(1)}%)`)
    }

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

recover()
