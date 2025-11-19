#!/usr/bin/env tsx
/**
 * Discover all wallets that traded the 6 ghost markets
 * by checking ERC1155 transfer events
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const GHOST_MARKETS = [
  {
    condition_id: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    question: 'Xi Jinping out in 2025?'
  },
  {
    condition_id: 'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    question: 'Will Trump sell over 100k Gold Cards in 2025?'
  },
  {
    condition_id: 'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    question: 'Will Elon cut the budget by at least 10% in 2025?'
  },
  {
    condition_id: '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    question: 'Will Satoshi move any Bitcoin in 2025?'
  },
  {
    condition_id: 'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
    question: 'Will China unban Bitcoin in 2025?'
  },
  {
    condition_id: 'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    question: 'Will a US ally get a nuke in 2025?'
  }
];

async function main() {
  console.log('═'.repeat(80));
  console.log('Ghost Market Wallet Discovery via ERC1155 Transfers');
  console.log('═'.repeat(80));
  console.log('');

  const allWallets = new Set<string>();

  for (const market of GHOST_MARKETS) {
    console.log('─'.repeat(80));
    console.log(`Market: ${market.question}`);
    console.log(`Condition ID: ${market.condition_id.substring(0, 32)}...`);
    console.log('─'.repeat(80));

    const result = await clickhouse.query({
      query: `
        SELECT DISTINCT
          from_address,
          to_address
        FROM pm_erc1155_transfers
        WHERE condition_id = '${market.condition_id}'
        LIMIT 1000
      `,
      format: 'JSONEachRow'
    });

    const rows: any[] = await result.json();
    const wallets = new Set<string>();

    rows.forEach(row => {
      // Add from_address if not zero address
      if (row.from_address && row.from_address !== '0000000000000000000000000000000000000000') {
        wallets.add(row.from_address);
        allWallets.add(row.from_address);
      }
      // Add to_address if not zero address
      if (row.to_address && row.to_address !== '0000000000000000000000000000000000000000') {
        wallets.add(row.to_address);
        allWallets.add(row.to_address);
      }
    });

    console.log(`  ERC1155 transfers found: ${rows.length}`);
    console.log(`  Unique wallets: ${wallets.size}`);

    if (wallets.size > 0) {
      console.log(`  Wallets:`);
      const walletArray = Array.from(wallets);
      walletArray.slice(0, 10).forEach(w => console.log(`    0x${w}`));
      if (walletArray.length > 10) {
        console.log(`    ... and ${walletArray.length - 10} more`);
      }
    } else {
      console.log(`  ⚠️  No ERC1155 transfers found for this market`);
    }
    console.log('');
  }

  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Total unique wallets across all 6 ghost markets: ${allWallets.size}`);
  console.log('');

  if (allWallets.size > 0) {
    console.log('All unique wallets:');
    Array.from(allWallets).forEach(w => console.log(`  0x${w}`));
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
