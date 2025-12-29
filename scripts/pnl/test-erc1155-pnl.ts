/**
 * Test PnL calculation using ERC1155 transfers as source of truth
 *
 * This computes actual on-chain position from ERC1155 transfers,
 * then values the positions at resolution prices.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();
  const wallet = '0x7f3c8979d0afa00007bae4747d5347122af05613';
  const freshUiPnl = 214154;

  // Load resolutions - token_id_dec is decimal string
  const resResult = await client.query({
    query: `
      SELECT m.token_id_dec as token_id,
        if(r.payout_numerators IS NULL, NULL,
           if(JSONExtractInt(r.payout_numerators, m.outcome_index + 1) >= 1000, 1,
              JSONExtractInt(r.payout_numerators, m.outcome_index + 1))) as payout
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
      WHERE r.payout_numerators IS NOT NULL
    `,
    format: 'JSONEachRow',
  });
  const resRows = (await resResult.json()) as any[];
  const resolutionsByDec = new Map<string, number>();
  for (const r of resRows) {
    if (r.payout !== null) {
      resolutionsByDec.set(r.token_id, Number(r.payout));
    }
  }
  console.log('Loaded', resolutionsByDec.size, 'resolutions');

  // Helper to convert hex token_id to decimal string
  function hexToDecimal(hex: string): string {
    if (!hex || !hex.startsWith('0x')) return hex;
    try {
      return BigInt(hex).toString();
    } catch {
      return hex;
    }
  }

  // Get ERC1155 net positions per token
  const erc1155Result = await client.query({
    query: `
      SELECT
        token_id,
        sum(case
          when lower(to_address) = lower('${wallet}')
          then toInt64(reinterpretAsUInt64(reverse(unhex(substring(value, 3)))))
          else -toInt64(reinterpretAsUInt64(reverse(unhex(substring(value, 3)))))
        end) / 1e6 as net_tokens
      FROM pm_erc1155_transfers
      WHERE (lower(to_address) = lower('${wallet}') OR lower(from_address) = lower('${wallet}'))
        AND is_deleted = 0
      GROUP BY token_id
      HAVING net_tokens != 0
    `,
    format: 'JSONEachRow',
  });
  const erc1155Positions = (await erc1155Result.json()) as any[];

  // Get USDC spent via CLOB (this is still needed for cost basis)
  const clobResult = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount)/1e6 as usdc
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT
        token_id,
        sum(if(side='buy', usdc, -usdc)) as net_usdc
      FROM deduped
      GROUP BY token_id
    `,
    format: 'JSONEachRow',
  });
  const clobUsdc = new Map<string, number>();
  for (const r of (await clobResult.json()) as any[]) {
    clobUsdc.set(r.token_id, Number(r.net_usdc));
  }

  // Calculate PnL based on ERC1155 positions
  let totalHeldValue = 0;
  let totalUsdcSpent = 0;
  let winValue = 0;
  let lossValue = 0;
  let openValue = 0;
  let unmappedTokens = 0;

  interface PositionDetail {
    tokenId: string;
    netTokens: number;
    payout: number | null;
    heldValue: number;
    usdcSpent: number;
  }
  const details: PositionDetail[] = [];

  for (const pos of erc1155Positions) {
    const tokenIdHex = pos.token_id;
    const tokenIdDec = hexToDecimal(tokenIdHex);
    const payout = resolutionsByDec.get(tokenIdDec);
    const netTokens = Number(pos.net_tokens);

    // Try to find USDC spent (matching token IDs between hex and decimal is tricky)
    // For now, we'll just look at position value

    if (netTokens > 0) {
      if (payout !== undefined) {
        const heldValue = netTokens * payout;
        totalHeldValue += heldValue;
        if (payout > 0) winValue += heldValue;
        else lossValue += heldValue;

        if (Math.abs(heldValue) > 1000 || Math.abs(netTokens) > 10000) {
          details.push({
            tokenId: tokenIdHex?.slice(0, 20) + '...',
            netTokens,
            payout,
            heldValue,
            usdcSpent: 0,
          });
        }
      } else {
        openValue += netTokens * 0.5; // Estimate at 50 cents for unresolved
        unmappedTokens++;
      }
    }
  }

  console.log('\nERC1155-Based PnL Analysis:');
  console.log('===========================');
  console.log('ERC1155 positions with non-zero balance:', erc1155Positions.length);
  console.log('Positions with resolution:', erc1155Positions.length - unmappedTokens);
  console.log('Positions without resolution:', unmappedTokens);
  console.log('');
  console.log('Held value (at resolution price):');
  console.log('  Winning positions:', '$' + Math.round(winValue).toLocaleString());
  console.log('  Losing positions:', '$' + Math.round(lossValue).toLocaleString());
  console.log('  Total held value:', '$' + Math.round(totalHeldValue).toLocaleString());
  console.log('');

  // The PnL would be: current value - cost basis
  // But we don't have cost basis per ERC1155 token easily
  // The simple approach: held value IS the PnL for resolved positions
  // (since winning shares = $1 profit per share above $0, losing shares = already counted as 0)

  console.log('Comparison:');
  console.log('  Fresh UI (Dec 16):', '$' + freshUiPnl.toLocaleString());
  console.log('  ERC1155 held value:', '$' + Math.round(totalHeldValue).toLocaleString());

  // Show some of the winning positions
  console.log('\n=== Winning Positions (sample) ===');
  const winners = details.filter((d) => d.payout === 1).slice(0, 5);
  for (const d of winners) {
    console.log(
      `  ${d.tokenId}: ${d.netTokens.toFixed(0)} tokens * $1 = $${d.heldValue.toFixed(0)}`
    );
  }

  // Check total redeemed value
  const redeemResult = await client.query({
    query: `
      SELECT
        token_id,
        sum(reinterpretAsUInt64(reverse(unhex(substring(value, 3)))))/1e6 as redeemed_tokens
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = lower('${wallet}')
        AND to_address = '0x0000000000000000000000000000000000000000'
        AND is_deleted = 0
      GROUP BY token_id
    `,
    format: 'JSONEachRow',
  });
  const redeems = (await redeemResult.json()) as any[];

  let totalRedeemedWinning = 0;
  let totalRedeemedLosing = 0;
  for (const r of redeems) {
    const tokenIdDec = hexToDecimal(r.token_id);
    const payout = resolutionsByDec.get(tokenIdDec);
    const tokens = Number(r.redeemed_tokens);
    if (payout === 1) totalRedeemedWinning += tokens;
    else if (payout === 0) totalRedeemedLosing += tokens;
  }

  console.log('\n=== Redemptions Analysis ===');
  console.log('Redeemed winning tokens:', Math.round(totalRedeemedWinning).toLocaleString(), '($' + Math.round(totalRedeemedWinning).toLocaleString() + ' USDC received)');
  console.log('Redeemed losing tokens:', Math.round(totalRedeemedLosing).toLocaleString(), '($0 received)');
  console.log('');
  console.log('Total cash from redemptions:', '$' + Math.round(totalRedeemedWinning).toLocaleString());
  console.log('Total held value + redemptions:', '$' + Math.round(totalHeldValue + totalRedeemedWinning).toLocaleString());
}

main().catch(console.error);
