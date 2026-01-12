import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0'; // spot_6 - smallest gap

async function main() {
  console.log('Identifying Missing Trades in V3 for wallet: ' + WALLET);
  console.log('================================================================================\n');

  // First, get all v2 event_ids (deduplicated)
  const v2EventIdsQuery = `
    SELECT DISTINCT event_id
    FROM pm_trader_events_v2
    WHERE trader_wallet = '${WALLET}'
      AND is_deleted = 0
    ORDER BY event_id
  `;

  // Get all v3 event_ids (first 66 chars)
  const v3EventIdsQuery = `
    SELECT DISTINCT substring(event_id, 1, 66) as event_id_prefix
    FROM pm_trader_events_v3
    WHERE trader_wallet = '${WALLET}'
    ORDER BY event_id_prefix
  `;

  const v2Result = await clickhouse.query({ query: v2EventIdsQuery, format: 'JSONEachRow' });
  const v3Result = await clickhouse.query({ query: v3EventIdsQuery, format: 'JSONEachRow' });

  const v2Events = await v2Result.json() as Array<{ event_id: string }>;
  const v3Events = await v3Result.json() as Array<{ event_id_prefix: string }>;

  const v3Prefixes = new Set(v3Events.map(e => e.event_id_prefix));
  
  // Find missing events
  const missingEvents = v2Events.filter(e => !v3Prefixes.has(e.event_id));

  console.log('V2 Total Events:     ' + v2Events.length);
  console.log('V3 Total Events:     ' + v3Events.length);
  console.log('Missing in V3:       ' + missingEvents.length);
  console.log('\n================================================================================');
  console.log('SAMPLE OF MISSING EVENTS (first 10):');
  console.log('================================================================================\n');

  // Get details of first 10 missing events
  const sampleEventIds = missingEvents.slice(0, 10).map(e => "'" + e.event_id + "'").join(',');
  
  if (sampleEventIds) {
    const detailsQuery = `
      SELECT
        event_id,
        side,
        usdc_amount / 1000000.0 as usdc,
        token_amount / 1000000.0 as tokens,
        trade_time,
        condition_id,
        outcome_index
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}'
        AND is_deleted = 0
        AND event_id IN (${sampleEventIds})
      ORDER BY trade_time DESC
    `;

    const detailsResult = await clickhouse.query({ query: detailsQuery, format: 'JSONEachRow' });
    const details = await detailsResult.json() as Array<any>;

    console.table(details.map(d => ({
      'Event ID': d.event_id.substring(0, 20) + '...',
      'Side': d.side,
      'USDC': '$' + d.usdc.toFixed(2),
      'Tokens': d.tokens.toFixed(4),
      'Time': d.trade_time,
      'Condition': d.condition_id.substring(0, 10) + '...',
      'Outcome': d.outcome_index,
    })));
  }
}

main().catch(console.error);
