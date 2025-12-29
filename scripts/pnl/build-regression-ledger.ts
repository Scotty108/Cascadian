#!/usr/bin/env npx tsx
/**
 * Build a materialized ledger table for the 7 regression wallets ONLY.
 *
 * This creates a narrow, fast table with:
 * - delta_shares: change in token inventory
 * - cash_flow_usdc: USDC in/out (negative = spent, positive = received)
 * - event_type: TRADE, MINT, REDEEM, TRANSFER_IN, TRANSFER_OUT
 *
 * Then calculates PnL per wallet and compares to UI.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000, // 5 minutes for heavy operations
});

// The 7 regression wallets
const REGRESSION_WALLETS = [
  '0xadb7696bd58f5faddf23e85776b5f68fba65c02c',
  '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2',
  '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191',
  '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1',
  '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1',
  '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e',
  '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2',
];

// UI values from Playwright scraping
const UI_VALUES: Record<string, { net_total: number; gain?: number; loss?: number }> = {
  '0xadb7696bd58f5faddf23e85776b5f68fba65c02c': { net_total: -1592.95 },
  '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2': { net_total: 1618.24 },
  '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191': { net_total: 40.42, gain: 697.55, loss: -657.12 },
  '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1': { net_total: 8.72 },
  '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1': { net_total: -4.77, gain: 7.27, loss: -12.03 },
  '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e': { net_total: -67.54, gain: 49.27, loss: -116.81 },
  '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2': { net_total: 4160.93 },
};

async function main() {
  console.log('='.repeat(100));
  console.log('BUILDING REGRESSION LEDGER FOR 7 WALLETS');
  console.log('='.repeat(100));

  const walletList = REGRESSION_WALLETS.map(w => `'${w}'`).join(',');

  // Step 1: Create the ledger table
  console.log('\n1. Creating ledger table...');
  await clickhouse.command({
    query: `
      DROP TABLE IF EXISTS pm_regression_ledger_v1
    `
  });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_regression_ledger_v1 (
        wallet String,
        token_id String,
        ts DateTime,
        event_id String,
        event_type Enum8('TRADE' = 1, 'TRANSFER_IN' = 2, 'TRANSFER_OUT' = 3, 'MINT' = 4, 'REDEEM' = 5),
        delta_shares Float64,
        cash_flow_usdc Float64,
        tx_hash String
      ) ENGINE = MergeTree()
      ORDER BY (wallet, token_id, ts, event_id)
    `
  });
  console.log('   ✓ Table created');

  // Step 2: Load TRADE events
  console.log('\n2. Loading TRADE events...');
  const tradeInsert = await clickhouse.command({
    query: `
      INSERT INTO pm_regression_ledger_v1
      SELECT
        trader_wallet AS wallet,
        token_id,
        trade_time AS ts,
        event_id,
        'TRADE' AS event_type,
        CASE
          WHEN side = 'buy' THEN token_amount / 1000000.0
          ELSE -token_amount / 1000000.0
        END AS delta_shares,
        CASE
          WHEN side = 'buy' THEN -usdc_amount / 1000000.0
          ELSE usdc_amount / 1000000.0
        END AS cash_flow_usdc,
        transaction_hash AS tx_hash
      FROM (
        SELECT
          event_id,
          any(trader_wallet) AS trader_wallet,
          any(token_id) AS token_id,
          any(trade_time) AS trade_time,
          any(side) AS side,
          any(usdc_amount) AS usdc_amount,
          any(token_amount) AS token_amount,
          any(transaction_hash) AS transaction_hash
        FROM (
          SELECT *
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) IN (${walletList})
            AND is_deleted = 0
        ) AS filtered
        GROUP BY event_id
      )
    `
  });

  const tradeCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_regression_ledger_v1 WHERE event_type = 'TRADE'`,
    format: 'JSONEachRow'
  });
  console.log('   ✓ Loaded', (await tradeCount.json() as any[])[0].cnt, 'trade events');

  // Step 3: Load TRANSFER events (if any)
  console.log('\n3. Loading TRANSFER events...');

  // Transfer IN
  await clickhouse.command({
    query: `
      INSERT INTO pm_regression_ledger_v1
      SELECT
        to_address AS wallet,
        token_id,
        block_timestamp AS ts,
        concat(tx_hash, '-', toString(log_index), '-in') AS event_id,
        'TRANSFER_IN' AS event_type,
        toFloat64OrZero(value) / 1000000.0 AS delta_shares,
        0 AS cash_flow_usdc,
        tx_hash
      FROM pm_erc1155_transfers
      WHERE lower(to_address) IN (${walletList})
        AND is_deleted = 0
    `
  });

  // Transfer OUT
  await clickhouse.command({
    query: `
      INSERT INTO pm_regression_ledger_v1
      SELECT
        from_address AS wallet,
        token_id,
        block_timestamp AS ts,
        concat(tx_hash, '-', toString(log_index), '-out') AS event_id,
        'TRANSFER_OUT' AS event_type,
        -toFloat64OrZero(value) / 1000000.0 AS delta_shares,
        0 AS cash_flow_usdc,
        tx_hash
      FROM pm_erc1155_transfers
      WHERE lower(from_address) IN (${walletList})
        AND is_deleted = 0
    `
  });

  const transferCount = await clickhouse.query({
    query: `SELECT event_type, count() as cnt FROM pm_regression_ledger_v1 WHERE event_type IN ('TRANSFER_IN', 'TRANSFER_OUT') GROUP BY event_type`,
    format: 'JSONEachRow'
  });
  console.log('   ✓ Transfer events:', await transferCount.json());

  // Step 4: Load CTF MINT/REDEEM events
  console.log('\n4. Loading CTF MINT/REDEEM events...');

  // Check if pm_ctf_events has data for these wallets
  const ctfCheck = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_ctf_events
      WHERE lower(user_address) IN (${walletList})
    `,
    format: 'JSONEachRow'
  });
  const ctfCount = (await ctfCheck.json() as any[])[0].cnt;
  console.log('   CTF events found:', ctfCount);

  if (ctfCount > 0) {
    // PayoutRedemption = winning position payout (cash IN, shares go to 0)
    await clickhouse.command({
      query: `
        INSERT INTO pm_regression_ledger_v1
        SELECT
          lower(user_address) AS wallet,
          condition_id AS token_id,
          event_timestamp AS ts,
          id AS event_id,
          'REDEEM' AS event_type,
          0.0 AS delta_shares,
          toFloat64OrZero(amount_or_payout) / 1000000.0 AS cash_flow_usdc,
          tx_hash
        FROM pm_ctf_events
        WHERE lower(user_address) IN (${walletList})
          AND event_type = 'PayoutRedemption'
          AND is_deleted = 0
      `
    });

    // PositionSplit = minting tokens (pay USDC, receive tokens)
    await clickhouse.command({
      query: `
        INSERT INTO pm_regression_ledger_v1
        SELECT
          lower(user_address) AS wallet,
          condition_id AS token_id,
          event_timestamp AS ts,
          id AS event_id,
          'MINT' AS event_type,
          toFloat64OrZero(amount_or_payout) / 1000000.0 AS delta_shares,
          -toFloat64OrZero(amount_or_payout) / 1000000.0 AS cash_flow_usdc,
          tx_hash
        FROM pm_ctf_events
        WHERE lower(user_address) IN (${walletList})
          AND event_type = 'PositionSplit'
          AND is_deleted = 0
      `
    });

    // PositionMerge = merging tokens back (return tokens, get USDC)
    await clickhouse.command({
      query: `
        INSERT INTO pm_regression_ledger_v1
        SELECT
          lower(user_address) AS wallet,
          condition_id AS token_id,
          event_timestamp AS ts,
          id AS event_id,
          'REDEEM' AS event_type,
          -toFloat64OrZero(amount_or_payout) / 1000000.0 AS delta_shares,
          toFloat64OrZero(amount_or_payout) / 1000000.0 AS cash_flow_usdc,
          tx_hash
        FROM pm_ctf_events
        WHERE lower(user_address) IN (${walletList})
          AND event_type = 'PositionMerge'
          AND is_deleted = 0
      `
    });
  }

  const mintRedeemCount = await clickhouse.query({
    query: `SELECT event_type, count() as cnt FROM pm_regression_ledger_v1 WHERE event_type IN ('MINT', 'REDEEM') GROUP BY event_type`,
    format: 'JSONEachRow'
  });
  console.log('   ✓ Mint/Redeem events:', await mintRedeemCount.json());

  // Step 5: Calculate per-wallet summary
  console.log('\n5. Calculating per-wallet PnL...');

  const summary = await clickhouse.query({
    query: `
      SELECT
        wallet,
        count() as event_count,
        sum(delta_shares) as net_shares,
        sum(cash_flow_usdc) as total_cash_flow,
        countIf(event_type = 'TRADE') as trade_count,
        countIf(event_type IN ('TRANSFER_IN', 'TRANSFER_OUT')) as transfer_count,
        countIf(event_type IN ('MINT', 'REDEEM')) as ctf_count
      FROM pm_regression_ledger_v1
      GROUP BY wallet
      ORDER BY wallet
    `,
    format: 'JSONEachRow'
  });
  const summaryRows = await summary.json() as any[];

  console.log('\n' + '='.repeat(100));
  console.log('PER-WALLET SUMMARY');
  console.log('='.repeat(100));
  console.log('\nWallet                                     | Events | Trades | Transfers | CTF | Net Shares | Cash Flow | UI PnL    | Delta');
  console.log('-'.repeat(130));

  for (const row of summaryRows) {
    const wallet = row.wallet.toLowerCase();
    const uiPnl = UI_VALUES[wallet]?.net_total;
    const delta = uiPnl !== undefined ? row.total_cash_flow - uiPnl : null;

    const walletStr = wallet.slice(0, 42);
    const eventsStr = row.event_count.toString().padStart(6);
    const tradesStr = row.trade_count.toString().padStart(6);
    const transfersStr = row.transfer_count.toString().padStart(9);
    const ctfStr = row.ctf_count.toString().padStart(3);
    const sharesStr = row.net_shares.toFixed(2).padStart(10);
    const cashStr = `$${row.total_cash_flow.toFixed(2)}`.padStart(10);
    const uiStr = uiPnl !== undefined ? `$${uiPnl.toFixed(2)}`.padStart(9) : 'N/A'.padStart(9);
    const deltaStr = delta !== null ? `$${delta.toFixed(2)}`.padStart(9) : 'N/A'.padStart(9);

    console.log(`${walletStr} | ${eventsStr} | ${tradesStr} | ${transfersStr} | ${ctfStr} | ${sharesStr} | ${cashStr} | ${uiStr} | ${deltaStr}`);
  }

  // Step 6: Per-token breakdown for first wallet (debugging)
  console.log('\n' + '='.repeat(100));
  console.log('PER-TOKEN BREAKDOWN FOR PATAPAM222 (0xf70acdab...)');
  console.log('='.repeat(100));

  const tokenBreakdown = await clickhouse.query({
    query: `
      SELECT
        token_id,
        sum(delta_shares) as net_shares,
        sum(cash_flow_usdc) as cash_flow,
        count() as events,
        groupArray(event_type) as event_types
      FROM pm_regression_ledger_v1
      WHERE wallet = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191'
      GROUP BY token_id
    `,
    format: 'JSONEachRow'
  });
  const tokens = await tokenBreakdown.json() as any[];

  console.log('\nToken ID                                           | Net Shares | Cash Flow | Events');
  console.log('-'.repeat(90));

  let totalTokenPnl = 0;
  for (const t of tokens) {
    const tokenStr = t.token_id.slice(0, 48).padEnd(48);
    const sharesStr = t.net_shares.toFixed(2).padStart(10);
    const cashStr = `$${t.cash_flow.toFixed(2)}`.padStart(10);
    const eventsStr = t.events.toString().padStart(6);

    // For now, assume unresolved (net_shares remain, no settlement value)
    // A proper calculation would join resolution prices
    const pnl = t.cash_flow; // Without resolution, PnL = cash flow only
    totalTokenPnl += pnl;

    console.log(`${tokenStr} | ${sharesStr} | ${cashStr} | ${eventsStr}`);
  }

  console.log('-'.repeat(90));
  console.log(`TOTAL (trades only, no resolution):`.padEnd(48) + ` |            | $${totalTokenPnl.toFixed(2).padStart(9)} |`);
  console.log(`UI Net Total:`.padEnd(48) + ` |            | $${UI_VALUES['0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191'].net_total.toFixed(2).padStart(9)} |`);

  // Step 7: Top cash flow events for debugging
  console.log('\n' + '='.repeat(100));
  console.log('TOP 20 CASH FLOW EVENTS FOR PATAPAM222');
  console.log('='.repeat(100));

  const topEvents = await clickhouse.query({
    query: `
      SELECT
        ts,
        event_type,
        token_id,
        delta_shares,
        cash_flow_usdc
      FROM pm_regression_ledger_v1
      WHERE wallet = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191'
      ORDER BY abs(cash_flow_usdc) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const events = await topEvents.json() as any[];

  console.log('\nTimestamp           | Type        | Token (first 20)     | Δ Shares   | Cash Flow');
  console.log('-'.repeat(90));

  for (const e of events) {
    const tsStr = new Date(e.ts).toISOString().slice(0, 19);
    const typeStr = e.event_type.padEnd(11);
    const tokenStr = e.token_id.slice(0, 20).padEnd(20);
    const sharesStr = e.delta_shares.toFixed(2).padStart(10);
    const cashStr = `$${e.cash_flow_usdc.toFixed(2)}`.padStart(10);
    console.log(`${tsStr} | ${typeStr} | ${tokenStr} | ${sharesStr} | ${cashStr}`);
  }

  console.log('\n' + '='.repeat(100));
  console.log('CONCLUSION');
  console.log('='.repeat(100));
  console.log('\nThe cash_flow from trades alone does NOT match UI because:');
  console.log('1. CTF mint/redeem events are missing (0 found for these wallets)');
  console.log('2. Settlement/resolution payouts are not included');
  console.log('3. Need to join resolved prices: pnl = cash_flow + net_shares * resolved_price');
  console.log('\nNext step: Find and integrate CTF/settlement data sources.');

  await clickhouse.close();
}

main().catch(console.error);
