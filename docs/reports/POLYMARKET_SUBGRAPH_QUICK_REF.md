# Polymarket Subgraph Quick Reference

## Event Handler Lookup Table

| Contract | Event | Handler | File | Action | Filters |
|----------|-------|---------|------|--------|---------|
| ConditionalTokens | ConditionPreparation | handleConditionPreparation | ConditionalTokensMapping.ts | Create Condition entity | Skip if outcomeSlotCount != 2 |
| ConditionalTokens | ConditionResolution | handleConditionResolution | ConditionalTokensMapping.ts | Set payout ratios | None |
| ConditionalTokens | PositionSplit | handlePositionSplit | ConditionalTokensMapping.ts | BUY YES+NO at $0.50 | Skip if stakeholder = NegRiskAdapter or CTFExchange |
| ConditionalTokens | PositionsMerge | handlePositionsMerge | ConditionalTokensMapping.ts | SELL YES+NO at $0.50 | Skip if stakeholder = NegRiskAdapter or CTFExchange |
| ConditionalTokens | PayoutRedemption | handlePayoutRedemption | ConditionalTokensMapping.ts | SELL at payout price | Skip if redeemer = NegRiskAdapter |
| Exchange | OrderFilled | handleOrderFilled | ExchangeMapping.ts | BUY or SELL at trade price | None |
| NegRiskExchange | OrderFilled | handleOrderFilled | ExchangeMapping.ts | BUY or SELL at trade price | None |
| NegRiskAdapter | MarketPrepared | handleMarketPrepared | NegRiskAdapterMapping.ts | Create NegRiskEvent entity | None |
| NegRiskAdapter | QuestionPrepared | handleQuestionPrepared | NegRiskAdapterMapping.ts | Increment questionCount | None |
| NegRiskAdapter | PositionSplit | handlePositionSplit | NegRiskAdapterMapping.ts | BUY YES+NO at $0.50 | Skip if stakeholder = NegRiskExchange |
| NegRiskAdapter | PositionsMerge | handlePositionsMerge | NegRiskAdapterMapping.ts | SELL YES+NO at $0.50 | Skip if stakeholder = NegRiskExchange |
| NegRiskAdapter | PositionsConverted | handlePositionsConverted | NegRiskAdapterMapping.ts | SELL NOs, BUY YESs | None |
| NegRiskAdapter | PayoutRedemption | handlePayoutRedemption | NegRiskAdapterMapping.ts | SELL at payout price | None |
| FixedProductMarketMakerFactory | FixedProductMarketMakerCreation | handleFixedProductMarketMakerCreation | FixedProductMarketMakerFactoryMapping.ts | Create FPMM entity + template | None |
| FixedProductMarketMaker | FPMMBuy | handleBuy | FixedProductMarketMakerMapping.ts | BUY at AMM price | None |
| FixedProductMarketMaker | FPMMSell | handleSell | FixedProductMarketMakerMapping.ts | SELL at AMM price | None |
| FixedProductMarketMaker | FPMMFundingAdded | handleFundingAdded | FixedProductMarketMakerMapping.ts | BUY sendback + LP shares | None |
| FixedProductMarketMaker | FPMMFundingRemoved | handleFundingRemoved | FixedProductMarketMakerMapping.ts | BUY tokens, SELL LP shares | None |

---

## Contract Addresses (Template Variables)

| Contract | Variable | Purpose |
|----------|----------|---------|
| ConditionalTokens | `{{ contracts.ConditionalTokens.address }}` | Core ERC1155 token contract |
| Exchange (CTFExchange) | `{{ contracts.Exchange.address }}` | Standard CLOB exchange |
| NegRiskExchange | `{{ contracts.NegRiskExchange.address }}` | Neg Risk CLOB exchange |
| NegRiskAdapter | `{{ contracts.NegRiskAdapter.address }}` | Neg Risk conversion adapter |
| FixedProductMarketMakerFactory | `{{ contracts.FixedProductMarketMakerFactory.address }}` | AMM factory |
| USDC | `{{ contracts.USDC.address }}` | Collateral token |

---

## Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| COLLATERAL_SCALE | 10^6 | USDC has 6 decimals |
| FIFTY_CENTS | 500000 | $0.50 in 6-decimal format |
| TradeType.BUY | 0 | Enum value for buy side |
| TradeType.SELL | 1 | Enum value for sell side |

---

## Core Functions

### updateUserPositionWithBuy(user, positionId, price, amount)

**File:** `utils/updateUserPositionWithBuy.ts`

**Logic:**
```typescript
newAvgPrice = (oldAvgPrice * oldAmount + price * amount) / (oldAmount + amount)
amount += buyAmount
totalBought += buyAmount
```

