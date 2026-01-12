import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function check() {
  // Check for NegRisk activity
  const negRiskQuery = `
    SELECT count() as neg_risk_trades
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_wallet) = '${wallet}'
  `;

  try {
    const r = await clickhouse.query({ query: negRiskQuery, format: 'JSONEachRow' });
    const rows = (await r.json()) as any[];
    console.log('NegRisk conversions:', rows[0]?.neg_risk_trades || 0);
  } catch (e) {
    console.log('NegRisk table not available');
  }

  // Check for ERC1155 transfers
  const erc1155Query = `
    SELECT count() as transfers
    FROM pm_erc1155_transfers_v1
    WHERE lower(from_address) = '${wallet}' OR lower(to_address) = '${wallet}'
  `;

  try {
    const r2 = await clickhouse.query({ query: erc1155Query, format: 'JSONEachRow' });
    const rows2 = (await r2.json()) as any[];
    console.log('ERC1155 transfers:', rows2[0]?.transfers || 0);
  } catch (e) {
    console.log('ERC1155 table not available');
  }

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
      countIf(sold > bought * 1.01) as phantom_positions,
      sumIf(sold - bought, sold > bought * 1.01) as phantom_tokens
    FROM position_totals
  `;

  const r4 = await clickhouse.query({ query: phantomQuery, format: 'JSONEachRow' });
  const rows4 = (await r4.json()) as any[];
  console.log('Phantom positions (sold > bought):', rows4[0]?.phantom_positions || 0);
  console.log('Phantom tokens sold without buying:', Number(rows4[0]?.phantom_tokens || 0).toFixed(2));

  // Show examples of phantom positions
  const phantomExamplesQuery = `
    WITH deduped_trades AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        t.token_amount / 1e6 as tokens,
        t.usdc_amount / 1e6 as usdc
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    ),
    position_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_usdc,
        sumIf(usdc, side='sell') as sell_usdc
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    )
    SELECT
      substring(condition_id, 1, 12) as cond,
      substring(question, 1, 40) as q,
      outcome_index as oi,
      round(bought, 2) as bought,
      round(sold, 2) as sold,
      round(sold - bought, 2) as phantom,
      round(buy_usdc, 2) as buy_usdc,
      round(sell_usdc, 2) as sell_usdc
    FROM position_totals
    WHERE sold > bought * 1.01
    ORDER BY abs(sold - bought) DESC
    LIMIT 10
  `;

  console.log('\n=== PHANTOM POSITIONS (sold > bought) ===');
  const r5 = await clickhouse.query({ query: phantomExamplesQuery, format: 'JSONEachRow' });
  const rows5 = (await r5.json()) as any[];
  console.table(rows5);

  process.exit(0);
}

check().catch(console.error);
