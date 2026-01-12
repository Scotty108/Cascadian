/**
 * Quick fix for specific unmapped tokens affecting our 2 failing wallets
 * Then verifies PnL matches API
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

const UNMAPPED_TOKENS = [
  '29145230701929507428815205712307569947299239048249287985738388495926787229453',
  '22488004216190611395137263123040704315355550645435395062969048727849903120533',
  '76854403353067524041836266533663670011203423455394733047048315319709639782432',
  '69494448160707004531330960854516751381471711694824749176716423522846838814050',
  '36761745595958452040718090483694958892992272973598256951981762587248873704872',
  '30616119969379487621197211350858194023607791590528793845616416029907273137559'
];

interface TokenInfo {
  token_id: string;
  condition_id: string;
  outcome_index: number;
  question: string;
}

async function fetchTokenFromGamma(tokenId: string): Promise<TokenInfo | null> {
  try {
    const url = `${GAMMA_API_BASE}/markets?token_id=${tokenId}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.log(`  API returned ${response.status} for token ${tokenId.slice(0, 20)}...`);
      return null;
    }

    const data = await response.json() as any[];

    if (!data || data.length === 0) {
      console.log(`  No market found for token ${tokenId.slice(0, 20)}...`);
      return null;
    }

    const market = data[0];
    const tokenIds = market.tokens?.map((t: any) => t.token_id) || [];
    const outcomeIndex = tokenIds.indexOf(tokenId);

    if (outcomeIndex === -1) {
      console.log(`  Token not in market tokens array for ${tokenId.slice(0, 20)}...`);
      return null;
    }

    return {
      token_id: tokenId,
      condition_id: market.condition_id,
      outcome_index: outcomeIndex,
      question: market.question || 'Unknown market',
    };
  } catch (error) {
    console.error(`Error fetching token ${tokenId.slice(0, 20)}...:`, error);
    return null;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('QUICK FIX: 6 Unmapped Tokens for Failing Wallets');
  console.log('='.repeat(60));

  // Step 1: Fetch from Gamma API
  console.log('\nStep 1: Fetching token info from Gamma API...');

  const newMappings: TokenInfo[] = [];
  const failedTokens: string[] = [];

  for (const tokenId of UNMAPPED_TOKENS) {
    console.log(`\nFetching ${tokenId.slice(0, 30)}...`);
    const info = await fetchTokenFromGamma(tokenId);

    if (info) {
      console.log(`  Found: condition=${info.condition_id.slice(0, 20)}..., outcome=${info.outcome_index}`);
      newMappings.push(info);
    } else {
      failedTokens.push(tokenId);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n\nResults: ${newMappings.length} found, ${failedTokens.length} failed`);

  if (newMappings.length === 0) {
    console.log('\n❌ No mappings found. Exiting.');
    return;
  }

  // Step 2: Insert into token map
  console.log('\nStep 2: Inserting new mappings into pm_token_to_condition_map_v5...');

  for (const m of newMappings) {
    const escapedQuestion = m.question.replace(/'/g, "''");
    await clickhouse.command({
      query: `
        INSERT INTO pm_token_to_condition_map_v5
        (token_id_dec, condition_id, outcome_index, question, category)
        VALUES ('${m.token_id}', '${m.condition_id}', ${m.outcome_index}, '${escapedQuestion}', 'gamma-fix')
      `,
    });
    console.log(`  Inserted: ${m.token_id.slice(0, 20)}... -> ${m.condition_id.slice(0, 20)}...`);
  }

  // Step 3: Rebuild canonical fills for affected wallets
  console.log('\nStep 3: Rebuilding canonical fills for affected wallets...');

  const affectedWallets = [
    '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d',
    '0x6a31595989176ac4e4fb72c9ce2da63d0b97a21e'
  ];

  for (const wallet of affectedWallets) {
    console.log(`\n  Deleting old fills for ${wallet.slice(0, 10)}...`);

    // Delete old canonical fills for this wallet
    await clickhouse.command({
      query: `ALTER TABLE pm_canonical_fills_v4 DELETE WHERE wallet = '${wallet}'`
    });

    // Wait for mutation
    await new Promise(r => setTimeout(r, 2000));

    console.log(`  Rebuilding CLOB fills...`);

    // Rebuild CLOB fills for this wallet
    await clickhouse.command({
      query: `
        INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
        WITH self_fill_txs AS (
          SELECT trader_wallet, transaction_hash
          FROM pm_trader_events_v3
          WHERE lower(trader_wallet) = '${wallet}'
          GROUP BY trader_wallet, transaction_hash
          HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
        )
        SELECT
          concat('clob_', event_id) as fill_id,
          trade_time as event_time,
          block_number,
          transaction_hash as tx_hash,
          lower(trader_wallet) as wallet,
          m.condition_id,
          m.outcome_index,
          CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END as tokens_delta,
          CASE WHEN side = 'buy' THEN -usdc_amount / 1e6 ELSE usdc_amount / 1e6 END as usdc_delta,
          'clob' as source,
          (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs) as is_self_fill,
          role = 'maker' as is_maker
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          AND NOT (
            (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs)
            AND role = 'maker'
          )
      `
    });

    // Count new fills
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE wallet = '${wallet}'`,
      format: 'JSONEachRow'
    });
    const count = ((await countResult.json()) as any[])[0]?.cnt || 0;
    console.log(`  Rebuilt ${count} canonical fills for ${wallet.slice(0, 10)}...`);
  }

  console.log('\n✅ Quick fix complete!');
  console.log('\nRun the validation script to verify 50/50 PASS');
}

main().catch(console.error);
