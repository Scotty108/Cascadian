#!/usr/bin/env npx tsx
/**
 * API Test Harness: Test third-party Polymarket data sources
 * to see if they expose resolution data we're missing
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Test wallets
const TEST_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad', // $332K
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // $114K
  '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', // $101K
];

interface WalletPnL {
  wallet: string;
  total_gains: number;
  total_losses: number;
  pnl: number;
  win_rate: number;
  source: string;
}

async function testPolymarketAnalytics(wallet: string): Promise<WalletPnL | null> {
  console.log(`\n🔍 Testing polymarketanalytics.com for ${wallet.substring(0, 10)}...`);
  
  try {
    // Try various possible endpoints
    const possibleUrls = [
      `https://api.polymarketanalytics.com/wallet/${wallet}`,
      `https://polymarketanalytics.com/api/wallet/${wallet}`,
      `https://api.polymarketanalytics.com/v1/wallet/${wallet}`,
    ];

    for (const url of possibleUrls) {
      try {
        console.log(`  Trying: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`  ✅ Success! Response:`, JSON.stringify(data).substring(0, 200));
          
          // Try to parse P&L data
          return {
            wallet,
            total_gains: data.total_gains || data.totalGains || data.gains || 0,
            total_losses: data.total_losses || data.totalLosses || data.losses || 0,
            pnl: data.pnl || data.profit_loss || 0,
            win_rate: data.win_rate || data.winRate || 0,
            source: 'polymarketanalytics.com',
          };
        }
      } catch (e) {
        // Try next URL
      }
    }
    
    console.log(`  ❌ No working endpoint found`);
    return null;
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function testHashDive(wallet: string): Promise<WalletPnL | null> {
  console.log(`\n🔍 Testing hashdive.com for ${wallet.substring(0, 10)}...`);
  
  try {
    const possibleUrls = [
      `https://api.hashdive.com/polymarket/wallet/${wallet}`,
      `https://hashdive.com/api/polymarket/wallet/${wallet}`,
      `https://api.hashdive.com/v1/polymarket/wallet/${wallet}`,
    ];

    for (const url of possibleUrls) {
      try {
        console.log(`  Trying: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`  ✅ Success! Response:`, JSON.stringify(data).substring(0, 200));
          
          return {
            wallet,
            total_gains: data.total_gains || data.totalGains || 0,
            total_losses: data.total_losses || data.totalLosses || 0,
            pnl: data.pnl || data.net_pnl || 0,
            win_rate: data.win_rate || data.winRate || 0,
            source: 'hashdive.com',
          };
        }
      } catch (e) {
        // Try next URL
      }
    }
    
    console.log(`  ❌ No working endpoint found`);
    return null;
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function testPolysites(wallet: string): Promise<WalletPnL | null> {
  console.log(`\n🔍 Testing polysites.xyz for ${wallet.substring(0, 10)}...`);
  
  try {
    const possibleUrls = [
      `https://api.polysites.xyz/wallet/${wallet}`,
      `https://polysites.xyz/api/wallet/${wallet}`,
      `https://api.polysites.xyz/v1/wallet/${wallet}`,
    ];

    for (const url of possibleUrls) {
      try {
        console.log(`  Trying: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            'Accept': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log(`  ✅ Success! Response:`, JSON.stringify(data).substring(0, 200));
          
          return {
            wallet,
            total_gains: data.total_gains || data.totalGains || 0,
            total_losses: data.total_losses || data.totalLosses || 0,
            pnl: data.pnl || data.profit || 0,
            win_rate: data.win_rate || data.winRate || 0,
            source: 'polysites.xyz',
          };
        }
      } catch (e) {
        // Try next URL
      }
    }
    
    console.log(`  ❌ No working endpoint found`);
    return null;
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function getOurPnL(wallet: string) {
  console.log(`\n📊 Querying our database for ${wallet.substring(0, 10)}...`);
  
  try {
    const result = await ch.query({
      query: `
        SELECT
          lower(wallet_address_norm) as wallet,
          sum(pnl_closed) as closed_pnl,
          sum(pnl_all) as all_pnl,
          sum(pnl_settled) as settled_pnl,
          count(*) as position_count
        FROM cascadian_clean.vw_wallet_pnl_all
        WHERE lower(wallet_address_norm) = lower('${wallet}')
        GROUP BY wallet
      `,
      format: 'JSONEachRow',
    });
    
    const data = await result.json<any[]>();
    
    if (data.length > 0) {
      console.log(`  ✅ Found data:`, data[0]);
      return data[0];
    } else {
      console.log(`  ❌ No data found`);
      return null;
    }
  } catch (error: any) {
    console.log(`  ❌ Error: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('THIRD-PARTY API TEST: Finding Resolution Data Sources');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  
  for (const wallet of TEST_WALLETS) {
    console.log(`\n\n${'='.repeat(80)}`);
    console.log(`TESTING WALLET: ${wallet}`);
    console.log('='.repeat(80));
    
    // Test each third-party source
    const polymarketAnalytics = await testPolymarketAnalytics(wallet);
    const hashDive = await testHashDive(wallet);
    const polysites = await testPolysites(wallet);
    
    // Get our data
    const ourData = await getOurPnL(wallet);
    
    // Summary
    console.log(`\n${'─'.repeat(80)}`);
    console.log('COMPARISON SUMMARY');
    console.log('─'.repeat(80));
    
    console.log(`\nExpected (from your list):`);
    if (wallet === '0x4ce73141dbfce41e65db3723e31059a730f0abad') {
      console.log(`  P&L: $332,563`);
      console.log(`  Gains: $333,508`);
      console.log(`  Losses: $945`);
    }
    
    console.log(`\nThird-party results:`);
    if (polymarketAnalytics) {
      console.log(`  polymarketanalytics.com: P&L $${polymarketAnalytics.pnl.toLocaleString()}`);
    }
    if (hashDive) {
      console.log(`  hashdive.com: P&L $${hashDive.pnl.toLocaleString()}`);
    }
    if (polysites) {
      console.log(`  polysites.xyz: P&L $${polysites.pnl.toLocaleString()}`);
    }
    
    console.log(`\nOur database:`);
    if (ourData) {
      console.log(`  Closed P&L: $${parseFloat(ourData.closed_pnl).toLocaleString()}`);
      console.log(`  All P&L: $${parseFloat(ourData.all_pnl).toLocaleString()}`);
      console.log(`  Settled P&L: $${parseFloat(ourData.settled_pnl).toLocaleString()}`);
    } else {
      console.log(`  ❌ No data`);
    }
    
    // Identify gaps
    const hasThirdPartyData = polymarketAnalytics || hashDive || polysites;
    if (hasThirdPartyData && (!ourData || parseFloat(ourData.settled_pnl) === 0)) {
      console.log(`\n🚨 GAP IDENTIFIED: Third-party has data, we don't!`);
      console.log(`   Next step: Reverse-engineer how they're getting it`);
    }
  }
  
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log(`\n1. If any API returned data: reverse-engineer their source`);
  console.log(`2. Try scraping their UI to see what they display`);
  console.log(`3. Check browser DevTools on their sites for API calls`);
  console.log(`4. Look for GraphQL endpoints or WebSocket connections`);
  
  await ch.close();
}

main().catch((err) => {
  console.error('\n❌ ERROR:', err);
  process.exit(1);
});
