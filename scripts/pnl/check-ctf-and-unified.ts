/**
 * Check CTF table and unified ledger for problem wallets
 */

import { clickhouse } from '../../lib/clickhouse/client';

const PROBLEM_WALLETS = [
  '0x6a8ab02581be2c9ba3cdb59eeba25a481ee38a70', // Johnny - 113% error
  '0x8d74bc5d0da9eb1c16cc21648bc2e5c3b0b63b76', // 125% error
  '0x3355c7a6c0699ddd39b23f92ab78b7f8c3636a62', // 56% error
];

async function main() {
  // Check CTF events table overall
  const q1 = 'SELECT count() as cnt, uniqExact(user_address) as wallets FROM pm_ctf_events';
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];
  console.log('CTF Events table:', rows1[0]);

  // Check unified ledger v5 overall
  const q2 = 'SELECT source_type, count() as cnt FROM pm_unified_ledger_v5 GROUP BY source_type ORDER BY cnt DESC';
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.log('\nUnified Ledger v5 sources:');
  for (const r of rows2) {
    console.log(`  ${r.source_type}: ${r.cnt}`);
  }

  // Check each problem wallet in unified ledger
  for (const wallet of PROBLEM_WALLETS) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Wallet: ${wallet}`);

    // Check unified ledger sources
    const q3 = `
      SELECT source_type, count() as cnt, sum(usdc_delta) as usdc_total
      FROM pm_unified_ledger_v5
      WHERE lower(wallet) = lower('${wallet}')
      GROUP BY source_type
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const rows3 = (await r3.json()) as any[];
    console.log('Unified ledger sources:');
    if (rows3.length === 0) {
      console.log('  (none found)');
    } else {
      for (const r of rows3) {
        console.log(`  ${r.source_type}: ${r.cnt} events, $${Number(r.usdc_total).toFixed(2)} USDC`);
      }
    }

    // Check CLOB trades
    const q4 = `
      WITH deduped AS (
        SELECT event_id, any(usdc_amount) / 1000000.0 as usdc, any(side) as side
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
          AND role = 'maker'
        GROUP BY event_id
      )
      SELECT
        count() as trades,
        sum(usdc) as total_usdc,
        sumIf(usdc, side = 'buy') as buy_usdc,
        sumIf(usdc, side = 'sell') as sell_usdc
      FROM deduped
    `;
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const rows4 = (await r4.json()) as any[];
    console.log('CLOB (maker) trades:');
    if (rows4.length > 0) {
      const r = rows4[0];
      console.log(`  Trades: ${r.trades}`);
      console.log(`  Buy: $${Number(r.buy_usdc).toFixed(2)}`);
      console.log(`  Sell: $${Number(r.sell_usdc).toFixed(2)}`);
      console.log(`  Net: $${(Number(r.sell_usdc) - Number(r.buy_usdc)).toFixed(2)}`);
    }

    // Check ALL trades (including taker)
    const q5 = `
      WITH deduped AS (
        SELECT event_id, any(usdc_amount) / 1000000.0 as usdc, any(side) as side, any(role) as role
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        count() as trades,
        sum(usdc) as total_usdc,
        countIf(role = 'maker') as maker_count,
        countIf(role = 'taker') as taker_count
      FROM deduped
    `;
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const rows5 = (await r5.json()) as any[];
    console.log('ALL trades (maker+taker):');
    if (rows5.length > 0) {
      const r = rows5[0];
      console.log(`  Total: ${r.trades} (${r.maker_count} maker, ${r.taker_count} taker)`);
      console.log(`  Total volume: $${Number(r.total_usdc).toFixed(2)}`);
    }
  }
}

main().catch(console.error);