**Effect:** Increases position, updates weighted average cost basis

---

### updateUserPositionWithSell(user, positionId, price, amount)

**File:** `utils/updateUserPositionWithSell.ts`

**Logic:**
```typescript
adjustedAmount = min(sellAmount, currentAmount)
deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE
realizedPnl += deltaPnL
amount -= adjustedAmount
```

**Effect:** Decreases position, realizes PnL (avgPrice unchanged)

---

## Trade Side Detection

**From:** `parseOrderFilled()` in `ExchangeMapping.ts`

```typescript
if (makerAssetId == 0) {
  // BUY: Maker pays USDC, receives tokens
  side = TradeType.BUY
  account = maker
  baseAmount = takerAmountFilled  // tokens received
  quoteAmount = makerAmountFilled // USDC paid
  positionId = takerAssetId
} else {
  // SELL: Maker pays tokens, receives USDC
  side = TradeType.SELL
  account = maker
  baseAmount = makerAmountFilled  // tokens sold
  quoteAmount = takerAmountFilled // USDC received
  positionId = makerAssetId
}

price = quoteAmount * COLLATERAL_SCALE / baseAmount
```

---

## Filter Decision Tree

```
Event received
  ├─ ConditionalTokens.PositionSplit?
  │  ├─ stakeholder == NegRiskAdapter? → SKIP (handled by NegRiskAdapterMapping)
  │  ├─ stakeholder == CTFExchange? → SKIP (internal bookkeeping)
  │  └─ else → Process
  │
  ├─ ConditionalTokens.PositionsMerge?
  │  ├─ stakeholder == NegRiskAdapter? → SKIP
  │  ├─ stakeholder == CTFExchange? → SKIP
  │  └─ else → Process
  │
  ├─ ConditionalTokens.PayoutRedemption?
  │  ├─ redeemer == NegRiskAdapter? → SKIP
  │  └─ else → Process
  │
  ├─ NegRiskAdapter.PositionSplit?
  │  ├─ stakeholder == NegRiskExchange? → SKIP
  │  └─ else → Process
  │
  ├─ NegRiskAdapter.PositionsMerge?
  │  ├─ stakeholder == NegRiskExchange? → SKIP
  │  └─ else → Process
  │
  └─ ConditionalTokens.ConditionPreparation?
     ├─ outcomeSlotCount != 2? → SKIP (only binary markets)
     └─ else → Process
```

---

## Entity Schemas

### UserPosition

| Field | Type | Description |
|-------|------|-------------|
| id | ID! | `"{userAddress}-{tokenId}"` |
| user | String! | User address (hex) |
| tokenId | BigInt! | Position ID / Token ID |
| amount | BigInt! | Current holdings (6 decimals) |
| avgPrice | BigInt! | Average cost basis (6 decimals) |
| realizedPnl | BigInt! | Cumulative realized PnL (6 decimals) |
| totalBought | BigInt! | Total purchased (6 decimals) |

### Condition

| Field | Type | Description |
|-------|------|-------------|
| id | ID! | conditionId (32-byte hex) |
| positionIds | [BigInt!]! | Token IDs for YES/NO outcomes |
| payoutNumerators | [BigInt!]! | Payout ratios (set on resolution) |
| payoutDenominator | BigInt! | Sum of numerators |

### NegRiskEvent

| Field | Type | Description |
|-------|------|-------------|
| id | ID! | negRiskMarketId |
| questionCount | Int! | Number of questions in neg risk market |

### FPMM

| Field | Type | Description |
|-------|------|-------------|
| id | ID! | FPMM address |
| conditionId | String! | Associated conditionId |

---

## GraphQL Query Examples

### Get User's Total PnL

```graphql
{
  userPositions(where: { user: "0x1234..." }) {
    tokenId
    amount
    avgPrice
    realizedPnl
    totalBought
  }
}
```

Then sum `realizedPnl` across all positions.

### Get User's Open Positions

```graphql
{
  userPositions(where: { user: "0x1234...", amount_gt: 0 }) {
    tokenId
    amount
    avgPrice
    realizedPnl
  }
}
```

### Get Condition Details

```graphql
{
  condition(id: "0xabc123...") {
    positionIds
    payoutNumerators
    payoutDenominator
  }
}
```

---

## Neg Risk Conversion Formula

**From:** `handlePositionsConverted()` in `NegRiskAdapterMapping.ts`

