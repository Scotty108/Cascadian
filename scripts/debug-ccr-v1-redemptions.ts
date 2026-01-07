/**
 * Debug CCR-v1 redemption processing
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61';

async function main() {
  console.log('Debugging CCR-v1 Redemption Processing\n');

  // 1. Get CTF redemption events for wallet
  const ctfQuery = `
    SELECT
      event_type,
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      event_timestamp,
      tx_hash
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${WALLET}')
      AND is_deleted = 0
      AND event_type = 'PayoutRedemption'
    ORDER BY event_timestamp
  `;

  const ctfResult = await clickhouse.query({ query: ctfQuery, format: 'JSONEachRow' });
  const ctfEvents = (await ctfResult.json()) as any[];

  console.log(`Found ${ctfEvents.length} PayoutRedemption events:\n`);

  // 2. For each redemption, check if we have matching token mappings
  for (const event of ctfEvents) {
    console.log(`Condition: ...${event.condition_id.slice(-12)}`);
    console.log(`  Amount: $${event.amount.toFixed(2)}`);
    console.log(`  Time: ${event.event_timestamp}`);

    // Check token mapping
    const mapQuery = `
      SELECT token_id_dec, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE lower(condition_id) = lower('${event.condition_id}')
    `;
    const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
    const mappings = (await mapResult.json()) as any[];

    if (mappings.length === 0) {
      console.log(`  ⚠️ NO TOKEN MAPPING FOUND!`);
    } else {
      console.log(`  Token mappings: ${mappings.length}`);
      for (const m of mappings) {
        console.log(`    - outcome ${m.outcome_index}: token ...${m.token_id_dec.slice(-12)}`);
      }
    }

    // Check CLOB trades for this condition
    const clobQuery = `
      SELECT
        side,
        count() as cnt,
        round(sum(usdc_amount)/1e6, 2) as usdc,
        round(sum(token_amount)/1e6, 2) as tokens
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND lower(m.condition_id) = lower('${event.condition_id}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY side
    `;
    const clobResult = await clickhouse.query({ query: clobQuery, format: 'JSONEachRow' });
    const clobTrades = (await clobResult.json()) as any[];

    console.log(`  CLOB trades:`);
    for (const t of clobTrades) {
      console.log(`    - ${t.side}: ${t.cnt} trades, $${t.usdc} USDC, ${t.tokens} tokens`);
    }
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
