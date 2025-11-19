#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

// Phase B: Check existing wallet_identity_map for collision wallet coverage

async function main() {
  console.log('═'.repeat(80));
  console.log('PHASE B: ANALYZE WALLET_IDENTITY_MAP COVERAGE');
  console.log('═'.repeat(80));
  console.log('');

  try {
    // Load top 100 collision wallets
    const collisionWalletsPath = resolve(process.cwd(), 'collision-wallets-top100.json');
    const collisionWallets = JSON.parse(fs.readFileSync(collisionWalletsPath, 'utf-8'));

    console.log(`Loaded ${collisionWallets.length} collision wallets from file`);
    console.log('');

    // Check if these wallets exist in wallet_identity_map
    const walletAddresses = collisionWallets.map((w: any) => w.wallet);

    const query = `
      SELECT
        lower(proxy_wallet) AS proxy,
        lower(user_eoa) AS account,
        lower(canonical_wallet) AS canonical,
        source
      FROM wallet_identity_map
      WHERE proxy_wallet IN (${walletAddresses.map((w: string) => `'${w}'`).join(',')})
        AND proxy_wallet != user_eoa
      ORDER BY proxy_wallet
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const mappings = await result.json() as any[];

    console.log('EXISTING MAPPINGS IN WALLET_IDENTITY_MAP:');
    console.log('─'.repeat(80));
    console.log('');

    if (mappings.length === 0) {
      console.log('⚠️  NO EXISTING MAPPINGS FOUND for top 100 collision wallets');
      console.log('');
      console.log('This means:');
      console.log('  • wallet_identity_map does not have executor→account mappings for these wallets');
      console.log('  • We need to discover mappings using ERC20 flow analysis + tx overlap');
      console.log('  • XCN mapping (0x4bfb...982e → 0xcce2...d58b) was added to wallet_identity_overrides');
      console.log('');
    } else {
      console.log(`Found ${mappings.length} existing mappings:`);
      console.log('');
      console.log('Proxy (Executor)                            → Account (EOA)                            Source');
      console.log('─'.repeat(100));

      for (const m of mappings) {
        console.log(`${m.proxy.padEnd(42)} → ${(m.account || m.canonical).padEnd(42)} ${m.source}`);
      }

      console.log('');
      console.log('COVERAGE ANALYSIS:');
      console.log('─'.repeat(80));
      console.log(`  Total Collision Wallets:     ${collisionWallets.length}`);
      console.log(`  Existing Mappings:           ${mappings.length}`);
      console.log(`  Unmapped (Need Discovery):   ${collisionWallets.length - mappings.length}`);
      console.log('');

      // Calculate volume coverage
      const mappedWallets = new Set(mappings.map((m: any) => m.proxy));
      let mappedVolume = 0;
      let totalVolume = 0;

      for (const cw of collisionWallets) {
        const volume = parseFloat(cw.total_volume_usd);
        totalVolume += volume;
        if (mappedWallets.has(cw.wallet.toLowerCase())) {
          mappedVolume += volume;
        }
      }

      console.log('VOLUME COVERAGE:');
      console.log('─'.repeat(80));
      console.log(`  Mapped Volume:               $${mappedVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`  Total Volume (Top 100):      $${totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`  Coverage Rate:               ${(mappedVolume / totalVolume * 100).toFixed(2)}%`);
      console.log('');

      // Save mappings for next phase
      const outputPath = resolve(process.cwd(), 'existing-mappings.json');
      fs.writeFileSync(outputPath, JSON.stringify(mappings, null, 2));
      console.log(`✅ Existing mappings saved to: existing-mappings.json`);
      console.log('');
    }

    console.log('NEXT STEPS:');
    console.log('─'.repeat(80));
    console.log('1. For unmapped wallets, use ERC20 flow analysis to find account wallets');
    console.log('2. Validate via transaction hash overlap (>95% threshold)');
    console.log('3. Add validated mappings to wallet_identity_overrides');
    console.log('4. Prioritize by volume (highest impact first)');
    console.log('');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
