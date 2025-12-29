/**
 * FINAL P&L CALCULATION using CLOB API
 *
 * Formula: P&L = Sells + Redemptions + Merges - Buys - Splits + HeldValue
 *
 * Where HeldValue = sum(position * (winner ? 1 : 0)) for resolved
 *                 = sum(position * price) for unresolved
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '@/lib/clickhouse/client';
import { ClobClient } from '@polymarket/clob-client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';
const DEPOSIT = 136.65;
const BALANCE = 49.99;
const GROUND_TRUTH = BALANCE - DEPOSIT; // -86.66

async function main() {
  console.log('=== FINAL P&L CALCULATION via CLOB API ===\n');
  console.log(`Wallet: ${WALLET}`);
  console.log(`Deposit: $${DEPOSIT.toFixed(2)}`);
  console.log(`Balance: $${BALANCE.toFixed(2)}`);
  console.log(`Ground Truth P&L: $${GROUND_TRUTH.toFixed(2)}\n`);

  const client = new ClobClient('https://clob.polymarket.com', 137);

  // ============================================================
  // Get all P&L components
  // ============================================================

  // CLOB aggregates (deduped)
  const clobQ = `
    WITH deduped AS (
      SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      sum(if(side = 'buy', usdc, 0)) as buys,
      sum(if(side = 'sell', usdc, 0)) as sells
    FROM deduped
  `;
  const { buys, sells } = (await (await clickhouse.query({ query: clobQ, format: 'JSONEachRow' })).json() as any[])[0];

  // Redemptions (direct user_address)
  const redQ = `
    SELECT sum(toFloat64OrZero(amount_or_payout)) / 1e6 as redemptions
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption' AND is_deleted = 0
  `;
  const { redemptions } = (await (await clickhouse.query({ query: redQ, format: 'JSONEachRow' })).json() as any[])[0];

  // Splits and Merges (via tx_hash join)
  const ctfQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT
      event_type,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs) AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfRows = (await (await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' })).json()) as any[];
  let splits = 0;
  let merges = 0;
  for (const r of ctfRows) {
    if (r.event_type === 'PositionSplit') splits = parseFloat(r.total);
    if (r.event_type === 'PositionsMerge') merges = parseFloat(r.total);
  }

  console.log('=== CASH FLOWS ===');
  console.log(`  CLOB Sells:    +$${parseFloat(sells).toFixed(2)}`);
  console.log(`  CLOB Buys:     -$${parseFloat(buys).toFixed(2)}`);
  console.log(`  Splits:        -$${splits.toFixed(2)}`);
  console.log(`  Redemptions:   +$${(parseFloat(redemptions) || 0).toFixed(2)}`);
  console.log(`  Merges:        +$${merges.toFixed(2)}`);

  const netCash =
    parseFloat(sells) +
    (parseFloat(redemptions) || 0) +
    merges -
    parseFloat(buys) -
    splits;
  console.log(`  Net Cash Flow: $${netCash.toFixed(2)}`);

  // ============================================================
  // Calculate held value from CLOB API
  // ============================================================
  console.log('\n=== HELD VALUE CALCULATION ===');

  // Get conditions
  const condQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2 WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    SELECT DISTINCT condition_id
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
      AND event_type = 'PositionSplit' AND is_deleted = 0
  `;
  const conditions = (await (await clickhouse.query({ query: condQ, format: 'JSONEachRow' })).json()) as any[];

  // Get CLOB positions
  const posQ = `
    SELECT token_id, sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_position
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    GROUP BY token_id
  `;
  const positions = new Map<string, number>();
  for (const p of (await (await clickhouse.query({ query: posQ, format: 'JSONEachRow' })).json()) as any[]) {
    positions.set(p.token_id, parseFloat(p.net_position));
  }

  // Fetch token metadata from CLOB API
  const tokenInfo = new Map<string, { winner: boolean | null; price: number }>();
  let apiSuccess = 0;
  let apiFail = 0;

  for (const { condition_id } of conditions) {
    try {
      const m = await client.getMarket('0x' + condition_id);
      if (m?.tokens) {
        for (const t of m.tokens) {
          tokenInfo.set(t.token_id, {
            winner: t.winner ?? null,
            price: parseFloat(t.price || '0'),
          });
        }
        apiSuccess++;
      } else {
        apiFail++;
      }
    } catch {
      apiFail++;
    }
  }

  console.log(`  API success: ${apiSuccess}/${conditions.length}`);
  console.log(`  API fail: ${apiFail}/${conditions.length}`);

  // Calculate held value
  let heldValue = 0;
  let longWinners = 0;
  let longLosers = 0;
  let longUnresolved = 0;

  for (const [tokenId, pos] of positions) {
    if (pos <= 0) continue; // Only long positions

    const info = tokenInfo.get(tokenId);
    if (!info) continue;

    if (info.winner === true) {
      heldValue += pos;
      longWinners++;
    } else if (info.winner === false) {
      // Worth $0
      longLosers++;
    } else {
      heldValue += pos * info.price;
      longUnresolved++;
    }
  }

  console.log(`  Long winners: ${longWinners} = $${heldValue.toFixed(2)}`);
  console.log(`  Long losers: ${longLosers} = $0`);
  console.log(`  Long unresolved: ${longUnresolved}`);
  console.log(`  Total held value: $${heldValue.toFixed(2)}`);

  // ============================================================
  // Calculate P&L
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('FINAL P&L CALCULATION');
  console.log('='.repeat(60));

  const calculatedPnl = netCash + heldValue;
  const expectedHeld = GROUND_TRUTH - netCash;
  const heldError = Math.abs(heldValue - expectedHeld);
  const pnlError = Math.abs(calculatedPnl - GROUND_TRUTH);

  console.log(`\n  Net cash flow:      $${netCash.toFixed(2)}`);
  console.log(`  Held value (CLOB):  $${heldValue.toFixed(2)}`);
  console.log(`  Expected held:      $${expectedHeld.toFixed(2)}`);
  console.log(`  Held value gap:     $${heldError.toFixed(2)}`);
  console.log(`\n  Calculated P&L:     $${calculatedPnl.toFixed(2)}`);
  console.log(`  Ground truth P&L:   $${GROUND_TRUTH.toFixed(2)}`);
  console.log(`  P&L error:          $${pnlError.toFixed(2)}`);

  const pctError = Math.abs(pnlError / DEPOSIT) * 100;
  console.log(`  Error as % of deposit: ${pctError.toFixed(1)}%`);

  if (pnlError < 10) {
    console.log('\n✅ CLOB API approach works for this wallet');
  } else if (pnlError < 50) {
    console.log('\n⚠️ CLOB API approach has moderate error');
  } else {
    console.log('\n❌ CLOB API approach has significant error for this wallet');
    console.log('   Recommendation: Use ground truth calibration for this cohort');
  }

  // ============================================================
  // Analysis: Why is held value different?
  // ============================================================
  console.log('\n=== HELD VALUE DISCREPANCY ANALYSIS ===');
  console.log(`Gap: $${heldError.toFixed(2)}`);
  console.log('Possible causes:');
  console.log('  1. Merges reduced actual held but CLOB still shows full position');
  console.log(`     (Merges = $${merges.toFixed(2)} ≈ ${(merges / 2).toFixed(2)} winner tokens)`);
  console.log('  2. Some positions partially redeemed but CLOB shows original');
  console.log('  3. Polymarket balance includes unrealized P&L at market prices');
}

main().catch(console.error);
