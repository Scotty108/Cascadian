import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const CALIBRATION = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== INVESTIGATION: Where did calibration get extra tokens? ===\n');

  // 1. ALL CTF event types
  console.log('1. ALL CTF event types for calibration:');
  const ctfQ = `
    SELECT
      event_type,
      count() as cnt,
      sum(toFloat64OrZero(amount_or_payout))/1e6 as total_amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${CALIBRATION}'
      AND is_deleted = 0
    GROUP BY event_type
    ORDER BY cnt DESC
  `;
  const ctfR = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  console.table(await ctfR.json());

  // 2. ALL source types in unified ledger
  console.log('\n2. ALL source_type in unified ledger:');
  const ledgerQ = `
    SELECT
      source_type,
      count() as events,
      sum(token_delta) as net_tokens,
      sum(usdc_delta) as net_usdc
    FROM pm_unified_ledger_v8_tbl
    WHERE lower(wallet_address) = '${CALIBRATION}'
    GROUP BY source_type
    ORDER BY events DESC
  `;
  const ledgerR = await clickhouse.query({ query: ledgerQ, format: 'JSONEachRow' });
  console.table(await ledgerR.json());

  // 3. Tokens with deficits
  console.log('\n3. TOP 15 tokens with deficits (sold > bought):');
  const deficitQ = `
    SELECT
      token_id,
      sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END)/1e6 as bought,
      sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END)/1e6 as sold,
      (sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END) -
       sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END))/1e6 as deficit
    FROM pm_trader_events_dedup_v2_tbl
    WHERE trader_wallet = '${CALIBRATION}'
    GROUP BY token_id
    HAVING deficit > 0.01
    ORDER BY deficit DESC
    LIMIT 15
  `;
  const deficitR = await clickhouse.query({ query: deficitQ, format: 'JSONEachRow' });
  const deficits = await deficitR.json() as any[];
  console.table(deficits);

  const totalDeficit = deficits.reduce((sum: number, d: any) => sum + parseFloat(d.deficit), 0);
  console.log('Total token deficit:', totalDeficit.toFixed(2));

  // 4. Map deficit tokens to conditions
  console.log('\n4. Mapping deficit tokens to conditions:');
  const deficitTokens = deficits.map((d: any) => `'${d.token_id}'`).join(',');
  if (deficitTokens) {
    const mapQ = `
      SELECT
        token_id_dec as token_id,
        condition_id,
        outcome_index,
        question
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${deficitTokens})
    `;
    const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
    const mappings = await mapR.json() as any[];
    for (const m of mappings.slice(0, 10)) {
      console.log(`Token ${(m.token_id as string).slice(0,20)}... -> Outcome ${m.outcome_index}: ${(m.question as string || '').slice(0,60)}...`);
    }
  }

  // 5. Check for ERC1155 transfer-related tables
  console.log('\n5. ERC1155/Transfer related tables in database:');
  const tablesQ = `
    SELECT name FROM system.tables
    WHERE database = 'default'
      AND (name LIKE '%erc1155%' OR name LIKE '%transfer%' OR name LIKE '%erc20%')
    ORDER BY name
  `;
  const tablesR = await clickhouse.query({ query: tablesQ, format: 'JSONEachRow' });
  console.table(await tablesR.json());

  // 6. Check if unified ledger has Transfer source types
  console.log('\n6. Checking for Transfer events in unified ledger (all wallets):');
  const transferTypesQ = `
    SELECT source_type, count() as cnt
    FROM pm_unified_ledger_v8_tbl
    WHERE source_type LIKE '%Transfer%' OR source_type LIKE '%transfer%'
    GROUP BY source_type
    ORDER BY cnt DESC
    LIMIT 10
  `;
  const transferTypesR = await clickhouse.query({ query: transferTypesQ, format: 'JSONEachRow' });
  console.table(await transferTypesR.json());

  // 7. Check Goldsky ERC1155 data
  console.log('\n7. Looking for Goldsky ERC1155 tables:');
  const goldskyQ = `
    SELECT name FROM system.tables
    WHERE database = 'default'
      AND name LIKE '%goldsky%'
    ORDER BY name
  `;
  const goldskyR = await clickhouse.query({ query: goldskyQ, format: 'JSONEachRow' });
  console.table(await goldskyR.json());

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
