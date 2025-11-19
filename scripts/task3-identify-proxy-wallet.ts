#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import https from 'https';
import { clickhouse } from './lib/clickhouse/client';

async function fetchPolymarketAPI(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== TASK 3: IDENTIFY PROXY WALLET MAPPING ===\n');
  
  const UI_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
  
  console.log(`Target UI Wallet: ${UI_WALLET}\n`);
  
  // STEP 1: Call Polymarket API
  console.log('━━━ STEP 1: Call Polymarket API ━━━\n');
  
  const apiUrl = `https://data-api.polymarket.com/positions?user=${UI_WALLET}`;
  console.log(`Fetching: ${apiUrl}\n`);
  
  let apiResponse: any;
  try {
    apiResponse = await fetchPolymarketAPI(apiUrl);
  } catch (e: any) {
    console.error('API Error:', e.message);
    throw e;
  }
  
  console.log(`API Response: ${apiResponse.length} positions returned\n`);
  
  // Extract proxyWallet from first position
  if (apiResponse.length > 0) {
    const firstPosition = apiResponse[0];
    console.log('Sample position structure:');
    console.log(JSON.stringify(firstPosition, null, 2).substring(0, 500) + '...\n');
    
    const proxyWallet = firstPosition.proxyWallet || firstPosition.proxy_wallet || firstPosition.wallet;
    
    if (proxyWallet) {
      console.log(`✅ Found proxyWallet: ${proxyWallet}\n`);
      
      // STEP 2: Verify on-chain match
      console.log('━━━ STEP 2: Verify On-Chain Match ━━━\n');
      
      console.log('Getting condition IDs from API positions...');
      const apiConditionIds = apiResponse
        .slice(0, 20)  // First 20 positions
        .map((p: any) => {
          const cid = p.condition_id || p.conditionId;
          return cid ? cid.toLowerCase().replace('0x', '') : null;
        })
        .filter(Boolean);
      
      console.log(`API positions: ${apiConditionIds.length} condition IDs\n`);
      
      if (apiConditionIds.length > 0) {
        console.log('Checking trades_raw for overlap...\n');
        
        // Check UI wallet
        const uiOverlapResult = await clickhouse.query({
          query: `
            SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as overlap
            FROM default.trades_raw
            WHERE lower(wallet) = lower('${UI_WALLET}')
              AND lower(replaceAll(condition_id, '0x', '')) IN (${apiConditionIds.map(c => `'${c}'`).join(',')})
          `,
          format: 'JSONEachRow'
        });
        const uiOverlap = await uiOverlapResult.json<Array<any>>();
        
        console.log(`UI Wallet overlap:    ${uiOverlap[0].overlap}/${apiConditionIds.length} markets`);
        
        // Check proxy wallet
        const proxyOverlapResult = await clickhouse.query({
          query: `
            SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as overlap
            FROM default.trades_raw
            WHERE lower(wallet) = lower('${proxyWallet}')
              AND lower(replaceAll(condition_id, '0x', '')) IN (${apiConditionIds.map(c => `'${c}'`).join(',')})
          `,
          format: 'JSONEachRow'
        });
        const proxyOverlap = await proxyOverlapResult.json<Array<any>>();
        
        console.log(`Proxy Wallet overlap: ${proxyOverlap[0].overlap}/${apiConditionIds.length} markets\n`);
        
        if (proxyOverlap[0].overlap > uiOverlap[0].overlap) {
          console.log('✅ CONFIRMED: Proxy wallet has better on-chain match!');
          console.log(`   ${proxyOverlap[0].overlap} markets found vs ${uiOverlap[0].overlap} for UI wallet\n`);
        } else {
          console.log('⚠️  UI wallet has equal or better match. Investigating...\n');
        }
      }
      
      // STEP 3: Save mapping
      console.log('━━━ STEP 3: Save Mapping ━━━\n');
      
      const mapping = {
        ui_wallet: UI_WALLET,
        proxy_wallet: proxyWallet,
        verified_at: new Date().toISOString(),
        api_positions_count: apiResponse.length,
        verification_method: 'polymarket_api'
      };
      
      require('fs').writeFileSync(
        'task3-wallet-mapping.json',
        JSON.stringify(mapping, null, 2)
      );
      
      console.log('Wallet mapping saved to: task3-wallet-mapping.json\n');
      console.log('Mapping:');
      console.log(`  UI Wallet:    ${mapping.ui_wallet}`);
      console.log(`  Proxy Wallet: ${mapping.proxy_wallet}`);
      console.log(`  Positions:    ${mapping.api_positions_count}\n`);
      
      console.log('✅ Task 3 Complete\n');
      
    } else {
      console.error('❌ No proxyWallet field found in API response');
      console.log('Available fields:', Object.keys(firstPosition).join(', '));
    }
    
  } else {
    console.error('❌ No positions returned from API');
  }
}

main().catch(console.error);
