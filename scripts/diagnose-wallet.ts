import 'dotenv/config';
import { clickhouse } from '../lib/clickhouse/client';

async function diagnose() {
  const wallet = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
  
  // Get all tokens for this wallet
  const tokensQuery = `
    SELECT DISTINCT token_id
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}')
      AND is_deleted = 0
  `;
  const tokens = await clickhouse.query({ query: tokensQuery, format: 'JSONEachRow' });
  const tokenList: any[] = await tokens.json();
  
  // Get mapped tokens
  const mapQuery = `SELECT DISTINCT token_id FROM pm_token_to_condition_map_v5`;
  const mapped = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
  const mappedList: any[] = await mapped.json();
  const mappedSet = new Set(mappedList.map(r => r.token_id));
  
  const total = tokenList.length;
  const mappedCount = tokenList.filter(t => mappedSet.has(t.token_id)).length;
  const unmapped = tokenList.filter(t => !mappedSet.has(t.token_id));
  
  console.log('Token Coverage:', mappedCount + '/' + total, '(' + (100*mappedCount/total).toFixed(1) + '%)');
  
  if (unmapped.length > 0) {
    console.log('\nUnmapped tokens:', unmapped.length);
  }
  
  // Check last sync
  const syncQuery = `SELECT max(updated_at) as last_sync FROM pm_token_to_condition_map_v5`;
  const sync = await clickhouse.query({ query: syncQuery, format: 'JSONEachRow' });
  const syncData: any[] = await sync.json();
  console.log('\nToken map last updated:', syncData[0].last_sync);
  
  // Check data freshness for wallet
  const freshnessQuery = `
    SELECT max(trade_time) as last_trade FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
  `;
  const freshness = await clickhouse.query({ query: freshnessQuery, format: 'JSONEachRow' });
  const f: any[] = await freshness.json();
  console.log('Wallet last trade:', f[0].last_trade);
}

diagnose().catch(console.error);
