#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  console.log('MARKET STATUS VERIFICATION - Sample Check\n');
  console.log('='.repeat(80));
  
  // Get 5 unmatched markets with most recent activity
  const recentUnmatched = await client.query({
    query: `
      SELECT
        t.condition_id,
        count() as trade_count,
        sum(t.usd_value) as total_usd,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade,
        dateDiff('day', max(t.timestamp), now()) as days_since_last_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
        AND t.condition_id != ''
        AND t.condition_id NOT LIKE 'token_%'
      GROUP BY t.condition_id
      ORDER BY last_trade DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const recent = await recentUnmatched.json<any>();
  
  console.log('TOP 5 MOST RECENT UNMATCHED MARKETS:\n');
  recent.forEach((m: any, i: number) => {
    console.log(`${i + 1}. ${m.condition_id}`);
    console.log(`   Trades: ${parseInt(m.trade_count).toLocaleString()}`);
    console.log(`   Volume: $${parseFloat(m.total_usd).toLocaleString()}`);
    console.log(`   Last trade: ${m.last_trade} (${m.days_since_last_trade} days ago)`);
    console.log(`   Active period: ${m.first_trade} to ${m.last_trade}`);
    console.log('');
  });

  console.log('='.repeat(80));
  console.log('\nHYPOTHESIS TEST:\n');
  
  // Check if recent unmatched markets are likely OPEN
  const recentCheck = recent[0];
  if (recentCheck && parseInt(recentCheck.days_since_last_trade) < 30) {
    console.log('The most recent unmatched market had trades only ' + recentCheck.days_since_last_trade + ' days ago.');
    console.log('This supports the hypothesis that unmatched markets are OPEN (not yet resolved).\n');
  }

  // Now check oldest unmatched markets
  const oldUnmatched = await client.query({
    query: `
      SELECT
        t.condition_id,
        count() as trade_count,
        sum(t.usd_value) as total_usd,
        min(t.timestamp) as first_trade,
        max(t.timestamp) as last_trade,
        dateDiff('day', max(t.timestamp), now()) as days_since_last_trade
      FROM trades_raw t
      LEFT JOIN market_resolutions_final m
        ON lower(replaceAll(t.condition_id, '0x', '')) = m.condition_id_norm
      WHERE m.condition_id_norm IS NULL
        AND t.condition_id != ''
        AND t.condition_id NOT LIKE 'token_%'
      GROUP BY t.condition_id
      ORDER BY last_trade ASC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const old = await oldUnmatched.json<any>();
  
  console.log('='.repeat(80));
  console.log('TOP 5 OLDEST UNMATCHED MARKETS:\n');
  old.forEach((m: any, i: number) => {
    console.log(`${i + 1}. ${m.condition_id}`);
    console.log(`   Trades: ${parseInt(m.trade_count).toLocaleString()}`);
    console.log(`   Volume: $${parseFloat(m.total_usd).toLocaleString()}`);
    console.log(`   Last trade: ${m.last_trade} (${m.days_since_last_trade} days ago)`);
    console.log(`   Active period: ${m.first_trade} to ${m.last_trade}`);
    console.log('');
  });

  console.log('='.repeat(80));
  console.log('\nANALYSIS:\n');
  
  const oldestDays = parseInt(old[0]?.days_since_last_trade || 0);
  const newestDays = parseInt(recent[0]?.days_since_last_trade || 0);
  
  console.log(`Oldest unmatched: ${oldestDays} days since last trade`);
  console.log(`Newest unmatched: ${newestDays} days since last trade`);
  
  if (oldestDays > 90) {
    console.log('\nWARNING: Some unmatched markets are very old (>90 days).');
    console.log('These should likely have resolutions by now - possible data gap.');
  } else {
    console.log('\nAll unmatched markets are relatively recent (<90 days).');
    console.log('This supports the hypothesis that they are OPEN markets.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDED NEXT STEP:\n');
  console.log('Query Polymarket API to check the status of these specific condition_ids:');
  recent.slice(0, 3).forEach((m: any, i: number) => {
    console.log(`  ${i + 1}. ${m.condition_id}`);
  });
  console.log('\nAPI endpoint: https://clob.polymarket.com/markets/{condition_id}');
  console.log('Check field: "closed" (true/false) to determine if market is closed');
}

main().catch(console.error);
