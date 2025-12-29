/**
 * Check Data Sources for Gap Tokens
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main(): Promise<void> {
  const gapTokenDecimal = '51732369759485831403803083405750003273802367735976539629974943817815232241664';
  const w1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

  console.log('=== CHECKING CTF EVENTS FOR GAP TOKEN ===\n');

  // First see what columns pm_ctf_events has
  const desc = await clickhouse.query({
    query: 'DESCRIBE pm_ctf_events',
    format: 'JSONEachRow',
  });
  const cols = (await desc.json()) as any[];
  console.log('CTF event columns:');
  for (const c of cols) {
    console.log(`  ${c.name}: ${c.type}`);
  }

  // Check for token in token_id_yes or token_id_no
  console.log('\n=== SEARCHING CTF FOR GAP TOKEN ===\n');
  console.log('Gap token (decimal):', gapTokenDecimal.substring(0, 30) + '...');

  const ctfSearch = await clickhouse.query({
    query: `
      SELECT
        event_type,
        stakeholder,
        amount / 1e6 as tokens,
        block_timestamp
      FROM pm_ctf_events
      WHERE token_id_yes = {token:String} OR token_id_no = {token:String}
      LIMIT 10
    `,
    query_params: { token: gapTokenDecimal },
    format: 'JSONEachRow',
  });
  const ctfRows = (await ctfSearch.json()) as any[];
  console.log(`Found ${ctfRows.length} CTF events with this token`);
  for (const r of ctfRows) {
    console.log(
      `  ${r.event_type}: ${r.tokens} tokens, stakeholder: ${r.stakeholder.substring(0, 12)}..., time: ${r.block_timestamp}`
    );
  }

  // Check contract address in pm_erc1155_transfers
  console.log('\n=== ERC1155 CONTRACTS ===\n');
  const contracts = await clickhouse.query({
    query: `
      SELECT
        contract,
        count() as transfers
      FROM pm_erc1155_transfers
      GROUP BY contract
      ORDER BY transfers DESC
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const contractRows = (await contracts.json()) as any[];
  for (const r of contractRows) {
    console.log(`${r.contract}: ${r.transfers} transfers`);
  }

  // Check the time range more precisely
  console.log('\n=== ERC1155 TIME COVERAGE ===\n');
  const coverage = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(block_timestamp) as month,
        count() as transfers
      FROM pm_erc1155_transfers
      WHERE block_timestamp > '2024-01-01'
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow',
  });
  const coverageRows = (await coverage.json()) as any[];
  for (const r of coverageRows) {
    console.log(`${r.month}: ${r.transfers} transfers`);
  }

  // Check what date the gap redemption happened
  console.log('\n=== GAP TOKEN REDEMPTION TIME ===\n');
  const redemption = await clickhouse.query({
    query: `
      SELECT
        event_type,
        stakeholder,
        amount / 1e6 as tokens,
        block_timestamp,
        block_number
      FROM pm_ctf_events
      WHERE (token_id_yes = {token:String} OR token_id_no = {token:String})
        AND lower(stakeholder) = lower({wallet:String})
      ORDER BY block_number
    `,
    query_params: { token: gapTokenDecimal, wallet: w1 },
    format: 'JSONEachRow',
  });
  const redemptionRows = (await redemption.json()) as any[];
  console.log(`Found ${redemptionRows.length} CTF events for W1 with gap token`);
  for (const r of redemptionRows) {
    console.log(`  ${r.event_type}: ${r.tokens} tokens, time: ${r.block_timestamp}`);
  }

  // Check if token exists anywhere in ERC1155
  console.log('\n=== TOTAL ERC1155 TRANSFERS FOR GAP TOKEN ===\n');
  const gapTokenHex = '0x' + BigInt(gapTokenDecimal).toString(16);
  console.log('Token hex:', gapTokenHex);

  const total = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_erc1155_transfers
      WHERE lower(token_id) = lower({tokenHex:String})
    `,
    query_params: { tokenHex: gapTokenHex },
    format: 'JSONEachRow',
  });
  const totalRow = (await total.json())[0] as any;
  console.log('Total transfers:', totalRow.cnt);

  // If 0, check if ANY Polymarket token is in this table
  console.log('\n=== CHECK IF ANY CLOB TOKENS ARE IN ERC1155 ===\n');
  const sampleClob = await clickhouse.query({
    query: `
      SELECT token_id
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const clobTokens = (await sampleClob.json()) as any[];

  let found = 0;
  for (const t of clobTokens) {
    const hex = '0x' + BigInt(t.token_id).toString(16);
    const check = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_erc1155_transfers WHERE lower(token_id) = lower({h:String})`,
      query_params: { h: hex },
      format: 'JSONEachRow',
    });
    const cnt = ((await check.json())[0] as any).cnt;
    if (cnt > 0) {
      found++;
      console.log(`  Token ${t.token_id.substring(0, 20)}... -> ${cnt} ERC1155 transfers`);
    }
  }
  console.log(`\nFound ${found}/${clobTokens.length} CLOB tokens in ERC1155 table`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
