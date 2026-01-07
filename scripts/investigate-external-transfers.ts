/**
 * Investigate what external transfers actually mean on Polymarket
 * and test if our PnL calculation breaks for these wallets
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== INVESTIGATING EXTERNAL TRANSFERS ===\n');

  // Step 1: Understand what types of CTF events exist
  console.log('Step 1: What types of ERC1155 transfers exist?\n');

  const transferTypesQuery = await clickhouse.query({
    query: `
      SELECT
        CASE
          WHEN lower(to_address) = '0x0000000000000000000000000000000000000000' THEN 'BURN (redemption)'
          WHEN lower(from_address) = '0x0000000000000000000000000000000000000000' THEN 'MINT'
          WHEN lower(to_address) = lower(from_address) THEN 'SELF-TRANSFER'
          ELSE 'WALLET-TO-WALLET'
        END as transfer_type,
        count() as count,
        uniqExact(from_address) as unique_senders,
        uniqExact(to_address) as unique_receivers
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
      GROUP BY transfer_type
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });

  const transferTypes = await transferTypesQuery.json() as any[];
  console.log('Transfer Types:');
  for (const t of transferTypes) {
    console.log(`  ${t.transfer_type}: ${t.count.toLocaleString()} transfers`);
    console.log(`    Unique senders: ${t.unique_senders.toLocaleString()}`);
    console.log(`    Unique receivers: ${t.unique_receivers.toLocaleString()}`);
  }

  // Step 2: Find wallets that ONLY have burns (redemptions) vs other transfers
  console.log('\n\nStep 2: Wallets by transfer behavior...\n');

  const walletBehaviorQuery = await clickhouse.query({
    query: `
      SELECT
        wallet,
        sum(burns) as total_burns,
        sum(mints) as total_mints,
        sum(sends) as total_sends,
        sum(receives) as total_receives
      FROM (
        SELECT
          lower(from_address) as wallet,
          countIf(lower(to_address) = '0x0000000000000000000000000000000000000000') as burns,
          0 as mints,
          countIf(lower(to_address) != '0x0000000000000000000000000000000000000000') as sends,
          0 as receives
        FROM pm_erc1155_transfers
        WHERE is_deleted = 0
        GROUP BY from_address

        UNION ALL

        SELECT
          lower(to_address) as wallet,
          0 as burns,
          countIf(lower(from_address) = '0x0000000000000000000000000000000000000000') as mints,
          0 as sends,
          countIf(lower(from_address) != '0x0000000000000000000000000000000000000000') as receives
        FROM pm_erc1155_transfers
        WHERE is_deleted = 0
        GROUP BY to_address
      )
      WHERE wallet != '0x0000000000000000000000000000000000000000'
      GROUP BY wallet
      LIMIT 100000
    `,
    format: 'JSONEachRow'
  });

  const walletBehaviors = await walletBehaviorQuery.json() as any[];

  // Categorize
  const onlyBurns = walletBehaviors.filter(w => w.total_burns > 0 && w.total_sends === 0 && w.total_receives === 0);
  const onlyReceives = walletBehaviors.filter(w => w.total_receives > 0 && w.total_burns === 0 && w.total_sends === 0);
  const mixed = walletBehaviors.filter(w => w.total_sends > 0 || (w.total_receives > 0 && w.total_burns > 0));

  console.log(`Wallets with ONLY burns (redemptions): ${onlyBurns.length.toLocaleString()}`);
  console.log(`Wallets with ONLY receives (no burns): ${onlyReceives.length.toLocaleString()}`);
  console.log(`Wallets with sends or mixed behavior: ${mixed.length.toLocaleString()}`);

  // Step 3: Test PnL accuracy for different wallet types
  console.log('\n\nStep 3: Testing PnL accuracy by wallet type...\n');

  // Get a few wallets from each category that also appear in our precomputed table
  const testWallets = {
    'CLOB-only (no CTF)': [] as string[],
    'Burns-only (redemptions)': onlyBurns.slice(0, 100).map(w => w.wallet),
    'Mixed (sends/receives)': mixed.slice(0, 100).map(w => w.wallet)
  };

  // Get some CLOB-only wallets
  const clobOnlyQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT trader_wallet as wallet
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trader_wallet NOT IN (
          SELECT DISTINCT lower(from_address) FROM pm_erc1155_transfers WHERE is_deleted = 0
          UNION DISTINCT
          SELECT DISTINCT lower(to_address) FROM pm_erc1155_transfers WHERE is_deleted = 0
        )
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });
  testWallets['CLOB-only (no CTF)'] = (await clobOnlyQuery.json() as any[]).map(w => w.wallet);

  console.log('Testing wallet categories:');
  for (const [category, wallets] of Object.entries(testWallets)) {
    console.log(`  ${category}: ${wallets.length} test wallets`);
  }

  // Step 4: For each category, compare CLOB PnL vs precomputed
  console.log('\n\nStep 4: Comparing PnL calculations...\n');

  for (const [category, wallets] of Object.entries(testWallets)) {
    if (wallets.length === 0) continue;

    console.log(`\n=== ${category.toUpperCase()} ===`);

    // Get precomputed PnL for these wallets
    const precomputedQuery = await clickhouse.query({
      query: `
        SELECT
          wallet,
          sum(realized_pnl) as precomputed_pnl,
          count() as positions
        FROM pm_wallet_condition_realized_v1
        WHERE wallet IN (${wallets.slice(0, 20).map(w => `'${w}'`).join(',')})
        GROUP BY wallet
        HAVING count() >= 5
      `,
      format: 'JSONEachRow'
    });

    const precomputed = await precomputedQuery.json() as any[];

    if (precomputed.length === 0) {
      console.log('  No wallets with 5+ positions in precomputed table');
      continue;
    }

    // For each wallet, calculate CLOB-only PnL and compare
    let totalDiff = 0;
    let count = 0;

    for (const p of precomputed.slice(0, 10)) {
      // Calculate CLOB-only PnL
      const clobQuery = await clickhouse.query({
        query: `
          SELECT
            sum(pnl) as clob_pnl
          FROM (
            SELECT
              e.cond as cond,
              sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
              sum(if(e.side = 'sell', e.usdc, 0)) +
                (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
                sum(if(e.side = 'buy', e.usdc, 0)) as pnl
            FROM (
              SELECT
                tm.condition_id as cond,
                t.side as side,
                t.usdc as usdc,
                t.tokens as tokens,
                toFloat64(arrayElement(
                  JSONExtract(r.payout_numerators, 'Array(UInt64)'),
                  toUInt32(tm.outcome_index + 1)
                )) / toFloat64(r.payout_denominator) as payout
              FROM (
                SELECT
                  event_id,
                  any(token_id) as token_id,
                  any(lower(side)) as side,
                  any(usdc_amount) / 1e6 as usdc,
                  any(token_amount) / 1e6 as tokens
                FROM pm_trader_events_v2
                WHERE trader_wallet = '${p.wallet}' AND is_deleted = 0
                GROUP BY event_id
              ) t
              INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
              INNER JOIN (
                SELECT condition_id, payout_numerators, payout_denominator
                FROM pm_condition_resolutions FINAL
                WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
              ) r ON tm.condition_id = r.condition_id
            ) e
            GROUP BY e.cond
            HAVING cost_basis > 0
          )
        `,
        format: 'JSONEachRow'
      });

      const clobResult = await clobQuery.json() as any[];
      const clobPnl = clobResult[0]?.clob_pnl || 0;
      const diff = Math.abs(clobPnl - p.precomputed_pnl);
      const pctDiff = p.precomputed_pnl !== 0 ? (diff / Math.abs(p.precomputed_pnl)) * 100 : 0;

      totalDiff += pctDiff;
      count++;

      const match = pctDiff < 5 ? '✓' : pctDiff < 20 ? '~' : '✗';
      console.log(`  ${match} ${p.wallet.substring(0, 12)}... | Precomputed: $${p.precomputed_pnl.toFixed(0)} | CLOB: $${clobPnl.toFixed(0)} | Diff: ${pctDiff.toFixed(0)}%`);
    }

    if (count > 0) {
      console.log(`  Average difference: ${(totalDiff / count).toFixed(1)}%`);
    }
  }

  // Step 5: Deep dive into what external transfers actually are
  console.log('\n\n=== DEEP DIVE: What are external transfers? ===\n');

  // Look at some actual wallet-to-wallet transfers
  const w2wQuery = await clickhouse.query({
    query: `
      SELECT
        from_address,
        to_address,
        token_id,
        value,
        block_time
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
        AND lower(to_address) != '0x0000000000000000000000000000000000000000'
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      ORDER BY block_time DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const w2w = await w2wQuery.json() as any[];

  console.log('Recent wallet-to-wallet transfers:');
  for (const t of w2w.slice(0, 10)) {
    console.log(`  ${t.from_address.substring(0, 10)}... → ${t.to_address.substring(0, 10)}...`);
    console.log(`    Token: ${t.token_id?.substring(0, 20)}...`);
    console.log(`    Amount: ${(parseInt(t.value) / 1e6).toFixed(2)} tokens`);
    console.log(`    Time: ${t.block_time}`);
  }

  // Check if from/to addresses are related (same entity?)
  console.log('\n\nAre transfers between related wallets (same entity)?');

  const relatedQuery = await clickhouse.query({
    query: `
      SELECT
        lower(from_address) as sender,
        lower(to_address) as receiver,
        count() as transfers,
        sum(toFloat64(value)) / 1e6 as total_tokens
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
        AND lower(to_address) != '0x0000000000000000000000000000000000000000'
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      GROUP BY sender, receiver
      ORDER BY transfers DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const related = await relatedQuery.json() as any[];

  console.log('\nTop sender→receiver pairs:');
  for (const r of related.slice(0, 10)) {
    console.log(`  ${r.sender.substring(0, 10)}... → ${r.receiver.substring(0, 10)}... : ${r.transfers} transfers, ${r.total_tokens.toFixed(0)} tokens`);
  }

  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  console.log('External transfers on Polymarket can be:');
  console.log('  1. BURNS - Redeeming winning tokens for USDC (this is normal!)');
  console.log('  2. MINTS - Initial token creation (internal)');
  console.log('  3. WALLET-TO-WALLET - Could be:');
  console.log('     - Same person moving between wallets');
  console.log('     - OTC trades (selling tokens directly)');
  console.log('     - Proxy wallet operations');
  console.log('     - Gifts/transfers to others');
  console.log('\nPnL Impact:');
  console.log('  - Burns HELP us - we see the redemption');
  console.log('  - Transfers OUT break PnL - we see buy but not sell');
  console.log('  - Transfers IN break PnL - we see tokens with no cost basis');
}

main().catch(console.error);
