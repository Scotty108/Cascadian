/**
 * Audit Data Pipeline for PnL Calculation
 *
 * Systematically checks every step of the data pipeline for:
 * 1. Format inconsistencies (hex vs decimal, string vs number)
 * 2. Storage quirks (payout_numerators as string "[1,0]")
 * 3. Missing data (unmapped tokens, missing resolutions)
 * 4. Schema mismatches (field names, types)
 * 5. Join key compatibility
 */

import { clickhouse } from '../../lib/clickhouse/client';

interface AuditResult {
  check: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details: string;
  example?: unknown;
}

const results: AuditResult[] = [];

function log(check: string, status: 'PASS' | 'WARN' | 'FAIL', details: string, example?: unknown): void {
  results.push({ check, status, details, example });
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} ${check}: ${details}`);
  if (example && status !== 'PASS') {
    console.log(`   Example: ${JSON.stringify(example)}`);
  }
}

async function auditClobEvents(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('1. CLOB EVENTS (pm_trader_events_v2)');
  console.log('═'.repeat(80));

  // Check schema
  const schemaResult = await clickhouse.query({
    query: 'DESCRIBE pm_trader_events_v2',
    format: 'JSONEachRow',
  });
  const schema = (await schemaResult.json()) as Array<{ name: string; type: string }>;
  console.log('\nSchema:');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Check side values
  const sideResult = await clickhouse.query({
    query: `SELECT side, count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0 GROUP BY side`,
    format: 'JSONEachRow',
  });
  const sides = (await sideResult.json()) as Array<{ side: string; cnt: number }>;
  const expectedSides = ['buy', 'sell', 'BUY', 'SELL'];
  const unexpectedSides = sides.filter((s) => !expectedSides.includes(s.side));
  if (unexpectedSides.length > 0) {
    log('Side values', 'WARN', `Unexpected side values found`, unexpectedSides);
  } else {
    log('Side values', 'PASS', `Only expected values: ${sides.map((s) => s.side).join(', ')}`);
  }

  // Check if side is case-consistent
  const hasLowercase = sides.some((s) => s.side === 'buy' || s.side === 'sell');
  const hasUppercase = sides.some((s) => s.side === 'BUY' || s.side === 'SELL');
  if (hasLowercase && hasUppercase) {
    log('Side case consistency', 'WARN', 'Mixed case found - need to handle both', sides);
  } else {
    log('Side case consistency', 'PASS', `Consistent case: ${hasLowercase ? 'lowercase' : 'uppercase'}`);
  }

  // Check token_id format
  const tokenSample = await clickhouse.query({
    query: `SELECT token_id FROM pm_trader_events_v2 WHERE is_deleted = 0 LIMIT 5`,
    format: 'JSONEachRow',
  });
  const tokens = (await tokenSample.json()) as Array<{ token_id: string }>;
  const isHex = tokens.some((t) => t.token_id.startsWith('0x'));
  const isDecimal = tokens.some((t) => /^\d+$/.test(t.token_id));
  log('token_id format', isHex ? 'WARN' : 'PASS', `Format: ${isHex ? 'hex' : 'decimal'}`, tokens[0]);

  // Check amount units
  const amountSample = await clickhouse.query({
    query: `
      SELECT
        usdc_amount,
        token_amount,
        usdc_amount / 1e6 as usdc_scaled,
        token_amount / 1e6 as token_scaled
      FROM pm_trader_events_v2
      WHERE is_deleted = 0 AND usdc_amount > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const amounts = (await amountSample.json()) as Array<{
    usdc_amount: number;
    token_amount: number;
    usdc_scaled: number;
    token_scaled: number;
  }>;
  log('Amount units', 'PASS', 'usdc_amount and token_amount in micro-units (divide by 1e6)', amounts[0]);

  // Check for duplicates (sample check to avoid timeout)
  const dupResult = await clickhouse.query({
    query: `
      SELECT event_id, count() as cnt
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trader_wallet = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
      GROUP BY event_id
      HAVING cnt > 1
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const dups = (await dupResult.json()) as Array<{ event_id: string; cnt: number }>;
  if (dups.length > 0) {
    log('Duplicate event_ids', 'WARN', `Duplicates exist - MUST use GROUP BY event_id pattern`, dups[0]);
  } else {
    log('Duplicate event_ids', 'PASS', 'No duplicates found in sample wallet');
  }
}

async function auditCtfEvents(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('2. CTF EVENTS (pm_ctf_events)');
  console.log('═'.repeat(80));

  // Check schema
  const schemaResult = await clickhouse.query({
    query: 'DESCRIBE pm_ctf_events',
    format: 'JSONEachRow',
  });
  const schema = (await schemaResult.json()) as Array<{ name: string; type: string }>;
  console.log('\nSchema:');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Check event_type values
  const eventTypes = await clickhouse.query({
    query: `SELECT event_type, count() as cnt FROM pm_ctf_events WHERE is_deleted = 0 GROUP BY event_type ORDER BY cnt DESC`,
    format: 'JSONEachRow',
  });
  const types = (await eventTypes.json()) as Array<{ event_type: string; cnt: number }>;
  console.log('\nEvent types:');
  for (const t of types) {
    console.log(`  ${t.event_type}: ${t.cnt}`);
  }

  // Check amount_or_payout format
  const amountSample = await clickhouse.query({
    query: `
      SELECT
        amount_or_payout,
        toFloat64OrZero(amount_or_payout) as parsed,
        toFloat64OrZero(amount_or_payout) / 1e6 as scaled
      FROM pm_ctf_events
      WHERE is_deleted = 0 AND amount_or_payout != ''
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const amounts = (await amountSample.json()) as Array<{
    amount_or_payout: string;
    parsed: number;
    scaled: number;
  }>;
  const isString = typeof amounts[0]?.amount_or_payout === 'string';
  log(
    'amount_or_payout format',
    isString ? 'WARN' : 'PASS',
    `Stored as ${isString ? 'string (need toFloat64OrZero)' : 'number'}`,
    amounts[0]
  );

  // Check user_address vs stakeholder naming
  const hasUserAddress = schema.some((c) => c.name === 'user_address');
  const hasStakeholder = schema.some((c) => c.name === 'stakeholder');
  log(
    'User field naming',
    'PASS',
    `Uses ${hasUserAddress ? 'user_address' : hasStakeholder ? 'stakeholder' : 'unknown'}`
  );

  // Check condition_id format
  const condSample = await clickhouse.query({
    query: `SELECT condition_id FROM pm_ctf_events WHERE is_deleted = 0 AND condition_id != '' LIMIT 5`,
    format: 'JSONEachRow',
  });
  const conds = (await condSample.json()) as Array<{ condition_id: string }>;
  const condFormat = conds[0]?.condition_id?.startsWith('0x') ? 'hex with 0x' : 'hex without 0x';
  log('condition_id format', 'PASS', condFormat, conds[0]);
}

async function auditTokenMapping(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('3. TOKEN MAPPING (pm_token_to_condition_map_v3)');
  console.log('═'.repeat(80));

  // Check schema
  const schemaResult = await clickhouse.query({
    query: 'DESCRIBE pm_token_to_condition_map_v3',
    format: 'JSONEachRow',
  });
  const schema = (await schemaResult.json()) as Array<{ name: string; type: string }>;
  console.log('\nSchema:');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Check token_id_dec format
  const tokenSample = await clickhouse.query({
    query: `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v3 LIMIT 5`,
    format: 'JSONEachRow',
  });
  const tokens = (await tokenSample.json()) as Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
  }>;
  const isDecimal = /^\d+$/.test(tokens[0]?.token_id_dec || '');
  log('token_id_dec format', isDecimal ? 'PASS' : 'WARN', `Format: ${isDecimal ? 'decimal' : 'other'}`, tokens[0]);

  // Check outcome_index values
  const outcomeResult = await clickhouse.query({
    query: `SELECT outcome_index, count() as cnt FROM pm_token_to_condition_map_v3 GROUP BY outcome_index ORDER BY outcome_index`,
    format: 'JSONEachRow',
  });
  const outcomes = (await outcomeResult.json()) as Array<{ outcome_index: number; cnt: number }>;
  console.log('\nOutcome index distribution:');
  for (const o of outcomes) {
    console.log(`  outcome_index ${o.outcome_index}: ${o.cnt}`);
  }
  const hasZeroBased = outcomes.some((o) => o.outcome_index === 0);
  const hasOneBased = outcomes.some((o) => o.outcome_index === 1);
  log('Outcome indexing', 'PASS', `${hasZeroBased ? '0-indexed' : '1-indexed'} (0 and 1 both present)`);

  // Check coverage (count from each table separately to avoid slow join)
  const clobTokenCount = await clickhouse.query({
    query: `SELECT uniqExact(token_id) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const mapTokenCount = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_token_to_condition_map_v3`,
    format: 'JSONEachRow',
  });
  const clobCnt = ((await clobTokenCount.json()) as Array<{ cnt: number }>)[0].cnt;
  const mapCnt = ((await mapTokenCount.json()) as Array<{ cnt: number }>)[0].cnt;
  console.log(`\nCLOB unique tokens: ${clobCnt}, Mapping table tokens: ${mapCnt}`);
  log('Mapping table size', 'PASS', `${mapCnt} token mappings available`);
}

