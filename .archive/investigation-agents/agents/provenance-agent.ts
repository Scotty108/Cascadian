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

// Normalize market_id to lowercase hex with 0x prefix when it already looks hex.
// Decimal ids are treated as invalid sentinel values.
const HEX_RE = /^0x[0-9a-fA-F]{10,}$/
function looksHex(x: string) { return HEX_RE.test(x) }

async function status() {
  const [tot, withCid, zeroMkt, distMktsTrades, distMktsMap, mapRows] = await Promise.all([
    q(`SELECT count() AS n FROM trades_raw`),
    q(`SELECT count() AS n FROM trades_raw WHERE condition_id != '' AND condition_id IS NOT NULL`),
    q(`SELECT count() AS n FROM trades_raw WHERE market_id = '' OR lower(market_id) IN ('0x0','0x','0x0000000000000000000000000000000000000000000000000000000000000000')`),
    q(`SELECT countDistinct(market_id) AS n FROM trades_raw`),
    q(`SELECT countDistinct(market_id) AS n FROM condition_market_map`),
    q(`SELECT count() AS n FROM condition_market_map`),
  ])
  const total = Number(tot[0].n)
  const haveCid = Number(withCid[0].n)
  console.log(JSON.stringify({
    total_trades: total,
    trades_with_condition_id: haveCid,
    coverage_pct: +(100 * haveCid / total).toFixed(2),
    zero_or_empty_market_id_rows: Number(zeroMkt[0].n),
    distinct_markets_in_trades: Number(distMktsTrades[0].n),
    distinct_markets_in_condition_map: Number(distMktsMap[0].n),
    condition_map_rows: Number(mapRows[0].n),
    conclusion: "If zero_or_empty_market_id_rows is large, those rows cannot be enriched without recovering true market_id from chain."
  }, null, 2))
}

async function proveTrades() {
  // How many missing trades even have usable market_id and tx_hash signals
  const rows = await q(`
    SELECT
      count()                                           AS missing_total,
      countIf((condition_id = '' OR condition_id IS NULL) AND tx_hash != '') AS missing_with_tx_hash,
      countIf((condition_id = '' OR condition_id IS NULL) AND market_id != '' AND market_id != '0x0') AS missing_with_nonzero_market_id
    FROM trades_raw
  `)

  // Sample join to see if missing trades align with ERC1155 logs at all
  const matches = await q(`
    SELECT count() AS n
    FROM erc1155_transfers
    WHERE tx_hash IN (
      SELECT DISTINCT tx_hash
      FROM trades_raw
      WHERE (condition_id = '' OR condition_id IS NULL)
        AND tx_hash != ''
      LIMIT 100000
    )
  `)

  console.log(JSON.stringify({
    missing_summary: rows[0],
    erc1155_matches_in_sample_100k_tx: Number(matches[0].n),
    inference: "Low match rate implies trades_raw contains non chain-proven events or placeholders."
  }, null, 2))
}

async function proveChain() {
  const stats = await q(`
    SELECT
      count() AS erc1155_rows,
      countDistinct(tx_hash) AS erc1155_distinct_txs,
      min(block_number) AS min_block,
      max(block_number) AS max_block
    FROM erc1155_transfers
  `)
  console.log(JSON.stringify(stats[0], null, 2))
}

async function mapCoverage() {
  // Upper bound of what the mapping table can enrich today
  const res = await q(`
    WITH missing AS (
      SELECT * FROM trades_raw
      WHERE condition_id = '' OR condition_id IS NULL
    )
    SELECT
      (SELECT count() FROM missing)                                            AS missing_total,
      (SELECT count() FROM missing WHERE lower(market_id) IN (SELECT lower(market_id) FROM condition_market_map)) AS joinable_by_market_id,
      (SELECT count() FROM missing WHERE market_slug != '' AND market_slug IN (SELECT market_slug FROM condition_market_map WHERE market_slug != '')) AS joinable_by_slug
  `)
  const r = res[0] as any
  const joinableUpper = Math.min(Number(r.missing_total), Number(r.joinable_by_market_id) + Number(r.joinable_by_slug))
  console.log(JSON.stringify({
    missing_total: Number(r.missing_total),
    joinable_by_market_id: Number(r.joinable_by_market_id),
    joinable_by_slug: Number(r.joinable_by_slug),
    resolvable_upper_bound: joinableUpper,
    est_resolvable_pct_of_missing: +(100 * joinableUpper / Math.max(1, Number(r.missing_total))).toFixed(2),
    note: "Upper bound ignores overlap. Realized will be lower."
  }, null, 2))
}

async function main() {
  const cmd = process.argv[2] || 'status'
  if (cmd === 'status') return status()
  if (cmd === 'prove-trades') return proveTrades()
  if (cmd === 'prove-chain') return proveChain()
  if (cmd === 'map-coverage') return mapCoverage()
  console.error('usage: status | prove-trades | prove-chain | map-coverage')
  process.exit(2)
}
main().catch(e => { console.error(e); process.exit(1) })
