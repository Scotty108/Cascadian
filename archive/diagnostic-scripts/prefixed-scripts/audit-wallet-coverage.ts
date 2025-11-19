import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== WALLET COVERAGE ===\n')

  // Unique wallets in clob_fills
  const q1 = await clickhouse.query({
    query: 'SELECT count(DISTINCT proxy_wallet) as unique_wallets FROM clob_fills',
    format: 'JSONEachRow',
  })
  const wallets = (await q1.json<{ unique_wallets: string }>())[0]
  console.log('Unique wallets in clob_fills:', wallets.unique_wallets)

  // Wallet identity map
  const q2 = await clickhouse.query({
    query: 'SELECT count(*) as total_rows, count(DISTINCT canonical_wallet) as unique_canonical FROM wallet_identity_map',
    format: 'JSONEachRow',
  })
  const wim = (await q2.json<{ total_rows: string; unique_canonical: string }>())[0]
  console.log('\nwallet_identity_map:')
  console.log('   Total rows:', wim.total_rows)
  console.log('   Unique canonical wallets:', wim.unique_canonical)

  // Check mapping coverage
  const q3 = await clickhouse.query({
    query: `
      SELECT 
        count(DISTINCT cf.proxy_wallet) as total_wallets,
        count(DISTINCT wim.canonical_wallet) as mapped_wallets
      FROM clob_fills cf
      LEFT JOIN wallet_identity_map wim ON cf.proxy_wallet = wim.canonical_wallet
    `,
    format: 'JSONEachRow',
  })
  const coverage = (await q3.json<{ total_wallets: string; mapped_wallets: string }>())[0]
  const pct = (parseInt(coverage.mapped_wallets) / parseInt(coverage.total_wallets) * 100).toFixed(2)
  console.log('\nMapping coverage:')
  console.log('   Total unique wallets:', coverage.total_wallets)
  console.log('   Mapped in identity map:', coverage.mapped_wallets)
  console.log('   Coverage:', pct + '%')
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })
