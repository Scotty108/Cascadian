/**
 * Create vw_negrisk_conversions view in ClickHouse
 *
 * This view extracts token acquisitions from NegRisk contract transfers
 * with proper hex parsing and $0.50 cost basis.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const NEGRISK_ADAPTER = '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296';
const NEGRISK_CTF = '0xc5d563a36ae78145c45a50134d48a1215220f80a';

// Standard cost basis for NegRisk conversions (Polymarket split price)
const COST_BASIS_PER_SHARE = 0.5;

async function createView() {
  console.log('=== CREATING vw_negrisk_conversions VIEW ===\n');

  // First drop if exists
  console.log('Dropping existing view if any...');
  try {
    await clickhouse.command({
      query: 'DROP VIEW IF EXISTS vw_negrisk_conversions',
    });
    console.log('Dropped existing view.\n');
  } catch (e: unknown) {
    console.log('No existing view to drop.\n');
  }

  // Create the view
  console.log('Creating view...');
  const createViewSQL = `
    CREATE VIEW vw_negrisk_conversions AS
    SELECT
        lower(to_address) as wallet,
        tx_hash,
        block_number,
        block_timestamp,
        lower(from_address) as source_contract,
        -- Convert hex token_id to decimal string
        -- token_id is like '0x123abc...' - need to parse as hex
        token_id as token_id_hex,
        -- Convert hex value to tokens (value is like '0x11e1a300')
        CASE
            WHEN startsWith(value, '0x') AND length(value) > 2
            THEN reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1000000.0
            ELSE 0
        END as shares,
        -- Standard cost basis
        ${COST_BASIS_PER_SHARE} as cost_basis_per_share
    FROM pm_erc1155_transfers
    WHERE lower(from_address) IN (
        '${NEGRISK_ADAPTER}',
        '${NEGRISK_CTF}'
    )
    AND length(value) > 2
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log('View created successfully!\n');

  // Test the view
  console.log('=== TESTING VIEW ===\n');

  // Total stats
  const totalStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_events,
        countDistinct(wallet) as unique_wallets,
        sum(shares) as total_shares,
        sum(shares * cost_basis_per_share) as implied_cost_basis
      FROM vw_negrisk_conversions
    `,
    format: 'JSONEachRow',
  });
  const stats = (await totalStats.json())[0] as {
    total_events: string;
    unique_wallets: string;
    total_shares: string;
    implied_cost_basis: string;
  };
  console.log('Total view stats:');
  console.log('  Events:', Number(stats.total_events).toLocaleString());
  console.log('  Unique wallets:', Number(stats.unique_wallets).toLocaleString());
  console.log('  Total shares:', Number(stats.total_shares).toLocaleString());
  console.log('  Implied cost basis: $' + Number(stats.implied_cost_basis).toLocaleString());

  // Test on worst wallet
  console.log('\n--- Testing on worst sign-mismatch wallet ---');
  const testWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

  const walletStats = await clickhouse.query({
    query: `
      SELECT
        source_contract,
        count() as events,
        sum(shares) as total_shares,
        sum(shares * cost_basis_per_share) as cost_basis
      FROM vw_negrisk_conversions
      WHERE wallet = '${testWallet}'
      GROUP BY source_contract
      ORDER BY events DESC
    `,
    format: 'JSONEachRow',
  });
  const walletData = (await walletStats.json()) as Array<{
    source_contract: string;
    events: string;
    total_shares: string;
    cost_basis: string;
  }>;

  console.log('Wallet:', testWallet);
  let totalTokens = 0;
  let totalCost = 0;
  for (const row of walletData) {
    const tokens = Number(row.total_shares);
    const cost = Number(row.cost_basis);
    totalTokens += tokens;
    totalCost += cost;
    console.log(
      '  Source:',
      row.source_contract.substring(0, 20) + '...',
      '| Events:',
      Number(row.events).toLocaleString(),
      '| Tokens:',
      tokens.toLocaleString(),
      '| Cost: $' + cost.toLocaleString()
    );
  }
  console.log('  TOTAL:', totalTokens.toLocaleString(), 'tokens, $' + totalCost.toLocaleString());

  // Compare to CLOB data
  console.log('\n--- Comparing to CLOB data ---');
  const clobBuys = await clickhouse.query({
    query: `
      SELECT sum(tokens) as t, sum(usdc) as u FROM (
        SELECT event_id, any(token_amount)/1e6 as tokens, any(usdc_amount)/1e6 as usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${testWallet}' AND side = 'buy' AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });
  const clobSells = await clickhouse.query({
    query: `
      SELECT sum(tokens) as t, sum(usdc) as u FROM (
        SELECT event_id, any(token_amount)/1e6 as tokens, any(usdc_amount)/1e6 as usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${testWallet}' AND side = 'sell' AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow',
  });

  const buys = (await clobBuys.json())[0] as { t: string; u: string };
  const sells = (await clobSells.json())[0] as { t: string; u: string };

  console.log('CLOB Buys:', Number(buys.t).toLocaleString(), 'tokens, $' + Number(buys.u).toLocaleString());
  console.log('CLOB Sells:', Number(sells.t).toLocaleString(), 'tokens, $' + Number(sells.u).toLocaleString());
  console.log('NegRisk Acquisitions:', totalTokens.toLocaleString(), 'tokens, $' + totalCost.toLocaleString());
  console.log('\nToken Gap Analysis:');
  console.log('  CLOB bought:', Number(buys.t).toLocaleString());
  console.log('  + NegRisk acquired:', totalTokens.toLocaleString());
  console.log('  = Total sources:', (Number(buys.t) + totalTokens).toLocaleString());
  console.log('  CLOB sold:', Number(sells.t).toLocaleString());
  console.log('  Gap:', (Number(sells.t) - Number(buys.t) - totalTokens).toLocaleString());

  console.log('\n=== VIEW CREATION COMPLETE ===');
}

createView().catch(console.error);
