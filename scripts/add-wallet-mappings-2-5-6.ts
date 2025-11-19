#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('ADDING VALIDATED WALLET MAPPINGS (#2, #5, #6)');
  console.log('═'.repeat(80));
  console.log('');

  const trueAccount = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const mappings = [
    {
      num: 2,
      executor: '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
      overlap: 98.26,
      volume: 307806466,
      evidence: '98.26% overlap, 13,126 shared txs'
    },
    {
      num: 5,
      executor: '0xee00ba338c59557141789b127927a55f5cc5cea1',
      overlap: 97.62,
      volume: 110633603,
      evidence: '97.62% overlap, 42,374 shared txs'
    },
    {
      num: 6,
      executor: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d',
      overlap: 100.00,
      volume: 104325753,
      evidence: '100% overlap, 27,235 shared txs'
    }
  ];

  for (const mapping of mappings) {
    console.log(`Wallet #${mapping.num}: Adding mapping...`);
    console.log(`  Executor:  ${mapping.executor}`);
    console.log(`  Account:   ${trueAccount} (same as XCN)`);
    console.log(`  Volume:    $${mapping.volume.toLocaleString()}`);
    console.log(`  Evidence:  ${mapping.evidence}`);
    console.log('');

    const query = `
INSERT INTO wallet_identity_overrides VALUES (
  '${mapping.executor.toLowerCase()}',  -- Executor
  '${trueAccount}',                       -- True Account (XCN account)
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
`;

    try {
      await clickhouse.query({ query });
      console.log(`  ✅ Mapping added successfully`);
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }

    console.log('');
  }

  // Verify all mappings
  console.log('═'.repeat(80));
  console.log('VERIFICATION - ALL MAPPINGS');
  console.log('═'.repeat(80));
  console.log('');

  const selectQuery = 'SELECT * FROM wallet_identity_overrides ORDER BY created_at';
  const selectResult = await clickhouse.query({ query: selectQuery, format: 'JSONEachRow' });
  const allMappings = await selectResult.json() as any[];

  console.log(`Total Mappings: ${allMappings.length}`);
  console.log('');

  let totalVolume = 0;
  for (let i = 0; i < allMappings.length; i++) {
    const m = allMappings[i];
    console.log(`Mapping #${i + 1}:`);
    console.log(`  Executor: ${m.executor_wallet}`);
    console.log(`  Account:  ${m.canonical_wallet}`);
    console.log(`  Source:   ${m.source}`);
    console.log('');

    // Find volume for this executor
    const found = mappings.find(mapping => mapping.executor.toLowerCase() === m.executor_wallet.toLowerCase());
    if (found) {
      totalVolume += found.volume;
    } else if (m.executor_wallet === '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e') {
      // XCN wallet #1
      totalVolume += 5803541019;
    }
  }

  console.log('═'.repeat(80));
  console.log('MULTI-PROXY CLUSTER SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Account Wallet:       ${trueAccount}`);
  console.log(`Mapped Executors:     ${allMappings.length}`);
  console.log(`Combined Volume:      $${totalVolume.toLocaleString()}`);
  console.log(`Coverage:             ${((totalVolume / 10400000000) * 100).toFixed(2)}% of top 100 collision wallets`);
  console.log('');
  console.log('Executor Wallets:');
  console.log('─'.repeat(80));

  // List all executors
  const walletDetails = [
    { num: 1, addr: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', volume: 5803541019 },
    { num: 2, addr: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', volume: 307806466 },
    { num: 5, addr: '0xee00ba338c59557141789b127927a55f5cc5cea1', volume: 110633603 },
    { num: 6, addr: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', volume: 104325753 }
  ];

  for (const w of walletDetails) {
    const shortAddr = `${w.addr.substring(0, 10)}...${w.addr.substring(34)}`;
    const vol = '$' + w.volume.toLocaleString().padStart(15);
    console.log(`  Wallet #${w.num}: ${shortAddr} ${vol}`);
  }

  console.log('');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
