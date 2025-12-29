/**
 * Find tokens that were traded but NOT from splits (bought from other traders)
 * These tokens won't have tx_hash correlation to CTF events
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== FINDING UNMAPPED TOKENS ===\n');

  // Get ALL unique tokens traded by this wallet
  const allTokensQ = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
  `;
  const r1 = await clickhouse.query({ query: allTokensQ, format: 'JSONEachRow' });
  const allTokens = (await r1.json() as any[]).map(t => t.token_id);
  console.log('Total unique tokens traded:', allTokens.length);

  // Get tokens that have tx_hash correlation (came from splits)
  const mappedQ = `
    WITH wallet_txs AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    ),
    split_txs AS (
      SELECT DISTINCT tx_hash, condition_id
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM wallet_txs)
        AND event_type = 'PositionSplit'
        AND is_deleted = 0
    )
    SELECT DISTINCT t.token_id
    FROM pm_trader_events_v2 t
    JOIN split_txs s ON lower(concat('0x', hex(t.transaction_hash))) = s.tx_hash
    WHERE t.trader_wallet = '${WALLET}'
      AND t.is_deleted = 0
  `;
  const r2 = await clickhouse.query({ query: mappedQ, format: 'JSONEachRow' });
  const mappedTokens = new Set((await r2.json() as any[]).map(t => t.token_id));
  console.log('Tokens with split correlation:', mappedTokens.size);

  // Find unmapped tokens
  const unmapped = allTokens.filter(t => !mappedTokens.has(t));
  console.log('Unmapped tokens (no split correlation):', unmapped.length);

  // Check positions for unmapped tokens
  if (unmapped.length > 0) {
    const unmappedList = unmapped.map(t => `'${t}'`).join(',');
    const posQ = `
      SELECT
        token_id,
        sum(if(side = 'buy', token_amount, 0)) / 1e6 as bought,
        sum(if(side = 'sell', token_amount, 0)) / 1e6 as sold,
        sum(if(side = 'buy', token_amount, 0) - if(side = 'sell', token_amount, 0)) / 1e6 as net
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
        AND token_id IN (${unmappedList})
      GROUP BY token_id
    `;
    const r3 = await clickhouse.query({ query: posQ, format: 'JSONEachRow' });
    const positions = await r3.json() as any[];

    console.log('\nUnmapped token positions:');
    console.log('Token ID                      | Bought  | Sold    | Net');
    console.log('-'.repeat(70));

    let totalUnmappedHeld = 0;
    for (const p of positions) {
      const bought = parseFloat(p.bought);
      const sold = parseFloat(p.sold);
      const net = parseFloat(p.net);
      console.log(`${p.token_id.slice(0,28)}... | ${bought.toFixed(2).padStart(7)} | ${sold.toFixed(2).padStart(7)} | ${net.toFixed(2).padStart(7)}`);
      if (net > 0) {
        totalUnmappedHeld += net;
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total unmapped held value (if all win): $${totalUnmappedHeld.toFixed(2)}`);
    console.log(`This could explain the $274 gap between CLOB API ($139.82) and greedy ($413.82)`);
  }

  // Also check: are there tokens from pm_token_to_condition_map_v5?
  console.log('\n=== CHECKING GAMMA MAPPING COVERAGE ===');
  const gammaQ = `
    WITH wallet_tokens AS (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
    )
    SELECT
      count() as total,
      countIf(m.token_id_dec != '') as gamma_mapped
    FROM wallet_tokens t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
  `;
  const r4 = await clickhouse.query({ query: gammaQ, format: 'JSONEachRow' });
  const coverage = (await r4.json() as any[])[0];
  console.log(`Total tokens: ${coverage.total}`);
  console.log(`Gamma-mapped: ${coverage.gamma_mapped}`);
  console.log(`Coverage: ${((coverage.gamma_mapped / coverage.total) * 100).toFixed(1)}%`);
}

main().catch(console.error);
