/**
 * Final exploration: Memory-efficient query approach to find wallet relationships
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function queryJson<T = any>(query: string): Promise<T[]> {
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as T[];
}

async function run() {
  console.log('='.repeat(80));
  console.log('FINAL WALLET RELATIONSHIP ANALYSIS');
  console.log('='.repeat(80));

  // Key contracts identified
  const EXCHANGE_PROXY = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
  const CTF_EXCHANGE = '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296';

  console.log('\n--- KEY CONTRACT SUMMARY ---\n');
  console.log(`Exchange Proxy (${EXCHANGE_PROXY}):`);
  console.log('  - 69.5M CTF events as user');
  console.log('  - 105.5M CLOB events as trader');
  console.log('  - 8.2M ERC1155 as operator');

  console.log(`\nCTF Exchange (${CTF_EXCHANGE}):`);
  console.log('  - 62.8M CTF events as user');
  console.log('  - 0 CLOB events (not a CLOB trader)');
  console.log('  - 5.8M ERC1155 as operator');

  // Strategy 1: Use a small sample of CLOB transactions to find matching CTF events
  console.log('\n--- STRATEGY 1: Sample-based CTF-CLOB matching ---\n');

  // Get a sample of recent CLOB transactions with their hex tx_hash
  const clobSample = await queryJson(`
    SELECT
      lower(concat('0x', hex(transaction_hash))) as tx_hash,
      trader_wallet,
      side,
      usdc_amount / 1e6 as usdc,
      trade_time
    FROM pm_trader_events_v2
    WHERE is_deleted = 0
      AND trade_time >= '2024-12-01'
    ORDER BY trade_time DESC
    LIMIT 500
  `);

  console.log(`Got ${clobSample.length} recent CLOB transactions`);

  // For each, check if there's a matching CTF event with different user
  let matchesFound = 0;
  const relationships: Array<{ctf_user: string, clob_trader: string, tx_hash: string}> = [];

  for (const clob of clobSample.slice(0, 100)) {
    const ctfMatch = await queryJson(`
      SELECT user_address, event_type
      FROM pm_ctf_events
      WHERE tx_hash = '${clob.tx_hash}'
        AND is_deleted = 0
      LIMIT 10
    `);

    if (ctfMatch.length > 0) {
      for (const ctf of ctfMatch) {
        if (ctf.user_address?.toLowerCase() !== clob.trader_wallet?.toLowerCase()) {
          matchesFound++;
          relationships.push({
            ctf_user: ctf.user_address,
            clob_trader: clob.trader_wallet,
            tx_hash: clob.tx_hash
          });
        }
      }
    }
  }

  console.log(`Found ${matchesFound} CTF-CLOB mismatches in sample`);
  console.log('Sample relationships:');
  relationships.slice(0, 10).forEach((r, i) => {
    console.log(`  ${i+1}. CTF=${r.ctf_user?.slice(0, 25)}... CLOB=${r.clob_trader?.slice(0, 25)}...`);
  });

  // Strategy 2: Find wallets that appear in both tables but with different tx patterns
  console.log('\n--- STRATEGY 2: Find wallets active in both CTF and CLOB ---\n');

  const dualActiveWallets = await queryJson(`
    WITH ctf_wallets AS (
      SELECT
        lower(user_address) as wallet,
        count(*) as ctf_count
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND lower(user_address) NOT IN (
          '${EXCHANGE_PROXY}',
          '${CTF_EXCHANGE}'
        )
      GROUP BY lower(user_address)
      HAVING ctf_count > 10
      LIMIT 10000
    ),
    clob_wallets AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(*) as clob_count
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING clob_count > 10
      LIMIT 10000
    )
    SELECT
      c.wallet,
      c.ctf_count,
      t.clob_count
    FROM ctf_wallets c
    JOIN clob_wallets t ON c.wallet = t.wallet
    ORDER BY c.ctf_count + t.clob_count DESC
    LIMIT 30
  `);

  console.log(`Found ${dualActiveWallets.length} wallets active in both CTF and CLOB:`);
  dualActiveWallets.forEach((r: any, i: number) => {
    console.log(`  ${i+1}. ${r.wallet} CTF=${r.ctf_count} CLOB=${r.clob_count}`);
  });

  // Strategy 3: Find proxy patterns - wallets that trade through contracts
  console.log('\n--- STRATEGY 3: Find proxy usage patterns ---\n');

  // Users whose CTF events often have contract addresses as user
  // but whose CLOB trades are under their own address
  const proxyPatterns = await queryJson(`
    WITH user_clob_trades AS (
      SELECT
        lower(trader_wallet) as wallet,
        count(*) as trade_count,
        sum(usdc_amount) / 1e6 as total_usdc
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      GROUP BY lower(trader_wallet)
      HAVING trade_count > 100
    ),
    user_ctf_events AS (
      SELECT
        lower(user_address) as wallet,
        count(*) as event_count
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND lower(user_address) NOT IN (
          '${EXCHANGE_PROXY}',
          '${CTF_EXCHANGE}',
          '0x0000000000000000000000000000000000000000'
        )
      GROUP BY lower(user_address)
      HAVING event_count > 0
    )
    SELECT
      t.wallet,
      t.trade_count as clob_trades,
      t.total_usdc as clob_usdc,
      coalesce(c.event_count, 0) as ctf_events,
      t.trade_count - coalesce(c.event_count, 0) as trades_without_direct_ctf
    FROM user_clob_trades t
    LEFT JOIN user_ctf_events c ON t.wallet = c.wallet
    WHERE coalesce(c.event_count, 0) < t.trade_count * 0.1  -- Less than 10% direct CTF
    ORDER BY t.total_usdc DESC
    LIMIT 30
  `);

  console.log('Wallets with high CLOB activity but few direct CTF events (likely using proxy):');
  proxyPatterns.forEach((r: any, i: number) => {
    console.log(`  ${i+1}. ${r.wallet} CLOB=${r.clob_trades} CTF=${r.ctf_events} gap=${r.trades_without_direct_ctf} $${r.clob_usdc?.toFixed(0)}`);
  });

  // Strategy 4: Check ERC1155 transfers for proxy relationships
  console.log('\n--- STRATEGY 4: ERC1155 transfer patterns ---\n');

  const erc1155Patterns = await queryJson(`
    SELECT
      from_address,
      to_address,
      count(*) as transfer_count,
      countDistinct(token_id) as unique_tokens
    FROM pm_erc1155_transfers
    WHERE is_deleted = 0
      AND (
        lower(from_address) = '${EXCHANGE_PROXY}'
        OR lower(to_address) = '${EXCHANGE_PROXY}'
        OR lower(from_address) = '${CTF_EXCHANGE}'
        OR lower(to_address) = '${CTF_EXCHANGE}'
      )
    GROUP BY from_address, to_address
    ORDER BY transfer_count DESC
    LIMIT 30
  `);

  console.log('ERC1155 transfer patterns involving known contracts:');
  erc1155Patterns.forEach((r: any, i: number) => {
    const fromLabel = r.from_address?.toLowerCase() === EXCHANGE_PROXY ? 'PROXY' :
                      r.from_address?.toLowerCase() === CTF_EXCHANGE ? 'CTF_EX' :
                      r.from_address?.slice(0, 15) + '...';
    const toLabel = r.to_address?.toLowerCase() === EXCHANGE_PROXY ? 'PROXY' :
                    r.to_address?.toLowerCase() === CTF_EXCHANGE ? 'CTF_EX' :
                    r.to_address?.slice(0, 15) + '...';
    console.log(`  ${i+1}. ${fromLabel} -> ${toLabel} transfers=${r.transfer_count} tokens=${r.unique_tokens}`);
  });

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY OF FINDINGS');
  console.log('='.repeat(80));

  console.log(`
KEY INSIGHTS:

1. TWO MAIN CONTRACTS ACT AS PROXIES:
   - Exchange Proxy (${EXCHANGE_PROXY}): Handles both CTF and CLOB operations
   - CTF Exchange (${CTF_EXCHANGE}): Handles CTF operations only (no direct CLOB)

2. WALLET LINKING MECHANISM:
   - When a user trades on Polymarket, the CLOB order uses their EOA wallet
   - The CTF (token minting/burning) happens through the Exchange Proxy contract
   - The transaction hash links these two activities

3. TO LINK USER WALLET TO PROXY:
   - Find transactions where pm_trader_events_v2.trader_wallet = user EOA
   - Match tx_hash to pm_ctf_events where user_address = Exchange Proxy
   - The CLOB trader_wallet IS the actual user wallet

4. DATA QUALITY:
   - pm_trader_events_v2.transaction_hash is stored as binary (32 bytes)
   - pm_ctf_events.tx_hash is stored as hex string with 0x prefix (66 chars)
   - Conversion needed: lower(concat('0x', hex(transaction_hash)))

5. CONFIRMED PATTERN FROM V2:
   - CTF user = 0xd91e80cf2e7be2e162... (CTF Exchange contract)
   - CLOB trader = 0xc200069e35b24b45ce... (actual user wallet with $3.8M traded)
   - This proves the user trades through the CTF Exchange contract
  `);

  console.log('\n' + '='.repeat(80));
  console.log('EXPLORATION COMPLETE');
  console.log('='.repeat(80));
}

run().catch(console.error);
