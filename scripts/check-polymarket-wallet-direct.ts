#!/usr/bin/env npx tsx
/**
 * Check what Polymarket actually shows for this wallet
 *
 * Queries the Polymarket API to see the wallet's actual P&L and positions
 */

const AUDIT_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function checkWalletOnPolymarket() {
  try {
    console.log('\n═══════════════════════════════════════════════════════════════════════════════');
    console.log('CHECKING POLYMARKET API FOR WALLET');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');
    console.log(`Wallet: ${AUDIT_WALLET}\n`);

    // Try the Gamma API user endpoint
    console.log('Querying Gamma API for user data...\n');

    const response = await fetch(`https://gamma-api.polymarket.com/users/${AUDIT_WALLET}`);

    if (!response.ok) {
      console.log(`❌ API returned ${response.status}`);
      console.log('Response:', await response.text());
      return;
    }

    const data = await response.json();

    console.log('═'.repeat(80));
    console.log('USER DATA FROM POLYMARKET');
    console.log('═'.repeat(80));
    console.log('');

    if (data.totalPnl !== undefined) {
      console.log(`Total P&L: $${parseFloat(data.totalPnl).toLocaleString()}`);
    }

    if (data.volumeTraded !== undefined) {
      console.log(`Volume Traded: $${parseFloat(data.volumeTraded).toLocaleString()}`);
    }

    if (data.marketsTraded !== undefined) {
      console.log(`Markets Traded: ${data.marketsTraded}`);
    }

    if (data.positionsCount !== undefined) {
      console.log(`Open Positions: ${data.positionsCount}`);
    }

    console.log('');
    console.log('Full response:', JSON.stringify(data, null, 2).substring(0, 1000));

  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

async function main() {
  await checkWalletOnPolymarket();

  console.log('\n═'.repeat(80));
  console.log('NEXT STEPS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('If Polymarket API shows $332K but we show -$546, then:');
  console.log('');
  console.log('1. The $332K is UNREALIZED P&L (positions not yet resolved)');
  console.log('2. Our system correctly shows $0 for SETTLED P&L (no resolved positions)');
  console.log('3. To match Polymarket, we need to:');
  console.log('   - Backfill midprices for open positions');
  console.log('   - Show unrealized P&L in the UI');
  console.log('   - Make it clear which is settled vs unrealized');
  console.log('');
}

main().catch(console.error);
