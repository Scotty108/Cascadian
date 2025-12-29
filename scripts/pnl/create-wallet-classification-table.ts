/**
 * Create Wallet Classification Table for V8 PnL Engine
 *
 * This script creates the pm_wallet_classification table to distinguish:
 * - 'proxy': End-user proxy wallets (Gnosis Safe, Polymarket Proxy)
 * - 'infra': Infrastructure contracts (CTF, exchanges, factories)
 * - 'unknown': Unclassified wallets (default)
 *
 * Key insight from V8 spec:
 * - Polymarket users interact via proxy wallets, not EOAs
 * - CTF flows are attributed to proxy contracts, not end users
 * - We must exclude infrastructure contracts from wallet-level PnL
 *
 * Usage: npx tsx scripts/pnl/create-wallet-classification-table.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

async function main() {
  console.log('='.repeat(80));
  console.log('CREATING pm_wallet_classification TABLE');
  console.log('='.repeat(80));
  console.log('');

  // =========================================================================
  // STEP 1: Create the table
  // =========================================================================
  console.log('--- Step 1: Creating pm_wallet_classification table ---');

  const createTableSQL = `
CREATE TABLE IF NOT EXISTS pm_wallet_classification (
  -- Primary key
  wallet LowCardinality(String),

  -- Classification
  wallet_type LowCardinality(String),  -- 'proxy', 'infra', 'unknown'

  -- Optional metadata
  label Nullable(String),              -- Human-readable label (e.g., 'CTF Contract')
  contract_name Nullable(String),      -- Contract name if known

  -- Versioning
  classified_at DateTime DEFAULT now(),
  classification_source LowCardinality(String) DEFAULT 'manual',  -- 'manual', 'heuristic', 'api'
  is_deleted UInt8 DEFAULT 0
) ENGINE = ReplacingMergeTree(classified_at)
ORDER BY wallet
SETTINGS index_granularity = 8192
`;

  try {
    await client.command({ query: createTableSQL });
    console.log('✓ Table pm_wallet_classification created successfully');
  } catch (e) {
    console.error('Error creating table:', (e as Error).message);
    throw e;
  }

  // =========================================================================
  // STEP 2: Verify schema
  // =========================================================================
  console.log('');
  console.log('--- Step 2: Verifying schema ---');

  const schema = await client.query({
    query: 'DESCRIBE pm_wallet_classification',
    format: 'JSONEachRow'
  });
  const schemaData = await schema.json() as any[];

  console.log('Schema:');
  for (const col of schemaData) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // =========================================================================
  // STEP 3: Seed with known infrastructure contracts
  // =========================================================================
  console.log('');
  console.log('--- Step 3: Seeding with known infrastructure contracts ---');

  const infraContracts = [
    { wallet: '0x4d97dcd97ec945f40cf65f87097ace5ea0476045', label: 'ConditionalTokens', contract_name: 'CTF' },
    { wallet: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', label: 'Exchange (Binary)', contract_name: 'PolymarketExchange' },
    { wallet: '0xc5d563a36ae78145c45a50134d48a1215220f80a', label: 'Exchange (NegRisk)', contract_name: 'NegRiskExchange' },
    { wallet: '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296', label: 'NegRisk Adapter', contract_name: 'NegRiskAdapter' },
    { wallet: '0xaacfeea03eb1561c4e67d661e40682bd20e3541b', label: 'Gnosis Safe Factory', contract_name: 'GnosisSafeProxyFactory' },
    { wallet: '0xab45c54ab0c941a2f231c04c3f49182e1a254052', label: 'Polymarket Proxy Factory', contract_name: 'PolymarketProxyFactory' },
    { wallet: '0x0000000000000000000000000000000000000000', label: 'Zero Address', contract_name: 'ZeroAddress' },
  ];

  for (const contract of infraContracts) {
    const insertSQL = `
INSERT INTO pm_wallet_classification (wallet, wallet_type, label, contract_name, classification_source)
VALUES ('${contract.wallet.toLowerCase()}', 'infra', '${contract.label}', '${contract.contract_name}', 'manual')
`;
    try {
      await client.command({ query: insertSQL });
      console.log(`  ✓ ${contract.label}: ${contract.wallet}`);
    } catch (e) {
      console.log(`  ⚠ ${contract.label}: Already exists or error: ${(e as Error).message}`);
    }
  }

  // =========================================================================
  // STEP 4: Verify seeded data
  // =========================================================================
  console.log('');
  console.log('--- Step 4: Verifying seeded data ---');

  const countResult = await client.query({
    query: `
      SELECT
        wallet_type,
        count() AS count,
        groupArray(label) AS labels
      FROM pm_wallet_classification
      WHERE is_deleted = 0
      GROUP BY wallet_type
    `,
    format: 'JSONEachRow'
  });
  const counts = await countResult.json() as any[];

  for (const row of counts) {
    console.log(`  ${row.wallet_type}: ${row.count} wallets`);
    console.log(`    Labels: ${row.labels.join(', ')}`);
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('');
  console.log('='.repeat(80));
  console.log('WALLET CLASSIFICATION TABLE CREATED SUCCESSFULLY');
  console.log('='.repeat(80));
  console.log('');
  console.log('Table: pm_wallet_classification');
  console.log('  - wallet_type: proxy, infra, unknown');
  console.log('  - Seeded with known infrastructure contracts');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Classify proxy wallets using heuristics (script TBD)');
  console.log('  2. Create vw_ctf_flows_attributed_proxy view');
  console.log('  3. Build v8 PnL view at proxy wallet level');

  await client.close();
}

main().catch(console.error);
