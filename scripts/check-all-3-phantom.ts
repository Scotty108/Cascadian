import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallets = [
  { name: 'Wallet 1 (maker_heavy)', address: '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e' },
  { name: 'Wallet 2 (taker_heavy)', address: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d' },
  { name: 'Wallet 3 (open_positions)', address: '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce' },
];

async function checkPhantom(wallet: string, name: string) {
  // Count phantom positions (sold > bought)
  const phantomQuery = `
    WITH deduped_trades AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        t.side,
        t.token_amount / 1e6 as tokens
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    ),
    position_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      count() as total_positions,
      countIf(sold > bought * 1.01) as phantom_positions,
      sumIf(sold - bought, sold > bought * 1.01) as phantom_tokens,
      sumIf(sold, sold > bought * 1.01) as phantom_sell_volume
    FROM position_totals
  `;

  const r = await clickhouse.query({ query: phantomQuery, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  const row = rows[0] || {};

  return {
    name,
    wallet: wallet.substring(0, 10) + '...',
    total_positions: row.total_positions || 0,
    phantom_positions: row.phantom_positions || 0,
    phantom_pct: row.total_positions ? ((row.phantom_positions / row.total_positions) * 100).toFixed(1) + '%' : '0%',
    phantom_tokens: Number(row.phantom_tokens || 0).toFixed(2),
    phantom_sell_volume: Number(row.phantom_sell_volume || 0).toFixed(2),
  };
}

async function main() {
  console.log('=== PHANTOM POSITION ANALYSIS FOR ALL 3 WALLETS ===\n');

  const results = await Promise.all(
    wallets.map(w => checkPhantom(w.address, w.name))
  );

  console.table(results);

  process.exit(0);
}

main().catch(console.error);
