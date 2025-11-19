import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditJoinSuccess() {
  console.log('=== AUDIT #2: CRITICAL JOIN SUCCESS RATES ===\n')

  // Join #1: CLOB -> market_key_map
  console.log('Join #1: clob_fills -> market_key_map')
  const join1 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_fills,
        countIf(mkm.condition_id IS NOT NULL) as matched,
        countIf(mkm.condition_id IS NULL) as unmatched,
        round(100.0 * matched / total_fills, 2) as success_pct
      FROM clob_fills cf
      LEFT JOIN market_key_map mkm 
        ON lower(replaceAll(cf.condition_id, '0x', '')) = mkm.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j1 = await join1.json<{ total_fills: string; matched: string; unmatched: string; success_pct: string }>()
  console.log('   Total fills:', j1[0].total_fills)
  console.log('   Matched:', j1[0].matched)
  console.log('   Unmatched:', j1[0].unmatched)
  console.log('   Success rate:', j1[0].success_pct + '%')

  // Join #2: gamma_markets -> gamma_resolved
  console.log('\nJoin #2: gamma_markets -> gamma_resolved')
  const join2 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_markets,
        countIf(gr.condition_id IS NOT NULL) as resolved_markets,
        round(100.0 * resolved_markets / total_markets, 2) as resolution_pct
      FROM gamma_markets gm
      LEFT JOIN gamma_resolved gr ON gm.condition_id = gr.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j2 = await join2.json<{ total_markets: string; resolved_markets: string; resolution_pct: string }>()
  console.log('   Total markets:', j2[0].total_markets)
  console.log('   Resolved:', j2[0].resolved_markets)
  console.log('   Resolution rate:', j2[0].resolution_pct + '%')

  // Join #3: Traded markets -> resolutions
  console.log('\nJoin #3: Traded markets -> gamma_resolved')
  const join3 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as traded_markets,
        countIf(gr.condition_id IS NOT NULL) as resolved_traded,
        round(100.0 * resolved_traded / traded_markets, 2) as pct
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid 
        FROM clob_fills
      ) cf
      LEFT JOIN gamma_resolved gr ON cf.cid = gr.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j3 = await join3.json<{ traded_markets: string; resolved_traded: string; pct: string }>()
  console.log('   Traded markets:', j3[0].traded_markets)
  console.log('   With resolutions:', j3[0].resolved_traded)
  console.log('   Resolution rate:', j3[0].pct + '%')

  // Join #4: clob_fills -> wallet_identity_map
  console.log('\nJoin #4: clob_fills -> wallet_identity_map')
  const join4 = await clickhouse.query({
    query: `
      SELECT 
        count(DISTINCT proxy_wallet) as unique_wallets,
        count(DISTINCT wim.canonical_wallet) as mapped_wallets,
        round(100.0 * mapped_wallets / unique_wallets, 2) as pct
      FROM clob_fills cf
      LEFT JOIN wallet_identity_map wim ON cf.proxy_wallet = wim.canonical_wallet
    `,
    format: 'JSONEachRow',
  })
  const j4 = await join4.json<{ unique_wallets: string; mapped_wallets: string; pct: string }>()
  console.log('   Unique wallets:', j4[0].unique_wallets)
  console.log('   Mapped:', j4[0].mapped_wallets)
  console.log('   Mapping rate:', j4[0].pct + '%')
}

auditJoinSuccess()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
