import { config } from 'dotenv'
config({ path: '.env.local' })
import { clickhouse } from '../lib/clickhouse/client'
import { readFileSync, writeFileSync } from 'fs'

async function main() {
  // Get all target wallets (30d, 5+, 2+, ≤10K)
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
  const allWallets = new Set((await result.json() as {wallet: string}[]).map(w => w.wallet))
  console.log(`Total target wallets: ${allWallets.size}`)

  // Load already processed wallets from all partials
  const processed = new Set<string>()
  for (const file of ['./data/top-asinh-v4-partial-75k.jsonl', './data/top-asinh-v4-partial-59k.jsonl', './data/top-asinh-v4-temp.jsonl']) {
    try {
      const lines = readFileSync(file, 'utf-8').trim().split('\n').filter(l => l)
      for (const line of lines) {
        const { wallet } = JSON.parse(line)
        processed.add(wallet)
      }
    } catch {}
  }
  console.log(`Already processed: ${processed.size}`)

  // Find remaining
  const remaining = [...allWallets].filter(w => !processed.has(w))
  console.log(`Remaining to process: ${remaining.length}`)

  // Save remaining wallets
  writeFileSync('./data/remaining_wallets.json', JSON.stringify(remaining))
  console.log('Saved to ./data/remaining_wallets.json')
}
main()
