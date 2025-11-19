#!/usr/bin/env tsx
/**
 * Identify which of the 70 delta tokens belong to the 6 ghost markets
 *
 * Since the 6 ghost markets have no ctf_token_map entries, we need to derive
 * their token_ids mathematically: keccak256(condition_id, outcome_index)
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { keccak256 } from 'ethers';

const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XCN_PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// 6 ghost markets (without 0x prefix for hashing)
const GHOST_MARKETS = [
  { cid: '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678', name: 'Satoshi Bitcoin 2025' },
  { cid: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1', name: 'Xi Jinping 2025' },
  { cid: 'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608', name: 'Trump Gold Cards' },
  { cid: 'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be', name: 'Elon Budget Cut' },
  { cid: 'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44', name: 'US Ally Nuke 2025' },
  { cid: 'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7', name: 'China Bitcoin Unban' }
];

async function main() {
  console.log('Ghost Market Token ID Derivation');
  console.log('='.repeat(80));
  console.log('');
  console.log('Deriving token_ids for ghost markets using keccak256(condition_id, outcome_index)');
  console.log('');

  // Get all 70 delta tokens from blockchain
  const deltaTokensQuery = `
    WITH blockchain AS (
      SELECT
        token_id,
        reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))) as decimal_id
      FROM erc1155_transfers
      WHERE lower(from_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(to_address) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
      GROUP BY token_id
    ),
    clob AS (
      SELECT toUInt256(asset_id) as decimal_id
      FROM clob_fills
      WHERE lower(proxy_wallet) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
         OR lower(user_eoa) IN ('${XCN_EOA.toLowerCase()}', '${XCN_PROXY.toLowerCase()}')
      GROUP BY asset_id
    )
    SELECT b.token_id
    FROM blockchain b
    LEFT JOIN clob c ON b.decimal_id = c.decimal_id
    WHERE c.decimal_id IS NULL
    ORDER BY b.token_id
  `;

  const deltaResult = await clickhouse.query({ query: deltaTokensQuery });
  const deltaData = await deltaResult.json();
  const deltaTokens = new Set((deltaData.data || []).map((r: any) => r.token_id.toLowerCase()));

  console.log(`Total delta tokens (blockchain only): ${deltaTokens.size}`);
  console.log('');

  // For each ghost market, derive token_ids for outcome indices 0 and 1 (binary markets)
  console.log('Checking if ghost market tokens exist in blockchain delta:');
  console.log('');

  let foundCount = 0;
  const foundMarkets: any[] = [];

  for (const market of GHOST_MARKETS) {
    console.log(`${market.name}`);
    console.log(`  Condition ID: ${market.cid}`);

    // Binary markets have 2 outcomes (indices 0 and 1)
    // Token ID = keccak256(abi.encodePacked(condition_id, outcome_index))

    for (let outcomeIndex = 0; outcomeIndex <= 1; outcomeIndex++) {
      // Encode as: condition_id (32 bytes) + outcome_index (32 bytes as uint256)
      const conditionIdHex = market.cid;
      const outcomeIndexHex = outcomeIndex.toString(16).padStart(64, '0');
      const combined = `0x${conditionIdHex}${outcomeIndexHex}`;

      // Hash to get token_id
      const tokenId = keccak256(combined).toLowerCase();

      // Check if this token_id exists in delta
      if (deltaTokens.has(tokenId)) {
        console.log(`  ✅ Outcome ${outcomeIndex}: ${tokenId} FOUND in blockchain!`);
        foundCount++;

        if (!foundMarkets.some(m => m.cid === market.cid)) {
          foundMarkets.push(market);
        }
      } else {
        console.log(`  ❌ Outcome ${outcomeIndex}: ${tokenId} not found`);
      }
    }

    console.log('');
  }

  console.log('='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Ghost markets found in blockchain delta: ${foundMarkets.length}/6`);
  console.log(`Total token_ids matched: ${foundCount}`);
  console.log('');

  if (foundMarkets.length > 0) {
    console.log('✅ SUCCESS! Ghost markets ARE in blockchain data!');
    console.log('');
    console.log('Found markets:');
    for (const m of foundMarkets) {
      console.log(`  - ${m.name}`);
    }
    console.log('');
    console.log('This proves:');
    console.log('1. The blockchain has AMM trade data for ghost markets');
    console.log('2. We can extract these trades from erc1155_transfers');
    console.log('3. No external API needed - data is already in our database!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Build ERC1155 → trades transformation for these 70 delta tokens');
    console.log('2. Insert into pm_trades');
    console.log('3. Recompute P&L');
    console.log('4. Validate against Dome');
  } else {
    console.log('⚠️  None of the ghost markets found in blockchain delta');
    console.log('');
    console.log('Possible reasons:');
    console.log('1. Token ID derivation formula is incorrect');
    console.log('2. Ghost markets use different outcome index encoding');
    console.log('3. Ghost markets are truly not in our blockchain data');
    console.log('');
    console.log('Need to verify token ID encoding with Polymarket contracts.');
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
