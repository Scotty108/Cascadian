/**
 * Build Universal Wallet Token Ledger
 *
 * Creates pm_wallet_token_ledger_v1 - a complete ledger of ALL token movements:
 * 1. CLOB trades (maker + taker, deduped by event_id)
 * 2. CTF splits (attributed via tx_hash join to CLOB trades)
 * 3. CTF merges (attributed via tx_hash join to CLOB trades)
 * 4. CTF redemptions (direct user_address)
 *
 * This is the universal solution that works for ALL wallet types.
 *
 * Usage:
 *   npx tsx scripts/pnl/build-universal-ledger.ts
 *   npx tsx scripts/pnl/build-universal-ledger.ts --wallet 0x26437896ed9dfeb2f69765edcafe8fdceaab39ae
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600000, // 10 min timeout for DDL
});

// Parse CLI args
const args = process.argv.slice(2);
const walletArg = args.indexOf('--wallet');
const targetWallet = walletArg >= 0 ? args[walletArg + 1]?.toLowerCase() : null;

async function createLedgerTable() {
  console.log('Creating pm_wallet_token_ledger_v1 table...');

  const ddl = `
    CREATE TABLE IF NOT EXISTS pm_wallet_token_ledger_v1
    (
      wallet String,
      token_id String,
      condition_id String,
      outcome_index Int32,
      event_type Enum8('clob_buy' = 1, 'clob_sell' = 2, 'split_buy' = 3, 'merge_sell' = 4, 'redemption' = 5),
      token_delta Float64,  -- Positive for buys, negative for sells
      usdc_delta Float64,   -- Negative for buys (spending), positive for sells (receiving)
      price Float64,        -- Price per token (usdc/tokens)
      event_time DateTime,
      tx_hash String,
      event_id String,
      source_table String,
      insert_time DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(insert_time)
    ORDER BY (wallet, token_id, event_id, event_type)
    SETTINGS index_granularity = 8192
  `;

  await client.command({ query: ddl });
  console.log('✅ Table created');
}

async function insertCLOBTrades(walletFilter?: string) {
  console.log(`\n[1/4] Inserting CLOB trades${walletFilter ? ` for ${walletFilter.slice(0, 10)}...` : ''}...`);

  // For single wallet, filter inside the subquery before aggregation
  const innerWhere = walletFilter
    ? `AND lower(trader_wallet) = '${walletFilter}'`
    : '';

  const query = `
    INSERT INTO pm_wallet_token_ledger_v1
    SELECT
      lower(t.wallet) as wallet,
      t.token_id,
      COALESCE(m.condition_id, '') as condition_id,
      COALESCE(toInt32(m.outcome_index), -1) as outcome_index,
      if(t.side = 'buy', 'clob_buy', 'clob_sell') as event_type,
      if(t.side = 'buy', t.tokens, -t.tokens) as token_delta,
      if(t.side = 'buy', -t.usdc, t.usdc) as usdc_delta,
      if(t.tokens > 0, t.usdc / t.tokens, 0) as price,
      t.trade_time as event_time,
      t.tx_hash,
      t.event_id,
      'pm_trader_events_v2' as source_table,
      now() as insert_time
    FROM (
      SELECT
        event_id,
        any(trader_wallet) as wallet,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        ${innerWhere}
      GROUP BY event_id
    ) t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  `;

  const result = await client.command({
    query,
    clickhouse_settings: { max_execution_time: 3600 }
  });
  console.log('✅ CLOB trades inserted');
}

async function insertSplits(walletFilter?: string) {
  console.log(`\n[2/4] Inserting CTF splits via tx_hash attribution${walletFilter ? ` for ${walletFilter.slice(0, 10)}...` : ''}...`);

  if (walletFilter) {
    // For single wallet: get tx_hashes first, then query splits in chunks
    const txQuery = `
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) = '${walletFilter}'
    `;
    const txResult = await client.query({ query: txQuery, format: 'JSONEachRow' });
    const txRows = (await txResult.json()) as { tx_hash: string }[];
    const txHashes = txRows.map(r => r.tx_hash);

    console.log(`  Found ${txHashes.length} unique tx_hashes`);

    if (txHashes.length === 0) {
      console.log('  No tx_hashes found, skipping splits');
      return;
    }

    // Process in chunks with retry
    const CHUNK_SIZE = 50; // Smaller chunks for stability
    const MAX_RETRIES = 3;

    for (let i = 0; i < txHashes.length; i += CHUNK_SIZE) {
      const chunk = txHashes.slice(i, i + CHUNK_SIZE);
      const txList = chunk.map(t => `'${t}'`).join(',');

      const query = `
        INSERT INTO pm_wallet_token_ledger_v1
        SELECT
          '${walletFilter}' as wallet,
          COALESCE(m.token_id_dec, concat('split_', ctf.condition_id, '_', toString(COALESCE(toInt32(m.outcome_index), -1)))) as token_id,
          ctf.condition_id,
          COALESCE(toInt32(m.outcome_index), -1) as outcome_index,
          'split_buy' as event_type,
          toFloat64OrZero(ctf.amount_or_payout) / 1e6 as token_delta,
          -(toFloat64OrZero(ctf.amount_or_payout) / 1e6 * 0.5) as usdc_delta,
          0.5 as price,
          ctf.event_timestamp as event_time,
          ctf.tx_hash,
          ctf.id as event_id,
          'pm_ctf_events' as source_table,
          now() as insert_time
        FROM pm_ctf_events ctf
        LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
        WHERE ctf.event_type = 'PositionSplit'
          AND ctf.is_deleted = 0
          AND ctf.tx_hash IN (${txList})
      `;

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          await client.command({
            query,
            clickhouse_settings: { max_execution_time: 120 }
          });
          break;
        } catch (e: any) {
          retries++;
          if (retries >= MAX_RETRIES) throw e;
          console.log(`\n  Retry ${retries}/${MAX_RETRIES} for chunk ${i}...`);
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }
      process.stdout.write(`\r  Processing chunks: ${i + chunk.length}/${txHashes.length}    `);
    }
    console.log(`\n✅ CTF splits inserted (${txHashes.length} tx_hashes processed)`);
  } else {
    // For all wallets: use the join approach
    const query = `
      INSERT INTO pm_wallet_token_ledger_v1
      SELECT
        wt.wallet,
        COALESCE(m.token_id_dec, concat('split_', ctf.condition_id, '_', toString(COALESCE(toInt32(m.outcome_index), -1)))) as token_id,
        ctf.condition_id,
        COALESCE(toInt32(m.outcome_index), -1) as outcome_index,
        'split_buy' as event_type,
        toFloat64OrZero(ctf.amount_or_payout) / 1e6 as token_delta,
        -(toFloat64OrZero(ctf.amount_or_payout) / 1e6 * 0.5) as usdc_delta,
        0.5 as price,
        ctf.event_timestamp as event_time,
        ctf.tx_hash,
        ctf.id as event_id,
        'pm_ctf_events' as source_table,
        now() as insert_time
      FROM (
        SELECT DISTINCT
          lower(trader_wallet) as wallet,
          lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
      ) wt
      INNER JOIN pm_ctf_events ctf ON ctf.tx_hash = wt.tx_hash
      LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
      WHERE ctf.event_type = 'PositionSplit'
        AND ctf.is_deleted = 0
    `;

    await client.command({
      query,
      clickhouse_settings: {
        max_execution_time: 7200,
        join_algorithm: 'partial_merge',
      }
    });
    console.log('✅ CTF splits inserted');
  }
}

async function insertMerges(walletFilter?: string) {
  console.log(`\n[3/4] Inserting CTF merges via tx_hash attribution${walletFilter ? ` for ${walletFilter.slice(0, 10)}...` : ''}...`);

  if (walletFilter) {
    // For single wallet: get tx_hashes first, then query merges in chunks
    const txQuery = `
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND lower(trader_wallet) = '${walletFilter}'
    `;
    const txResult = await client.query({ query: txQuery, format: 'JSONEachRow' });
    const txRows = (await txResult.json()) as { tx_hash: string }[];
    const txHashes = txRows.map(r => r.tx_hash);

    console.log(`  Found ${txHashes.length} unique tx_hashes`);

    if (txHashes.length === 0) {
      console.log('  No tx_hashes found, skipping merges');
      return;
    }

    // Process in chunks with retry
    const CHUNK_SIZE = 50;
    const MAX_RETRIES = 3;

    for (let i = 0; i < txHashes.length; i += CHUNK_SIZE) {
      const chunk = txHashes.slice(i, i + CHUNK_SIZE);
      const txList = chunk.map(t => `'${t}'`).join(',');

      const query = `
        INSERT INTO pm_wallet_token_ledger_v1
        SELECT
          '${walletFilter}' as wallet,
          COALESCE(m.token_id_dec, concat('merge_', ctf.condition_id, '_', toString(COALESCE(toInt32(m.outcome_index), -1)))) as token_id,
          ctf.condition_id,
          COALESCE(toInt32(m.outcome_index), -1) as outcome_index,
          'merge_sell' as event_type,
          -(toFloat64OrZero(ctf.amount_or_payout) / 1e6) as token_delta,
          toFloat64OrZero(ctf.amount_or_payout) / 1e6 * 0.5 as usdc_delta,
          0.5 as price,
          ctf.event_timestamp as event_time,
          ctf.tx_hash,
          ctf.id as event_id,
          'pm_ctf_events' as source_table,
          now() as insert_time
        FROM pm_ctf_events ctf
        LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
        WHERE ctf.event_type = 'PositionsMerge'
          AND ctf.is_deleted = 0
          AND ctf.tx_hash IN (${txList})
      `;

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          await client.command({
            query,
            clickhouse_settings: { max_execution_time: 120 }
          });
          break;
        } catch (e: any) {
          retries++;
          if (retries >= MAX_RETRIES) throw e;
          console.log(`\n  Retry ${retries}/${MAX_RETRIES} for chunk ${i}...`);
          await new Promise(r => setTimeout(r, 1000 * retries));
        }
      }
      process.stdout.write(`\r  Processing chunks: ${i + chunk.length}/${txHashes.length}    `);
    }
    console.log(`\n✅ CTF merges inserted (${txHashes.length} tx_hashes processed)`);
  } else {
    // For all wallets: use the join approach
    const query = `
      INSERT INTO pm_wallet_token_ledger_v1
      SELECT
        wt.wallet,
        COALESCE(m.token_id_dec, concat('merge_', ctf.condition_id, '_', toString(COALESCE(toInt32(m.outcome_index), -1)))) as token_id,
        ctf.condition_id,
        COALESCE(toInt32(m.outcome_index), -1) as outcome_index,
        'merge_sell' as event_type,
        -(toFloat64OrZero(ctf.amount_or_payout) / 1e6) as token_delta,
        toFloat64OrZero(ctf.amount_or_payout) / 1e6 * 0.5 as usdc_delta,
        0.5 as price,
        ctf.event_timestamp as event_time,
        ctf.tx_hash,
        ctf.id as event_id,
        'pm_ctf_events' as source_table,
        now() as insert_time
      FROM (
        SELECT DISTINCT
          lower(trader_wallet) as wallet,
          lower(concat('0x', hex(transaction_hash))) as tx_hash
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
      ) wt
      INNER JOIN pm_ctf_events ctf ON ctf.tx_hash = wt.tx_hash
      LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
      WHERE ctf.event_type = 'PositionsMerge'
        AND ctf.is_deleted = 0
    `;

    await client.command({
      query,
      clickhouse_settings: { max_execution_time: 7200 }
    });
    console.log('✅ CTF merges inserted');
  }
}

async function insertRedemptions(walletFilter?: string) {
  console.log(`\n[4/4] Inserting CTF redemptions${walletFilter ? ` for ${walletFilter.slice(0, 10)}...` : ''}...`);

  const whereClause = walletFilter
    ? `AND lower(user_address) = '${walletFilter}'`
    : '';

  const query = `
    INSERT INTO pm_wallet_token_ledger_v1
    SELECT
      lower(ctf.user_address) as wallet,
      COALESCE(m.token_id_dec, concat('redemption_', ctf.condition_id, '_', toString(m.outcome_index))) as token_id,
      ctf.condition_id,
      COALESCE(m.outcome_index, -1) as outcome_index,
      'redemption' as event_type,
      -(toFloat64OrZero(ctf.amount_or_payout) / 1e6) as token_delta,
      toFloat64OrZero(ctf.amount_or_payout) / 1e6 as usdc_delta,  -- Will be adjusted based on payout
      1.0 as price,  -- Winning redemption price
      ctf.event_timestamp as event_time,
      ctf.tx_hash,
      ctf.id as event_id,
      'pm_ctf_events' as source_table,
      now() as insert_time
    FROM pm_ctf_events ctf
    LEFT JOIN pm_token_to_condition_map_v5 m ON lower(ctf.condition_id) = lower(m.condition_id)
    WHERE ctf.event_type = 'PayoutRedemption'
      AND ctf.is_deleted = 0
      ${whereClause}
  `;

  const result = await client.command({
    query,
    clickhouse_settings: { max_execution_time: 3600 }
  });
  console.log('✅ CTF redemptions inserted');
}

async function printStats(walletFilter?: string) {
  const whereClause = walletFilter ? `WHERE wallet = '${walletFilter}'` : '';

  const query = `
    SELECT
      event_type,
      count() as cnt,
      sum(abs(token_delta)) as total_tokens,
      sum(abs(usdc_delta)) as total_usdc
    FROM pm_wallet_token_ledger_v1
    ${whereClause}
    GROUP BY event_type
    ORDER BY event_type
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('\n' + '═'.repeat(60));
  console.log('LEDGER STATS');
  console.log('═'.repeat(60));

  for (const row of rows) {
    console.log(`  ${row.event_type}: ${Number(row.cnt).toLocaleString()} events, ${Number(row.total_tokens).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens`);
  }
}

async function main() {
  console.log('═'.repeat(60));
  console.log('UNIVERSAL WALLET TOKEN LEDGER BUILDER');
  console.log('═'.repeat(60));

  if (targetWallet) {
    console.log(`\nBuilding ledger for single wallet: ${targetWallet}`);
  } else {
    console.log('\nBuilding ledger for ALL wallets (this may take a while)...');
  }

  try {
    await createLedgerTable();

    // If targeting a single wallet, clear existing entries first
    if (targetWallet) {
      console.log(`\nClearing existing entries for ${targetWallet.slice(0, 10)}...`);
      await client.command({
        query: `ALTER TABLE pm_wallet_token_ledger_v1 DELETE WHERE wallet = '${targetWallet}'`,
        clickhouse_settings: { mutations_sync: 1 }
      });
    }

    await insertCLOBTrades(targetWallet || undefined);
    await insertSplits(targetWallet || undefined);
    await insertMerges(targetWallet || undefined);
    await insertRedemptions(targetWallet || undefined);

    await printStats(targetWallet || undefined);

    console.log('\n✅ Universal ledger build complete!');
    console.log('\nQuery example:');
    console.log(`  SELECT wallet, sum(token_delta) as net_tokens, sum(usdc_delta) as net_usdc`);
    console.log(`  FROM pm_wallet_token_ledger_v1`);
    console.log(`  WHERE wallet = '0x...'`);
    console.log(`  GROUP BY wallet`);

  } catch (e) {
    console.error('Error:', e);
    throw e;
  } finally {
    await client.close();
  }
}

main().catch(console.error);
