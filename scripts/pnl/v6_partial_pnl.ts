import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 300000
});

const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

// Convert decimal token_id to hex format (matching ERC1155)
function decToHex(dec: string): string {
  return '0x' + BigInt(dec).toString(16);
}

// Convert hex token_id to decimal format (matching CLOB)
function hexToDec(hex: string): string {
  return BigInt(hex).toString();
}

async function main() {
  console.log('=== STEP 3: V6 PARTIAL PnL ON OVERLAPPING TOKENS ===');
  console.log('');
  console.log('Token ID Format: CLOB uses decimal, ERC1155 uses hex');
  console.log('Converting CLOB decimal -> hex for matching');
  console.log('');

  // Get all CLOB tokens for W1
  console.log('Getting CLOB tokens for W1...');
  const clobResult = await client.query({
    query: `
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${W1}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const clobTokensDec = (await clobResult.json() as any[]).map(r => r.token_id);
  console.log(`Found ${clobTokensDec.length} CLOB tokens for W1`);

  // Convert to hex for ERC1155 lookup
  const clobTokensHex = clobTokensDec.map(decToHex);

  // Get ERC1155 tokens for W1 (already in hex)
  console.log('Getting ERC1155 tokens for W1...');
  const ercResult = await client.query({
    query: `
      SELECT DISTINCT token_id
      FROM pm_erc1155_transfers
      WHERE lower(to_address) = '${W1}' OR lower(from_address) = '${W1}'
    `,
    format: 'JSONEachRow'
  });
  const ercTokensHex = (await ercResult.json() as any[]).map(r => r.token_id);
  console.log(`Found ${ercTokensHex.length} ERC1155 tokens for W1`);
  console.log('');

  // Find overlap (comparing hex to hex)
  const overlappingHex = clobTokensHex.filter(hex => ercTokensHex.includes(hex));
  console.log(`Found ${overlappingHex.length} tokens in BOTH CLOB and ERC1155 for W1`);

  if (overlappingHex.length === 0) {
    console.log('No overlapping tokens found!');
    await client.close();
    return;
  }

  // Build lookup maps (hex -> decimal)
  const hexToDecMap = new Map<string, string>();
  for (let i = 0; i < clobTokensDec.length; i++) {
    hexToDecMap.set(clobTokensHex[i], clobTokensDec[i]);
  }

  console.log('');
  console.log('Computing V6 PnL for each overlapping token...');
  console.log('');

  const results: any[] = [];

  for (const hexToken of overlappingHex) {
    const decToken = hexToDecMap.get(hexToken)!;

    // Get CLOB cash flows (deduplicated by event_id)
    const clobCashResult = await client.query({
      query: `
        SELECT
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as net_cash
        FROM (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount) / 1000000.0 as usdc
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${W1}'
            AND is_deleted = 0
            AND token_id = '${decToken}'
          GROUP BY event_id
        )
      `,
      format: 'JSONEachRow'
    });
    const clobCashData = (await clobCashResult.json() as any[])[0];
    const net_cash = Number(clobCashData?.net_cash || 0);

    // Get ERC1155 token position
    const ercPosResult = await client.query({
      query: `
        SELECT
          SUM(CASE
            WHEN lower(to_address) = '${W1}' THEN toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3)))))/1e6
            WHEN lower(from_address) = '${W1}' THEN -toFloat64(reinterpretAsUInt256(reverse(unhex(substring(value, 3)))))/1e6
            ELSE 0
          END) as net_tokens
        FROM pm_erc1155_transfers
        WHERE (lower(to_address) = '${W1}' OR lower(from_address) = '${W1}')
          AND token_id = '${hexToken}'
      `,
      format: 'JSONEachRow'
    });
    const ercPosData = (await ercPosResult.json() as any[])[0];
    const net_tokens = Number(ercPosData?.net_tokens || 0);

    // Get resolution data using the decimal token_id
    const resResult = await client.query({
      query: `
        SELECT
          m.condition_id,
          m.outcome_index,
          r.payout_numerators,
          r.resolved_at IS NOT NULL as is_resolved
        FROM pm_token_to_condition_map_v3 m
        LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
        WHERE m.token_id_dec = '${decToken}'
      `,
      format: 'JSONEachRow'
    });
    const resData = (await resResult.json() as any[])[0];

    let payout_price = 0;
    let is_resolved = false;
    let condition_id = '';

    if (resData && resData.is_resolved && resData.payout_numerators) {
      is_resolved = true;
      condition_id = resData.condition_id;
      try {
        const payouts = JSON.parse(resData.payout_numerators);
        payout_price = payouts[resData.outcome_index] || 0;
      } catch (e) {
        console.log(`  Failed to parse payouts for ${hexToken}`);
      }
    }

    const realized_pnl = is_resolved ? net_cash + (net_tokens * payout_price) : null;

    results.push({
      token_hex: hexToken.substring(0, 20) + '...',
      condition_id: condition_id ? condition_id.substring(0, 16) + '...' : 'N/A',
      net_cash,
      net_tokens,
      payout_price,
      is_resolved,
      realized_pnl
    });
  }

  // Display results
  console.log('=== V6 PnL CALCULATION ===');
  console.log('Formula: Realized PnL = Net Cash Flow + (Final Tokens × Payout Price)');
  console.log('');
  console.log('Token-level breakdown:');
  console.log('token_hex                | condition_id      | net_cash      | net_tokens    | payout | resolved | realized_pnl');
  console.log('-'.repeat(120));

  let totalResolvedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const row of results) {
    const pnlStr = row.realized_pnl !== null ? `$${row.realized_pnl.toFixed(2)}` : 'N/A (unresolved)';
    console.log(
      `${row.token_hex.padEnd(24)} | ` +
      `${row.condition_id.padEnd(17)} | ` +
      `$${row.net_cash.toFixed(2).padStart(11)} | ` +
      `${row.net_tokens.toFixed(2).padStart(13)} | ` +
      `${row.payout_price.toFixed(2).padStart(6)} | ` +
      `${String(row.is_resolved).padStart(8)} | ` +
      pnlStr
    );

    if (row.realized_pnl !== null) {
      totalResolvedPnl += row.realized_pnl;
      resolvedCount++;
    } else {
      unresolvedCount++;
    }
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Overlapping tokens: ${overlappingHex.length}`);
  console.log(`  Resolved: ${resolvedCount}`);
  console.log(`  Unresolved: ${unresolvedCount}`);
  console.log('');
  console.log(`TOTAL V6 PARTIAL PnL (resolved overlapping tokens): $${totalResolvedPnl.toFixed(2)}`);
  console.log('');
  console.log('=== COMPARISON ===');
  console.log('Polymarket API expected: -$6,138.89 (as of 2025-11-28, after Poland resolution)');
  console.log(`Our V6 partial calculation: $${totalResolvedPnl.toFixed(2)}`);
  console.log('');
  console.log('NOTE: This is a PARTIAL calculation using only tokens found in both CLOB and ERC1155.');
  console.log('The gap (if any) represents either:');
  console.log('  1. Tokens in CLOB but missing from ERC1155 data');
  console.log('  2. CTF minting costs not captured in CLOB');

  await client.close();
}

main().catch(console.error);
