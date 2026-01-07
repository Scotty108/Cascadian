/**
 * Test proxy mappings for specific wallets
 * Then calculate CTF-aware PnL to see if it improves accuracy
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const PROXY_CONTRACTS = [
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',
];

interface ProxyMapping {
  proxy_wallet: string;
  tx_count: number;
  event_types: string[];
}

async function getProxyMappings(wallet: string): Promise<ProxyMapping[]> {
  const proxyList = PROXY_CONTRACTS.map(p => `'${p}'`).join(',');

  const query = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      LIMIT 10000
    )
    SELECT
      lower(user_address) as proxy_wallet,
      count() as tx_count,
      groupArray(DISTINCT event_type) as event_types
    FROM pm_ctf_events
    WHERE tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND lower(user_address) IN (${proxyList})
      AND is_deleted = 0
    GROUP BY lower(user_address)
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as ProxyMapping[];
}

async function getCTFEventsForWallet(wallet: string, proxyWallets: string[]): Promise<any[]> {
  if (proxyWallets.length === 0) return [];

  const proxyList = proxyWallets.map(p => `'${p}'`).join(',');

  // Get CTF events where proxy executed on behalf of this wallet
  // by matching tx_hash between CLOB and CTF events
  const query = `
    WITH wallet_hashes AS (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
    SELECT
      ctf.event_type,
      toFloat64OrZero(ctf.amount_or_payout) / 1e6 as amount,
      ctf.event_timestamp,
      ctf.condition_id,
      ctf.tx_hash
    FROM pm_ctf_events ctf
    WHERE ctf.tx_hash IN (SELECT tx_hash FROM wallet_hashes)
      AND lower(ctf.user_address) IN (${proxyList})
      AND ctf.is_deleted = 0
    ORDER BY ctf.event_timestamp
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return await result.json() as any[];
}

async function main() {
  const testWallets = [
    { name: 'f918', addr: '0xf918977ef9d3f101385eda508621d5f835fa9052', uiPnl: 1.16 },
    { name: 'Lheo', addr: '0x7ad55bf11a52eb0e46b0ee13f53ce52da3fd1d61', uiPnl: 690 },
  ];

  for (const w of testWallets) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${w.name} (${w.addr})`);
    console.log(`UI PnL: $${w.uiPnl.toLocaleString()}`);
    console.log('='.repeat(60));

    // Get proxy mappings
    console.log('\n1. Getting proxy mappings...');
    const start = Date.now();
    const mappings = await getProxyMappings(w.addr);
    console.log(`   Query took ${((Date.now() - start) / 1000).toFixed(1)}s`);

    if (mappings.length === 0) {
      console.log('   No proxy activity found');
      continue;
    }

    console.log('\n   Proxy wallets:');
    for (const m of mappings) {
      console.log(`   - ${m.proxy_wallet.slice(0, 20)}...: ${m.tx_count} txs`);
      console.log(`     Event types: ${m.event_types.join(', ')}`);
    }

    // Get CTF events
    console.log('\n2. Getting CTF events via proxy...');
    const proxyWallets = mappings.map(m => m.proxy_wallet);
    const ctfEvents = await getCTFEventsForWallet(w.addr, proxyWallets);

    console.log(`   Found ${ctfEvents.length} CTF events`);

    // Summarize by event type
    const byType: Record<string, number> = {};
    for (const e of ctfEvents) {
      byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    }
    console.log('\n   By event type:');
    for (const [type, count] of Object.entries(byType)) {
      console.log(`   - ${type}: ${count}`);
    }

    // Show sample events
    console.log('\n   Sample CTF events:');
    for (const e of ctfEvents.slice(0, 5)) {
      console.log(`   - ${e.event_type}: ${e.amount.toFixed(2)} tokens at ${e.event_timestamp}`);
    }

    // Calculate what these CTF events might contribute to PnL
    console.log('\n3. CTF event impact analysis...');

    let splitTokens = 0;
    let mergeTokens = 0;
    let redemptionTokens = 0;

    for (const e of ctfEvents) {
      switch (e.event_type) {
        case 'PositionSplit':
          splitTokens += e.amount;
          break;
        case 'PositionsMerge':
          mergeTokens += e.amount;
          break;
        case 'PayoutRedemption':
          redemptionTokens += e.amount;
          break;
      }
    }

    console.log(`   PositionSplit: ${splitTokens.toFixed(2)} tokens (cost: ~$${(splitTokens * 0.5).toFixed(2)} at 50¢)`);
    console.log(`   PositionsMerge: ${mergeTokens.toFixed(2)} tokens (proceeds: ~$${(mergeTokens * 0.5).toFixed(2)} at 50¢)`);
    console.log(`   PayoutRedemption: ${redemptionTokens.toFixed(2)} tokens (proceeds: depends on resolution)`);
  }
}

main()
  .then(() => { console.log('\n✅ Done!'); process.exit(0); })
  .catch(e => { console.error('Error:', e); process.exit(1); });