```typescript
// Phase 1: Calculate average NO price
for (each question in indexSet) {
  noPriceSum += userPosition.avgPrice
  noCount++
}
avgNoPrice = noPriceSum / noCount

// Phase 2: Calculate YES price
questionCount = total questions in market
yesCount = questionCount - noCount
yesPrice = (1.0 - noCount * avgNoPrice) / yesCount

// Phase 3: Apply
for (each question in indexSet) {
  SELL NO at userPosition.avgPrice
}
for (each question NOT in indexSet) {
  BUY YES at yesPrice
}
```

**Example:**
- 3-question market (A, B, C)
- User holds NO_A ($0.30), NO_B ($0.30)
- Converts: indexSet includes A, B
- noCount = 2, avgNoPrice = $0.30
- yesCount = 3 - 2 = 1
- yesPrice = (1.0 - 2 * 0.30) / 1 = $0.40
- Result: SELL NO_A and NO_B, BUY YES_C at $0.40

---

## AMM Liquidity Formulas

### Adding Liquidity (FPMMFundingAdded)

```typescript
// Phase 1: Track sendback token
sendbackAmount = (from event parsing)
sendbackPrice = (market price at time of add)
tokenCost = sendbackAmount * sendbackPrice / COLLATERAL_SCALE
BUY sendback token at sendbackPrice

// Phase 2: Track LP shares
totalUSDCSpend = max(amountsAdded[0], amountsAdded[1])
lpShareCost = totalUSDCSpend - tokenCost
lpSharePrice = lpShareCost * COLLATERAL_SCALE / sharesMinted
BUY LP shares at lpSharePrice
```

### Removing Liquidity (FPMMFundingRemoved)

```typescript
// Phase 1: Track received tokens
for (each outcome YES, NO) {
  tokenPrice = (compute from amountsRemoved)
  tokenAmount = amountsRemoved[outcomeIndex]
  tokenCost = tokenPrice * tokenAmount / COLLATERAL_SCALE
  totalTokensCost += tokenCost
  BUY token at tokenPrice
}

// Phase 2: Track LP shares burned
lpSalePrice = (collateralRemoved - totalTokensCost) * COLLATERAL_SCALE / sharesBurnt
SELL LP shares at lpSalePrice
```

---

## Common Pitfalls

| Pitfall | Why It Happens | Solution |
|---------|----------------|----------|
| Double-counting splits/merges | ConditionalTokens AND NegRiskAdapter both emit events | Filter by stakeholder address |
| Double-counting CLOB trades | Both Exchange and NegRiskExchange emit OrderFilled | They don't overlap (different markets) |
| Wrong PnL on external tokens | User received tokens via transfer, not tracked purchase | Cap adjustedAmount to tracked holdings |
| Negative positions | Selling more than holdings | Use min(sellAmount, currentAmount) |
| Multi-outcome markets | >2 outcomes not supported | Skip if outcomeSlotCount != 2 |

---

## Why Cascadian Can't Replicate This

| Issue | Subgraph Solution | Cascadian Problem |
|-------|-------------------|-------------------|
| Adapter bookkeeping trades | Filters by stakeholder address | CLOB API includes all trades, can't distinguish |
| Event ordering | Blockchain guarantees sequential order | CLOB API has no ordering guarantees |
| AMM trades | Listens to FPMM events | No AMM data ingestion |
| Redemptions | Listens to PayoutRedemption events | No redemption event tracking |
| Neg risk conversions | PositionsConverted event + indexSet parsing | No conversion event data |

**Root Cause:** Cascadian uses CLOB API (post-processed) instead of raw blockchain events (source of truth).

---

## Repository Structure

```
polymarket-subgraph/
├── pnl-subgraph/
│   ├── src/
│   │   ├── ConditionalTokensMapping.ts
│   │   ├── ExchangeMapping.ts
│   │   ├── FixedProductMarketMakerMapping.ts
│   │   ├── NegRiskAdapterMapping.ts
│   │   ├── FixedProductMarketMakerFactoryMapping.ts
│   │   └── utils/
│   │       ├── updateUserPositionWithBuy.ts
│   │       ├── updateUserPositionWithSell.ts
│   │       ├── loadOrCreateUserPosition.ts
│   │       ├── parseOrderFilled.ts
│   │       └── [more helpers...]
│   ├── schema.graphql
│   └── subgraph.template.yaml
├── common/
│   └── constants.template.ts
└── abis/
    └── [contract ABIs...]
```

---

## Links

- **Subgraph Repo:** https://github.com/Polymarket/polymarket-subgraph
- **Commit Analyzed:** f5a074a5a3b7622185971c5f18aec342bcbe96a6
- **Graph Protocol Docs:** https://thegraph.com/docs/
- **Cascadian Analysis:** See `POLYMARKET_SUBGRAPH_COMPLETE_ANALYSIS.md` for full details
