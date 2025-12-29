# Data Gap Analysis: Why PnL Doesn't Match UI

**Date:** 2025-11-29

## TL;DR

- **Engine math is correct** - invariant holds for all 6 benchmark wallets
- **Main missing data**: ERC1155 transfers + some token mappings
- **Fix**: Wire `pm_erc1155_transfers` into loader with token ID normalization
- **Only escalate to Goldsky**: tokens with sells but no buys, no CTF events, AND no transfers after normalization

---

## Executive Summary

Our V11_POLY engine is **mathematically correct**. The invariant `econCashFlow + costBasis - realizedPnL = cappedValue` holds for 100% of test wallets. The discrepancy with Polymarket's UI comes from **missing data sources**, not calculation errors.

## Quick Reference: Tables and Gap Types

| Table | Role | Token ID Format | Gap Type |
|-------|------|-----------------|----------|
| `pm_trader_events_v2` | CLOB trades | Decimal | Should not be missing for normal markets |
| `pm_ctf_events` | Split/Merge/Redemption | condition_id | May miss historical events |
| `pm_token_to_condition_map_v3` | condition_id → token_id | Decimal | Some condition_ids have no mapping |
| `pm_erc1155_transfers` | Raw token transfers | **Hex** | **Currently ignored by engine** |

## Decision Tree: Is It Our Bug or Goldsky's?

For each capped sell (sells > tracked buys):

```
Does token appear in pm_erc1155_transfers (after hex→decimal conversion)?
├── YES → Our setup issue. Fix loader to include transfers.
└── NO → Does it appear in pm_ctf_events + pm_token_to_condition_map_v3?
    ├── YES but mapping missing → Token map coverage issue. Rebuild map.
    └── NO → Genuine Goldsky gap. Report with:
        • wallet address
        • token_id (decimal and hex)
        • example market
        • block range
```

---

## The Gap: ERC1155 Transfers

### What We Track
1. **pm_trader_events_v2** - CLOB trades (buys/sells via order book)
2. **pm_ctf_events** - CTF events (splits, merges, redemptions)
3. **pm_condition_resolutions** - Market resolution outcomes

### What We're Missing
**pm_erc1155_transfers** - Direct token transfers between wallets

When a user:
1. Receives tokens from another wallet (gift, transfer from exchange, etc.)
2. Later sells or redeems those tokens

We see the SELL but never saw the BUY. The engine caps the sell at 0 tokens (since tracked position = 0), causing:
- No PnL realized for that position
- Economic cashflow shows the sell proceeds
- Invariant violation = capped sell value

## Data Source Details

### pm_erc1155_transfers (42.6M rows)
| Column | Type | Notes |
|--------|------|-------|
| token_id | String | **Hex format** (0xabc...) |
| from_address | String | Source wallet |
| to_address | String | Destination wallet |
| value | String | **Hex encoded** amount |
| block_timestamp | DateTime | Transfer time |
| contract | String | ConditionalTokens contract |

### pm_trader_events_v2 (CLOB trades)
| Column | Type | Notes |
|--------|------|-------|
| token_id | String | **Decimal format** (12345...) |
| trader_wallet | String | Trader address |
| usdc_amount | Number | USDC in micro units |
| token_amount | Number | Tokens in micro units |

### Format Conversion Required
```
CLOB token_id (decimal) ↔ ERC1155 token_id (hex)

Example:
- CLOB: 101930576911425586782821354801874735160479124595273390639580477892173977424924
- ERC1155: 0xe15aa97c3ad23d574aee1946ed181a7b7da87030df5711bef90c0e85d4cd141c
```

## Gap Analysis by Wallet

| Wallet | Capped Events | Unique Tokens | Est. Value |
|--------|---------------|---------------|------------|
| W1 | 97 | 16 | ~$42,401 |
| W2 | 30 | 18 | ~$8,971 |
| W3 | 25 | 22 | ~$168 |
| W4 | 202 | 58 | ~$19,731 |
| W5 | 8 | 7 | ~$470 |
| W6 | 176 | 91 | ~$9,233 |

## Solutions

### Option 1: Integrate ERC1155 Transfers into Event Loader (Recommended)

Modify `lib/pnl/polymarketEventLoader.ts` to:

1. Load ERC1155 transfers TO the wallet (excluding mints from 0x0)
2. Convert hex token_id to decimal for matching
3. Treat incoming transfers as BUY events at $0.50 (neutral cost basis)
4. Include in the event stream before sorting

**Pros:**
- Uses existing data (pm_erc1155_transfers has 42.6M rows)
- No external dependencies
- Fixes most gap scenarios

**Cons:**
- $0.50 cost basis is approximate (true cost unknown)
- Some rounding in realized PnL

### Option 2: Fetch Historical Prices at Transfer Time

Enhance Option 1 by:
1. Looking up market prices at transfer block_timestamp
2. Use actual price instead of $0.50

**Pros:**
- More accurate cost basis
- Better PnL accuracy

**Cons:**
- Requires price oracle data
- Significantly more complex

### Option 3: Accept Data Gaps

Keep the current engine and document that:
- PnL is accurate for trades executed via CLOB
- Transfers are not tracked (matches what many analytics platforms do)

**Pros:**
- No code changes
- Clear documentation of limitations

**Cons:**
- Won't match Polymarket UI
- Incomplete picture for some wallets

## Implementation for Option 1

```typescript
// In polymarketEventLoader.ts

async function loadErc1155Transfers(wallet: string): Promise<PolymarketPnlEvent[]> {
  const query = `
    SELECT
      token_id,
      from_address,
      to_address,
      value,
      block_timestamp,
      block_number,
      tx_hash
    FROM pm_erc1155_transfers
    WHERE lower(to_address) = lower({wallet:String})
      AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      AND is_deleted = 0
    ORDER BY block_number
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const rows = await result.json() as any[];

  return rows.map(row => {
    // Convert hex token_id to decimal BigInt
    const tokenId = BigInt(row.token_id);

    // Convert hex value to decimal
    const valueHex = row.value.startsWith('0x') ? row.value : '0x' + row.value;
    const amount = BigInt(valueHex);

    return {
      wallet: wallet.toLowerCase(),
      tokenId,
      eventType: 'ORDER_MATCHED_BUY' as const,
      price: 500000n, // $0.50 neutral cost basis
      amount,
      blockNumber: BigInt(row.block_number),
      logIndex: 0n,
      txHash: row.tx_hash,
      timestamp: row.block_timestamp,
      usdcAmountRaw: (amount * 500000n) / COLLATERAL_SCALE, // Implied USDC
    };
  });
}
```

## Goldsky / Data Pipeline Considerations

The `pm_erc1155_transfers` table appears to be from Goldsky indexing. Key questions:

1. **Is it complete?** Need to verify coverage dates and contracts
2. **Is it current?** Last update appears to be 2025-11-11
3. **Contract filter?** Should only include Polymarket ConditionalTokens contract

## Recommendation

Implement **Option 1** as the immediate fix:
1. It uses existing data
2. It closes the majority of the gap
3. $0.50 cost basis is reasonable for transfers (often near-market prices)

For perfect UI parity, we would need to understand exactly how Polymarket tracks incoming transfers, which may require their API or additional investigation.

---

*Generated: 2025-11-29*