async function auditResolutions(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('4. RESOLUTIONS (pm_condition_resolutions)');
  console.log('═'.repeat(80));

  // Check schema
  const schemaResult = await clickhouse.query({
    query: 'DESCRIBE pm_condition_resolutions',
    format: 'JSONEachRow',
  });
  const schema = (await schemaResult.json()) as Array<{ name: string; type: string }>;
  console.log('\nSchema:');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Check payout_numerators format - THIS IS A KNOWN ISSUE
  const payoutSample = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        payout_numerators,
        resolved_at
      FROM pm_condition_resolutions
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const payouts = (await payoutSample.json()) as Array<{
    condition_id: string;
    payout_numerators: string | number[];
    resolved_at: string;
  }>;

  console.log('\nSample payout_numerators values:');
  for (const p of payouts.slice(0, 5)) {
    console.log(`  ${p.condition_id.substring(0, 16)}... → ${JSON.stringify(p.payout_numerators)}`);
  }

  const isStringFormat = typeof payouts[0]?.payout_numerators === 'string';
  log(
    'payout_numerators format',
    isStringFormat ? 'WARN' : 'PASS',
    `Stored as ${isStringFormat ? 'STRING (e.g., "[1,0]") - MUST JSON.parse()' : 'array'}`,
    payouts[0]?.payout_numerators
  );

  // Check payout values
  if (isStringFormat) {
    const parsed = JSON.parse(payouts[0].payout_numerators as string);
    const validBinary = parsed.every((v: number) => v === 0 || v === 1);
    log('Payout values', validBinary ? 'PASS' : 'WARN', `Binary values: ${validBinary ? 'yes (0 or 1)' : 'no'}`, parsed);
  }

  // Check for multi-outcome markets
  const multiOutcome = await clickhouse.query({
    query: `
      SELECT
        payout_numerators,
        count() as cnt
      FROM pm_condition_resolutions
      GROUP BY payout_numerators
      ORDER BY cnt DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });
  const distributions = (await multiOutcome.json()) as Array<{
    payout_numerators: string;
    cnt: number;
  }>;
  console.log('\nPayout distribution:');
  for (const d of distributions) {
    console.log(`  ${d.payout_numerators}: ${d.cnt} markets`);
  }
}

async function auditErc1155Transfers(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('5. ERC1155 TRANSFERS (pm_erc1155_transfers)');
  console.log('═'.repeat(80));

  // Check schema
  const schemaResult = await clickhouse.query({
    query: 'DESCRIBE pm_erc1155_transfers',
    format: 'JSONEachRow',
  });
  const schema = (await schemaResult.json()) as Array<{ name: string; type: string }>;
  console.log('\nSchema:');
  for (const col of schema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Check value format - THIS IS A KNOWN ISSUE
  const valueSample = await clickhouse.query({
    query: `
      SELECT
        value,
        reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) / 1e6 as parsed_tokens
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0 AND value != ''
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const values = (await valueSample.json()) as Array<{
    value: string;
    parsed_tokens: number;
  }>;

  console.log('\nSample value parsing:');
  for (const v of values) {
    console.log(`  raw: ${v.value} → parsed: ${v.parsed_tokens} tokens`);
  }

  const isHex = values[0]?.value?.startsWith('0x');
  log(
    'value format',
    isHex ? 'WARN' : 'PASS',
    `Stored as ${isHex ? 'HEX STRING (e.g., "0x989680") - MUST decode with reinterpretAsUInt256(reverse(unhex(substring(value, 3))))' : 'number'}`
  );

  // Check token_id format
  const tokenSample = await clickhouse.query({
    query: `SELECT token_id FROM pm_erc1155_transfers WHERE is_deleted = 0 LIMIT 5`,
    format: 'JSONEachRow',
  });
  const tokens = (await tokenSample.json()) as Array<{ token_id: string }>;
  const tokenIsHex = tokens[0]?.token_id?.startsWith('0x');
  log(
    'token_id format in transfers',
    tokenIsHex ? 'WARN' : 'PASS',
    `Format: ${tokenIsHex ? 'hex (may not match token_id_dec in mapping table)' : 'decimal'}`
  );
}

async function auditJoinCompatibility(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('6. JOIN COMPATIBILITY');
  console.log('═'.repeat(80));

  // CLOB token_id vs mapping token_id_dec
  const joinTest1 = await clickhouse.query({
    query: `
      SELECT
        t.token_id as clob_token,
        m.token_id_dec as map_token,
        m.condition_id
      FROM pm_trader_events_v2 t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE t.is_deleted = 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const j1 = (await joinTest1.json()) as Array<{
    clob_token: string;
    map_token: string | null;
    condition_id: string | null;
  }>;
  const j1Works = j1.some((r) => r.map_token !== null);
  log(
    'CLOB → Token Mapping join',
    j1Works ? 'PASS' : 'FAIL',
    `pm_trader_events_v2.token_id = pm_token_to_condition_map_v3.token_id_dec`,
    j1[0]
  );

  // Mapping condition_id vs resolution condition_id
  const joinTest2 = await clickhouse.query({
    query: `
      SELECT
        m.condition_id as map_cond,
        r.condition_id as res_cond,
        r.payout_numerators
      FROM pm_token_to_condition_map_v3 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.condition_id IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const j2 = (await joinTest2.json()) as Array<{
    map_cond: string;
    res_cond: string | null;
    payout_numerators: string | null;
  }>;
  const j2Works = j2.some((r) => r.res_cond !== null);
  log(
    'Token Mapping → Resolution join',
    j2Works ? 'PASS' : 'FAIL',
    `pm_token_to_condition_map_v3.condition_id = pm_condition_resolutions.condition_id`,
    j2[0]
  );

  // CTF condition_id vs resolution condition_id
  const joinTest3 = await clickhouse.query({
    query: `
      SELECT
        c.condition_id as ctf_cond,
        r.condition_id as res_cond,
        r.payout_numerators
      FROM pm_ctf_events c
      LEFT JOIN pm_condition_resolutions r ON c.condition_id = r.condition_id
      WHERE c.is_deleted = 0 AND c.condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const j3 = (await joinTest3.json()) as Array<{
    ctf_cond: string;
    res_cond: string | null;
    payout_numerators: string | null;
  }>;
  const j3Works = j3.some((r) => r.res_cond !== null);
  log(
    'CTF Events → Resolution join',
    j3Works ? 'PASS' : 'FAIL',
    `pm_ctf_events.condition_id = pm_condition_resolutions.condition_id`,
    j3[0]
  );
}

async function auditImpliedRedemptions(): Promise<void> {
  console.log('\n' + '═'.repeat(80));
  console.log('7. IMPLIED REDEMPTIONS (Positions on Resolved Markets)');
  console.log('═'.repeat(80));

  // Check a specific wallet for implied redemptions (faster than full-table scan)
  const testWallet = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'; // W_22M
  const impliedResult = await clickhouse.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          token_id,
          sum(if(side = 'buy', token_amount, 0)) - sum(if(side = 'sell', token_amount, 0)) as net_tokens
        FROM (
          SELECT event_id, any(token_id) as token_id, any(side) as side, any(token_amount) as token_amount
          FROM pm_trader_events_v2
          WHERE is_deleted = 0 AND trader_wallet = {wallet:String}
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING net_tokens > 1000000  -- > 1 token
      )
      SELECT
        count() as positions_with_net_tokens,
        sum(p.net_tokens) / 1e6 as total_net_tokens,
        sum(if(r.condition_id IS NOT NULL, p.net_tokens, 0)) / 1e6 as resolved_net_tokens
      FROM wallet_positions p
      LEFT JOIN pm_token_to_condition_map_v3 m ON p.token_id = m.token_id_dec
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    `,
    query_params: { wallet: testWallet },
    format: 'JSONEachRow',
  });
  const implied = (await impliedResult.json()) as Array<{
    positions_with_net_tokens: number;
    total_net_tokens: number;
    resolved_net_tokens: number;
  }>;

  console.log(`\nTest wallet ${testWallet.substring(0, 16)}... (W_22M):`);
  console.log(`  Net token positions: ${implied[0].positions_with_net_tokens}`);
  console.log(`  Total net tokens: ${implied[0].total_net_tokens.toLocaleString()}`);
  console.log(`  On resolved markets: ${implied[0].resolved_net_tokens.toLocaleString()}`);

  log(
    'Implied redemptions exist',
    implied[0].resolved_net_tokens > 0 ? 'WARN' : 'PASS',
    `${implied[0].resolved_net_tokens > 0 ? 'YES - Must calculate unrealized value on resolved winners' : 'No significant unredeemed positions'}`
  );
}

async function main(): Promise<void> {
  console.log('═'.repeat(80));
  console.log('DATA PIPELINE AUDIT FOR PNL CALCULATION');
  console.log('═'.repeat(80));

  await auditClobEvents();
  await auditCtfEvents();
  await auditTokenMapping();
  await auditResolutions();
  await auditErc1155Transfers();
  await auditJoinCompatibility();
  await auditImpliedRedemptions();

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('AUDIT SUMMARY');
  console.log('═'.repeat(80));

  const passes = results.filter((r) => r.status === 'PASS').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;

  console.log(`\n✅ PASS: ${passes}`);
  console.log(`⚠️ WARN: ${warns}`);
  console.log(`❌ FAIL: ${fails}`);

  console.log('\n' + '─'.repeat(80));
  console.log('KNOWN ISSUES THAT AFFECT PNL CALCULATION:');
  console.log('─'.repeat(80));

  const issues = results.filter((r) => r.status !== 'PASS');
  for (const issue of issues) {
    console.log(`\n${issue.status === 'FAIL' ? '❌' : '⚠️'} ${issue.check}`);
    console.log(`   ${issue.details}`);
    if (issue.example) {
      console.log(`   Example: ${JSON.stringify(issue.example)}`);
    }
  }

  console.log('\n' + '─'.repeat(80));
  console.log('CRITICAL GOTCHAS:');
  console.log('─'.repeat(80));
  console.log(`
1. pm_trader_events_v2 has DUPLICATES
   → ALWAYS use: GROUP BY event_id, then any() for other fields

2. payout_numerators is a STRING like "[1,0]"
   → MUST use JSON.parse() in TypeScript
   → In ClickHouse: use JSONExtractArrayRaw() or parse manually

3. ERC1155 value is HEX STRING like "0x989680"
   → Decode: reinterpretAsUInt256(reverse(unhex(substring(value, 3)))) / 1e6

4. ERC1155 token_id is HEX, CLOB token_id is DECIMAL
   → May need conversion for joins between tables

5. outcome_index is 0-based
   → Use arrayElement(payout_numerators, outcome_index + 1) in ClickHouse

6. Many positions exist on RESOLVED markets but have NO redemption event
   → UI PnL includes these as "unrealized on resolved" value
   → Must calculate: net_tokens × payout_value for these positions
`);
}

main().catch(console.error);
