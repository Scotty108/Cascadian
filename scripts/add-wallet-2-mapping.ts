#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const query = `
INSERT INTO wallet_identity_overrides VALUES (
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',  -- Executor (Wallet #2)
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- True Account (XCN account)
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multihop',
  now(),
  now()
);
`;

  console.log('Adding wallet #2 mapping to wallet_identity_overrides...');
  await clickhouse.query({ query });
  console.log('✅ Mapping added successfully');
  console.log('');
  console.log('Mapping Details:');
  console.log('  Executor #2:  0xf29bb8e0712075041e87e8605b69833ef738dd4c ($308M volume)');
  console.log('  Account:      0xcce2b7c71f21e358b8e5e797e586cbc03160d58b (same as XCN)');
  console.log('  Evidence:     98.26% tx overlap, 13,126 shared transactions');
  console.log('');
  console.log('Discovery: Multi-proxy pattern detected!');
  console.log('  • Same trader uses 2+ executor proxies');
  console.log('  • Wallet #1 (XCN): 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e → 0xcce2...d58b');
  console.log('  • Wallet #2:        0xf29bb8e0712075041e87e8605b69833ef738dd4c → 0xcce2...d58b');
  console.log('  • Combined volume: $5.8B + $308M = $6.1B');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
