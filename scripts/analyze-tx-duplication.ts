/**
 * Analyze transaction duplication in ledger
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  const wallet = '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae';
  const tx = '0x8d27325e30ffe6d4eb4e94e4bd5a5fb95be2b12d256e91c3f35f6ca1abc97b10';

  console.log('TRANSACTION FLOW ANALYSIS');
  console.log('═'.repeat(70));
  console.log('tx_hash: ' + tx);

  // Get ALL ledger entries for this tx
  const ledgerResult = await client.query({
    query: `
      SELECT event_type, token_id, outcome_index, token_delta, usdc_delta
      FROM pm_wallet_token_ledger_v1
      WHERE wallet = '${wallet}' AND tx_hash = '${tx}'
      ORDER BY event_type
    `,
    format: 'JSONEachRow'
  });
  const ledgerEntries = await ledgerResult.json() as any[];

  console.log('\nLedger entries for Latina:');
  for (const e of ledgerEntries) {
    console.log(`  ${e.event_type.padEnd(12)} | outcome=${e.outcome_index} | tokens=${Number(e.token_delta).toFixed(0).padStart(8)} | usdc=$${Number(e.usdc_delta).toFixed(0)}`);
  }

  // Get CTF events in same transaction
  const ctfResult = await client.query({
    query: `
      SELECT event_type, user_address, condition_id, amount_or_payout
      FROM pm_ctf_events
      WHERE tx_hash = '${tx}' AND is_deleted = 0
      ORDER BY event_type
    `,
    format: 'JSONEachRow'
  });
  const ctfEvents = await ctfResult.json() as any[];

  console.log('\nCTF Events in this transaction:');
  for (const e of ctfEvents) {
    const isLatina = e.user_address.toLowerCase() === wallet.toLowerCase() ? 'LATINA' : 'PROXY';
    console.log(`  ${e.event_type.padEnd(16)} | ${isLatina.padEnd(6)} | ${e.user_address.slice(0,12)}... | amount=${e.amount_or_payout}`);
  }

  // Get CLOB fills
  const clobResult = await client.query({
    query: `
      SELECT side, usdc_amount, token_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${wallet}'
        AND tx_hash = '${tx}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const clobFills = await clobResult.json() as any[];

  console.log('\nCLOB Fills for Latina:');
  for (const f of clobFills) {
    console.log(`  ${f.side.padEnd(4)} | tokens=${Number(f.token_amount).toFixed(0)} | usdc=$${Number(f.usdc_amount).toFixed(0)}`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('ANALYSIS:');
  console.log('═'.repeat(70));

  const proxyEvents = ctfEvents.filter((e: any) => e.user_address.toLowerCase() !== wallet.toLowerCase());
  const latinaEvents = ctfEvents.filter((e: any) => e.user_address.toLowerCase() === wallet.toLowerCase());
  const splitEntries = ledgerEntries.filter((e: any) => e.event_type === 'split_buy');
  const clobEntries = ledgerEntries.filter((e: any) => e.event_type.startsWith('clob'));

  console.log(`CTF events by PROXY: ${proxyEvents.length}`);
  console.log(`CTF events by LATINA: ${latinaEvents.length}`);
  console.log(`Ledger split_buy entries: ${splitEntries.length}`);
  console.log(`Ledger clob entries: ${clobEntries.length}`);

  if (proxyEvents.length > 0 && splitEntries.length > 0) {
    console.log('\n⚠️  BUG CONFIRMED: Proxy splits are being attributed to Latina!');
    console.log('   The ledger is double-counting: CLOB fills + Proxy splits');
  }

  // Calculate duplication impact
  console.log('\n' + '─'.repeat(70));
  console.log('DUPLICATION IMPACT:');

  const splitTokens = splitEntries.reduce((sum: number, e: any) => sum + Number(e.token_delta), 0);
  const splitUsdc = splitEntries.reduce((sum: number, e: any) => sum + Number(e.usdc_delta), 0);
  const clobTokens = clobEntries.reduce((sum: number, e: any) => sum + Number(e.token_delta), 0);
  const clobUsdc = clobEntries.reduce((sum: number, e: any) => sum + Number(e.usdc_delta), 0);

  console.log(`  Split totals:  ${splitTokens.toFixed(0)} tokens, $${splitUsdc.toFixed(0)} USDC`);
  console.log(`  CLOB totals:   ${clobTokens.toFixed(0)} tokens, $${clobUsdc.toFixed(0)} USDC`);
  console.log(`  Combined:      ${(splitTokens + clobTokens).toFixed(0)} tokens, $${(splitUsdc + clobUsdc).toFixed(0)} USDC`);

  // What actually happened economically?
  console.log('\n' + '─'.repeat(70));
  console.log('CORRECT ECONOMIC VIEW:');
  console.log('  Latina traded via CLOB only. Proxy handled split internally.');
  console.log('  Latina\'s REAL position change = CLOB fills only');

  await client.close();
}
main().catch(console.error);
