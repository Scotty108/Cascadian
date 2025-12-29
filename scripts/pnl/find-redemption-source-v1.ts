/**
 * Find Redemption Source V1
 *
 * Determine where pm_redemption_payouts_agg gets its data from
 * and why it differs from vw_ctf_ledger.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

// Missing condition_ids (full)
const missingConditions = [
  '764326e4c75fcf9dbcc2dc9a859afa88569db8043aeb88cc15bd87b2ee0ff6d3',
  'a886b40d69b4733df3086a6b3f106ab7aef28acf16070f8e98aa6f7a73b2b2f8',
  '6d250918ac8353e8aedd848e1c0934c033f96f80b83f3a0d8edeff8d9eb7a8a3',
];

async function main() {
  console.log('='.repeat(80));
  console.log('FINDING REDEMPTION DATA SOURCE');
  console.log('='.repeat(80));
  console.log('');

  // 1. Check all pm_ tables for clues
  console.log('--- Tables with redemption data ---');
  const q1 = `SHOW TABLES`;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const allTables = (await r1.json()) as any[];
  const pmTables = allTables
    .map((t) => t.name || Object.values(t)[0])
    .filter((name: string) => name.includes('redemption') || name.includes('payout'));
  console.log('Tables with redemption/payout:', pmTables.join(', '));

  // 2. Check pm_erc1155_transfers schema
  console.log('');
  console.log('--- pm_erc1155_transfers schema ---');
  const q2 = `DESCRIBE TABLE pm_erc1155_transfers`;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const schema2 = (await r2.json()) as any[];
  for (const col of schema2) {
    console.log('  ' + col.name + ': ' + col.type);
  }

  // 3. Count ERC1155 redemptions for this wallet
  console.log('');
  console.log('--- ERC1155 redemptions (burns to zero address) ---');
  const q3 = `
    SELECT
      count(*) as events,
      countDistinct(token_id) as unique_tokens
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = lower('${WALLET}')
      AND to_address = '0x0000000000000000000000000000000000000000'
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const burns = (await r3.json()) as any[];
  console.log('Burn events:', burns[0]?.events);
  console.log('Unique tokens burned:', burns[0]?.unique_tokens);

  // 4. Check pm_ctf_flows_inferred source
  console.log('');
  console.log('--- pm_ctf_flows_inferred source (view definition) ---');
  const q4 = `SHOW CREATE TABLE pm_ctf_flows_inferred`;
  const r4 = await clickhouse.query({ query: q4, format: 'TabSeparatedRaw' });
  const viewDef = await r4.text();
  console.log(viewDef.slice(0, 800));

  // 5. Check what wallets have flows for the missing condition
  console.log('');
  console.log('--- Wallets with flows for missing condition 764326... ---');
  const q5 = `
    SELECT
      wallet,
      count(*) as flows,
      sum(usdc_delta) as total_usdc
    FROM pm_ctf_flows_inferred
    WHERE condition_id = '${missingConditions[0]}'
      AND is_deleted = 0
    GROUP BY wallet
    ORDER BY flows DESC
    LIMIT 10
  `;
  const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
  const walletFlows = (await r5.json()) as any[];
  console.log('Wallets found:', walletFlows.length);
  for (const w of walletFlows) {
    console.log(
      '  ' +
        w.wallet +
        ' | flows: ' +
        w.flows +
        ' | usdc: $' +
        Number(w.total_usdc).toFixed(2)
    );
  }

  // 6. Check if wallet has ANY data in ERC1155 transfers
  console.log('');
  console.log('--- All ERC1155 activity for wallet ---');
  const q6 = `
    SELECT
      from_address = lower('${WALLET}') as is_sender,
      to_address = lower('${WALLET}') as is_receiver,
      count(*) as events
    FROM pm_erc1155_transfers
    WHERE lower(from_address) = lower('${WALLET}')
       OR lower(to_address) = lower('${WALLET}')
    GROUP BY is_sender, is_receiver
  `;
  const r6 = await clickhouse.query({ query: q6, format: 'JSONEachRow' });
  const erc1155Activity = (await r6.json()) as any[];
  for (const a of erc1155Activity) {
    console.log(
      '  sender=' +
        a.is_sender +
        ' receiver=' +
        a.is_receiver +
        ' events=' +
        a.events
    );
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log('');
  console.log('pm_redemption_payouts_agg appears to be aggregated from a different source');
  console.log('than pm_ctf_flows_inferred. Need to trace the data pipeline.');
}

main().catch(console.error);
