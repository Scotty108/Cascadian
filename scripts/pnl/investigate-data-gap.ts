/**
 * Investigate data gaps for a wallet
 *
 * Compares our DB vs multiple Polymarket data sources
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = process.argv[2] || '0x6a8ab02581be2c9ba3cdb59eeba25a481ee38a70';

async function main() {
  console.log('='.repeat(80));
  console.log(`DATA GAP INVESTIGATION: ${WALLET}`);
  console.log('='.repeat(80));

  // 1. Check pm_trader_events_v2 (our main trades table)
  console.log('\n1. pm_trader_events_v2:');
  const q1 = `
    WITH deduped AS (
      SELECT
        event_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1000000.0 as usdc,
        any(token_amount) / 1000000.0 as tokens,
        any(trade_time) as trade_time,
        any(block_number) as block
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      min(trade_time) as first_trade,
      max(trade_time) as last_trade,
      min(block) as first_block,
      max(block) as last_block,
      count() as total_trades,
      sum(usdc) as total_usdc,
      countIf(role = 'maker') as maker_trades,
      countIf(role = 'taker') as taker_trades,
      sumIf(usdc, role = 'maker') as maker_usdc,
      sumIf(usdc, role = 'taker') as taker_usdc
    FROM deduped
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = await r1.json() as any[];
  if (rows1.length > 0) {
    const r = rows1[0];
    console.log(`  First trade: ${r.first_trade} (block ${r.first_block})`);
    console.log(`  Last trade:  ${r.last_trade} (block ${r.last_block})`);
    console.log(`  Total trades: ${r.total_trades} ($${Number(r.total_usdc).toFixed(2)})`);
    console.log(`  Maker trades: ${r.maker_trades} ($${Number(r.maker_usdc).toFixed(2)})`);
    console.log(`  Taker trades: ${r.taker_trades} ($${Number(r.taker_usdc).toFixed(2)})`);
  }

  // 2. Check Polymarket Data API with pagination
  console.log('\n2. Polymarket Data API:');
  let allTrades: any[] = [];
  let offset = 0;
  const limit = 500;

  while (true) {
    const url = `https://data-api.polymarket.com/trades?user=${WALLET}&limit=${limit}&offset=${offset}`;
    const response = await fetch(url);
    const trades = await response.json() as any[];

    if (trades.length === 0) break;
    allTrades = allTrades.concat(trades);
    offset += trades.length;

    if (trades.length < limit) break;
    if (offset > 10000) break; // Safety limit
  }

  console.log(`  Total API trades: ${allTrades.length}`);
  if (allTrades.length > 0) {
    let buyUsdc = 0, sellUsdc = 0;
    const timestamps = allTrades.map(t => t.timestamp);
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    for (const t of allTrades) {
      const usdc = Number(t.price) * Number(t.size);
      if (t.side === 'BUY') buyUsdc += usdc;
      else sellUsdc += usdc;
    }

    console.log(`  First trade: ${new Date(minTs * 1000).toISOString()}`);
    console.log(`  Last trade:  ${new Date(maxTs * 1000).toISOString()}`);
    console.log(`  API total volume: $${(buyUsdc + sellUsdc).toFixed(2)}`);
    console.log(`  Buys: $${buyUsdc.toFixed(2)}, Sells: $${sellUsdc.toFixed(2)}`);
  }

  // 3. Check for ERC1155 transfers (might explain additional volume)
  console.log('\n3. Checking for ERC1155 transfers (pm_erc1155_transfers):');
  const q3 = `
    SELECT
      count() as total_transfers,
      sumIf(value / 1e6, direction = 'in') as total_in,
      sumIf(value / 1e6, direction = 'out') as total_out
    FROM pm_erc1155_transfers
    WHERE lower(wallet) = lower('${WALLET}')
  `;
  try {
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const rows3 = await r3.json() as any[];
    if (rows3.length > 0 && rows3[0].total_transfers > 0) {
      const r = rows3[0];
      console.log(`  Total transfers: ${r.total_transfers}`);
      console.log(`  Total in:  ${Number(r.total_in).toFixed(2)} tokens`);
      console.log(`  Total out: ${Number(r.total_out).toFixed(2)} tokens`);
    } else {
      console.log('  No ERC1155 transfers found');
    }
  } catch (e) {
    console.log('  Table not available');
  }

  // 4. Check for CTF exchange events
  console.log('\n4. Checking CTF exchange events (pm_ctf_exchange_events):');
  const q4 = `
    SELECT
      count() as total_events,
      sum(trade_value_usdc) as total_usdc
    FROM pm_ctf_exchange_events
    WHERE lower(trader) = lower('${WALLET}')
  `;
  try {
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const rows4 = await r4.json() as any[];
    if (rows4.length > 0 && rows4[0].total_events > 0) {
      const r = rows4[0];
      console.log(`  Total events: ${r.total_events}`);
      console.log(`  Total USDC: $${Number(r.total_usdc).toFixed(2)}`);
    } else {
      console.log('  No CTF exchange events found');
    }
  } catch (e) {
    console.log('  Table not available');
  }

  // 5. Check Goldsky tables
  console.log('\n5. Checking Goldsky order_filled:');
  const q5 = `
    SELECT
      count() as total_fills,
      min(timestamp) as first_fill,
      max(timestamp) as last_fill
    FROM goldsky_order_filled
    WHERE lower(maker) = lower('${WALLET}')
       OR lower(taker) = lower('${WALLET}')
  `;
  try {
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const rows5 = await r5.json() as any[];
    if (rows5.length > 0 && rows5[0].total_fills > 0) {
      const r = rows5[0];
      console.log(`  Total fills: ${r.total_fills}`);
      console.log(`  First: ${r.first_fill}, Last: ${r.last_fill}`);
    } else {
      console.log('  No Goldsky order_filled found');
    }
  } catch (e) {
    console.log('  Table not available');
  }

  // 6. Try to fetch from Polymarket Profile API
  console.log('\n6. Checking Polymarket Profile API:');
  try {
    const profileUrl = `https://polymarket.com/api/profile/${WALLET}`;
    const profileResp = await fetch(profileUrl);
    if (profileResp.ok) {
      const profile = await profileResp.json() as any;
      console.log(`  Username: ${profile.username || 'N/A'}`);
      console.log(`  Total trades: ${profile.totalTrades || 'N/A'}`);
      console.log(`  Total volume: $${profile.totalVolume || 'N/A'}`);
      console.log(`  Total PnL: $${profile.totalPnL || 'N/A'}`);
    }
  } catch (e) {
    console.log('  Profile API not accessible');
  }

  // 7. Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('If UI shows significantly more volume than our DB + API:');
  console.log('  - Could be FPMM/AMM trades not in CLOB data');
  console.log('  - Could be historical trades before our backfill range');
  console.log('  - Could be trades from a different data source');
}

main().catch(console.error);
