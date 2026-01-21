import { config } from 'dotenv'
config({ path: '.env.local' })
import { clickhouse } from '../lib/clickhouse/client'
import { readFileSync, writeFileSync } from 'fs'

async function main() {
  // Get all 102K target wallets (30d filter)
  const query = `
    SELECT wallet
    FROM pm_canonical_fills_v4 f
    JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      AND r.is_deleted = 0 AND r.payout_numerators != ''
    WHERE f.tokens_delta > 0
      AND f.event_time >= now() - INTERVAL 30 DAY
      AND f.wallet != '0x0000000000000000000000000000000000000000'
      AND abs(f.usdc_delta / f.tokens_delta) BETWEEN 0.02 AND 0.98
    GROUP BY wallet
    HAVING count() >= 5 AND count() <= 10000 AND uniqExact(f.condition_id) >= 2
  `
  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const target30d = new Set((await result.json() as {wallet: string}[]).map(w => w.wallet))
  console.log(`Target 30d wallets: ${target30d.size}`)

  // Load 59K partial
  const partial59k = new Set<string>()
  try {
    const lines = readFileSync('./data/top-asinh-v4-partial-59k.jsonl', 'utf-8').trim().split('\n').filter(l => l)
    for (const line of lines) partial59k.add(JSON.parse(line).wallet)
  } catch {}
  console.log(`59K partial wallets: ${partial59k.size}`)

  // Load 86K partial (75k file)
  const partial86k = new Set<string>()
  try {
    const lines = readFileSync('./data/top-asinh-v4-partial-75k.jsonl', 'utf-8').trim().split('\n').filter(l => l)
    for (const line of lines) partial86k.add(JSON.parse(line).wallet)
  } catch {}
  console.log(`86K partial wallets: ${partial86k.size}`)

  // Combined processed
  const allProcessed = new Set([...partial59k, ...partial86k])
  console.log(`Total unique processed: ${allProcessed.size}`)

  // How many of the 102K target are already in our partials?
  const targetAlreadyDone = [...target30d].filter(w => allProcessed.has(w))
  console.log(`Target already done: ${targetAlreadyDone.length}`)

  // Remaining target wallets
  const remaining = [...target30d].filter(w => !allProcessed.has(w))
  console.log(`Remaining to process: ${remaining.length}`)

  // Save remaining
  writeFileSync('./data/remaining_wallets.json', JSON.stringify(remaining))
  console.log('Saved remaining to ./data/remaining_wallets.json')
}
main()
