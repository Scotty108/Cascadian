/**
 * Reconcile ERC1155 ground truth vs pm_unified_ledger_v9
 *
 * This script checks if the ledger faithfully represents ERC1155 token movements.
 * If there are mismatches, we know the ledger is leaky and any PnL engine will fail.
 *
 * Key insight from GPT:
 *   sum_erc1155(token_delta) == sum_clob(token_delta) + sum_ctf(token_delta) + sum_external(token_delta)
 *
 * If this equation doesn't hold, the ledger is missing or misclassifying events.
 */

import { clickhouse } from '../../lib/clickhouse/client';

const TEST_WALLETS = [
  { address: '0x56bf1a64a14601aff2de20bb01045aed8da6c45a', name: 'JustDoIt' },
  { address: '0xf1302aafc43aa3a69bcd8058fc7a0259dac246ab', name: 'TraderRed (MM)' },
];

async function checkERC1155Tables(): Promise<void> {
  console.log('Checking available ERC1155 tables...\n');

  const tables = await clickhouse.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE '%erc1155%' OR name LIKE '%erc20%' OR name LIKE '%ctf%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await tables.json();
  console.log('Available tables:');
  rows.forEach((r: any) => console.log(`  ${r.name}`));
  console.log('');
}

async function describeTable(tableName: string): Promise<void> {
  try {
    const result = await clickhouse.query({
      query: `DESCRIBE TABLE ${tableName}`,
      format: 'JSONEachRow'
    });
    const rows: any[] = await result.json();
    console.log(`\n${tableName} schema:`);
    rows.slice(0, 10).forEach((r: any) => console.log(`  ${r.name}: ${r.type}`));
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more columns`);
  } catch (err: any) {
    console.log(`  Error describing ${tableName}: ${err.message}`);
  }
}

async function reconcileWallet(wallet: string, name: string): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log(`Reconciling: ${name} (${wallet.slice(0, 10)}...)`);
  console.log('='.repeat(70));

  const walletLower = wallet.toLowerCase();

  // Step 1: Get ERC1155 ground truth (token balances from transfers)
  console.log('\n1. ERC1155 Ground Truth:');

  try {
    const erc1155 = await clickhouse.query({
      query: `
        SELECT
          token_id,
          sumIf(toFloat64(value), lower(to_address) = '${walletLower}')
            - sumIf(toFloat64(value), lower(from_address) = '${walletLower}') AS net_erc1155
        FROM pm_erc1155_transfers
        WHERE lower(from_address) = '${walletLower}' OR lower(to_address) = '${walletLower}'
        GROUP BY token_id
        HAVING abs(net_erc1155) > 0.01
        ORDER BY abs(net_erc1155) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const erc1155Rows: any[] = await erc1155.json();
    console.log(`  Found ${erc1155Rows.length} tokens with non-zero balance in ERC1155 transfers`);
    if (erc1155Rows.length > 0) {
      console.log('  Top 5 by balance:');
      erc1155Rows.slice(0, 5).forEach((r: any) => {
        console.log(`    token_id=${r.token_id.toString().slice(0, 20)}...: ${Number(r.net_erc1155).toFixed(2)}`);
      });
    }
  } catch (err: any) {
    console.log(`  Error querying ERC1155: ${err.message}`);
  }

  // Step 2: Get ledger token balances
  console.log('\n2. Ledger Token Balances (pm_unified_ledger_v9):');

  try {
    // The ledger uses condition_id + outcome_index, not token_id directly
    // We need to join via token mapping or check at the position level
    const ledger = await clickhouse.query({
      query: `
        SELECT
          canonical_condition_id,
          outcome_index,
          sum(token_delta) AS net_ledger
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${walletLower}'
          AND canonical_condition_id IS NOT NULL
          AND canonical_condition_id != ''
        GROUP BY canonical_condition_id, outcome_index
        HAVING abs(sum(token_delta)) > 0.01
        ORDER BY abs(sum(token_delta)) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const ledgerRows: any[] = await ledger.json();
    console.log(`  Found ${ledgerRows.length} positions with non-zero balance in ledger`);
    if (ledgerRows.length > 0) {
      console.log('  Top 5 by balance:');
      ledgerRows.slice(0, 5).forEach((r: any) => {
        console.log(`    ${r.canonical_condition_id.slice(0, 20)}... out=${r.outcome_index}: ${Number(r.net_ledger).toFixed(2)}`);
      });
    }
  } catch (err: any) {
    console.log(`  Error querying ledger: ${err.message}`);
  }

  // Step 3: Check USDC flows
  console.log('\n3. USDC (ERC20) Flows:');

  try {
    // Try to find the ERC20 table
    const erc20 = await clickhouse.query({
      query: `
        SELECT
          sumIf(toFloat64(value), lower(to_address) = '${walletLower}')
            - sumIf(toFloat64(value), lower(from_address) = '${walletLower}') AS net_erc20
        FROM pm_erc20_transfers
        WHERE lower(from_address) = '${walletLower}' OR lower(to_address) = '${walletLower}'
      `,
      format: 'JSONEachRow'
    });

    const erc20Row = (await erc20.json())[0] as any;
    console.log(`  Net ERC20 flow: ${Number(erc20Row?.net_erc20 || 0).toFixed(2)}`);
  } catch (err: any) {
    console.log(`  Error querying ERC20 (may not exist): ${err.message}`);
  }

  // Step 4: Check ledger USDC flows
  console.log('\n4. Ledger USDC Flows:');

  try {
    const ledgerUsdc = await clickhouse.query({
      query: `
        SELECT sum(usdc_delta) AS net_usdc
        FROM pm_unified_ledger_v9
        WHERE lower(wallet_address) = '${walletLower}'
      `,
      format: 'JSONEachRow'
    });

    const usdcRow = (await ledgerUsdc.json())[0] as any;
    console.log(`  Net ledger USDC: ${Number(usdcRow?.net_usdc || 0).toFixed(2)}`);
  } catch (err: any) {
    console.log(`  Error querying ledger USDC: ${err.message}`);
  }

  // Step 5: Check CTF events (splits, merges, redemptions)
  console.log('\n5. CTF Events:');

  try {
    const ctf = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as cnt
        FROM pm_ctf_events
        WHERE lower(stakeholder) = '${walletLower}'
        GROUP BY event_type
      `,
      format: 'JSONEachRow'
    });

    const ctfRows: any[] = await ctf.json();
    if (ctfRows.length > 0) {
      ctfRows.forEach((r: any) => console.log(`  ${r.event_type}: ${r.cnt} events`));
    } else {
      console.log('  No CTF events found');
    }
  } catch (err: any) {
    console.log(`  Error querying CTF events: ${err.message}`);
  }

  // Step 6: Check CLOB events
  console.log('\n6. CLOB Events (pm_trader_events_v2):');

  try {
    const clob = await clickhouse.query({
      query: `
        SELECT
          side,
          count() as cnt,
          sum(toFloat64(token_amount)) / 1e6 as total_tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${walletLower}'
          AND is_deleted = 0
        GROUP BY side
      `,
      format: 'JSONEachRow'
    });

    const clobRows: any[] = await clob.json();
    if (clobRows.length > 0) {
      clobRows.forEach((r: any) => console.log(`  ${r.side}: ${r.cnt} events, ${Number(r.total_tokens).toFixed(2)} tokens`));
    } else {
      console.log('  No CLOB events found');
    }
  } catch (err: any) {
    console.log(`  Error querying CLOB events: ${err.message}`);
  }
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         ERC1155 vs Ledger Reconciliation Check                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  await checkERC1155Tables();

  // Describe key tables
  await describeTable('pm_erc1155_transfers');
  await describeTable('pm_ctf_events');

  // Reconcile each wallet
  for (const wallet of TEST_WALLETS) {
    await reconcileWallet(wallet.address, wallet.name);
  }

  console.log('\n\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
