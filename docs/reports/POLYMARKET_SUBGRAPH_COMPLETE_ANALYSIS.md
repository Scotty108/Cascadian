# Polymarket PnL Subgraph Complete Analysis

## Executive Summary

The Polymarket PnL subgraph tracks user positions and calculates real-time profit/loss across multiple trading mechanisms. It listens to blockchain events from 5 core contracts and maintains state through a sophisticated event handler system.

**Key Insight:** The subgraph uses FIFO-style average cost basis tracking with two core operations:
- `updateUserPositionWithBuy`: Updates average price using weighted average
- `updateUserPositionWithSell`: Realizes PnL as `amount * (sell_price - avg_price)`

---

## Contract Architecture

### Data Sources (5 Core Contracts)

| Contract | Purpose | Key Events | Start Block |
|----------|---------|------------|-------------|
| **ConditionalTokens** | Core ERC1155 token operations | Split, Merge, Redemption, Preparation, Resolution | Configurable |
| **Exchange** (CTFExchange) | Standard CLOB trading | OrderFilled | Configurable |
| **NegRiskExchange** | Neg Risk CLOB trading | OrderFilled | Configurable |
| **NegRiskAdapter** | Neg Risk conversions | Split, Merge, Convert, Redemption, MarketPrepared, QuestionPrepared | Configurable |
| **FixedProductMarketMakerFactory** | AMM creation | FixedProductMarketMakerCreation | Configurable |

### Dynamic Templates

| Template | Purpose | Events |
|----------|---------|--------|
| **FixedProductMarketMaker** | Per-AMM instance tracking | Buy, Sell, FundingAdded, FundingRemoved |

---

## Data Model (GraphQL Schema)

### Core Entities

```graphql
type UserPosition @entity {
  id: ID!                      # "{userAddress}-{tokenId}"
  user: String!                # User address (hex)
  tokenId: BigInt!             # Position ID / Token ID
  amount: BigInt!              # Current holdings (6 decimals)
  avgPrice: BigInt!            # Average cost basis (6 decimals)
  realizedPnl: BigInt!         # Cumulative realized PnL (6 decimals)
  totalBought: BigInt!         # Total purchased (6 decimals)
}

type Condition @entity {
  id: ID!                      # conditionId (32-byte hex)
  positionIds: [BigInt!]!      # Token IDs for YES/NO outcomes
  payoutNumerators: [BigInt!]! # Payout ratios (set on resolution)
  payoutDenominator: BigInt!   # Sum of numerators
}

type NegRiskEvent @entity {
  id: ID!                      # negRiskMarketId
  questionCount: Int!          # Number of questions in neg risk market
}

type FPMM @entity {
  id: ID!                      # FPMM address
  conditionId: String!         # Associated conditionId
}
```

---

## Event Flow Diagrams

### 1. Standard CLOB Trade Flow (CTFExchange)

```
User submits order
       ↓
CTFExchange.OrderFilled event
       ↓
handleOrderFilled()
       ↓
parseOrderFilled()
  - Determines side (BUY/SELL) based on makerAssetId
  - BUY: makerAssetId = 0 (paying USDC)
  - SELL: makerAssetId = tokenId (selling token)
       ↓
Calculate price = quoteAmount * 10^6 / baseAmount
       ↓
       ├─ BUY → updateUserPositionWithBuy()
       │         - New avgPrice = (old_avgPrice * old_amount + price * buy_amount) / (old_amount + buy_amount)
       │         - amount += buy_amount
       │         - totalBought += buy_amount
       │
       └─ SELL → updateUserPositionWithSell()
                 - adjustedAmount = min(sell_amount, position_amount)
                 - deltaPnL = adjustedAmount * (price - avgPrice) / 10^6
                 - realizedPnl += deltaPnL
                 - amount -= adjustedAmount
```

### 2. Neg Risk CLOB Trade Flow (NegRiskExchange)

```
User submits order to NegRiskExchange
       ↓
NegRiskExchange.OrderFilled event
       ↓
SAME HANDLER AS CTFExchange
       ↓
handleOrderFilled() (ExchangeMapping.ts)
       ↓
[Identical flow to Standard CLOB above]
```

**Key Point:** NegRiskExchange uses the SAME OrderFilled handler as CTFExchange. The difference is the underlying token mechanics, not the PnL tracking.

### 3. ConditionalTokens Split/Merge Flow

```
User calls ConditionalTokens.splitPosition()
       ↓
ConditionalTokens.PositionSplit event
       ↓
handlePositionSplit()
       ↓
Filter check:
  - Skip if stakeholder = NegRiskAdapter (handled separately)
  - Skip if stakeholder = CTFExchange (internal bookkeeping)
       ↓
For each outcome (YES, NO):
  updateUserPositionWithBuy(user, positionId, 0.50, amount)
  - User "buys" both YES and NO at $0.50 each
  - Total cost = $1.00 per pair (matches USDC spent)

──────────────────────────────────────

User calls ConditionalTokens.mergePositions()
       ↓
ConditionalTokens.PositionsMerge event
       ↓
handlePositionsMerge()
       ↓
Filter check:
  - Skip if stakeholder = NegRiskAdapter
  - Skip if stakeholder = CTFExchange
       ↓
For each outcome (YES, NO):
  updateUserPositionWithSell(user, positionId, 0.50, amount)
  - User "sells" both YES and NO at $0.50 each
  - Realizes PnL based on difference from avgPrice
```

**Why $0.50?** When splitting USDC into YES+NO pairs, each token is worth exactly $0.50 because YES + NO always resolves to $1.00.

### 4. Neg Risk Adapter Flow

```
User calls NegRiskAdapter.splitPosition()
       ↓
NegRiskAdapter.PositionSplit event
       ↓
handlePositionSplit()
       ↓
Filter check:
  - Skip if stakeholder = NegRiskExchange (internal bookkeeping)
       ↓
For each outcome (YES, NO):
  updateUserPositionWithBuy(user, positionId, 0.50, amount)

──────────────────────────────────────

User calls NegRiskAdapter.mergePositions()
       ↓
NegRiskAdapter.PositionsMerge event
       ↓
handlePositionsMerge()
       ↓
Filter check:
  - Skip if stakeholder = NegRiskExchange
       ↓
For each outcome (YES, NO):
  updateUserPositionWithSell(user, positionId, 0.50, amount)

──────────────────────────────────────

User calls NegRiskAdapter.convertPositions()
       ↓
NegRiskAdapter.PositionsConverted event
       ↓
handlePositionsConverted()
       ↓
Load NegRiskEvent to get questionCount
       ↓
Parse indexSet to determine which questions are being converted
       ↓
Phase 1: SELL NO tokens
  For each question in indexSet:
    - Get user's NO position
    - SELL at user's avgPrice for that NO token
    - Sum up NO prices
       ↓
Calculate average NO price = sum(NO prices) / noCount
       ↓
Calculate YES price = (1.0 - noCount * NO_price) / (questionCount - noCount)
       ↓
Phase 2: BUY YES tokens
  For each question NOT in indexSet:
    - BUY YES at calculated YES price
```

**Neg Risk Conversion Example:**
- Market with 3 questions (A, B, C)
- User holds NO tokens for A and B (cost $0.30 each)
- User converts: sells NO_A and NO_B, receives YES_C
- noCount = 2, questionCount = 3
- avg NO price = $0.30
- YES price = (1.0 - 2 * 0.30) / (3 - 2) = $0.40
- User sells 2 NO at $0.30 each, buys 1 YES at $0.40

### 5. Redemption Flow

```
Market resolves
       ↓
ConditionalTokens.ConditionResolution event
       ↓
handleConditionResolution()
       ↓
Update Condition entity:
  - payoutNumerators = [winning_amount, losing_amount]
  - payoutDenominator = sum of numerators
  Example: YES wins → [1, 0], denominator = 1
  Example: 50/50 → [1, 1], denominator = 2

──────────────────────────────────────

User calls ConditionalTokens.redeemPositions()
       ↓
ConditionalTokens.PayoutRedemption event
       ↓
handlePayoutRedemption()
       ↓
Filter check:
  - Skip if redeemer = NegRiskAdapter (handled separately)
       ↓
Calculate payout price for each outcome:
  price = payoutNumerator * 10^6 / payoutDenominator
       ↓
For each outcome (YES, NO):
  - Get user's position amount
  - SELL entire position at payout price
  - Realizes final PnL

──────────────────────────────────────

User calls NegRiskAdapter.redeemPositions()
       ↓
NegRiskAdapter.PayoutRedemption event
       ↓
handlePayoutRedemption()
       ↓
Calculate payout price for each outcome
       ↓
For each outcome:
  - Use amount from event params (not user's full position)
  - SELL at payout price
```

**Redemption Example:**
- User bought YES at $0.60
- Market resolves YES (payoutNumerators = [1, 0])
- Redemption price = 1.0 * 10^6 / 1 = $1.00
- PnL = amount * ($1.00 - $0.60) = $0.40 per token

### 6. AMM Flow (FixedProductMarketMaker)

```
FPMM is created
       ↓
FixedProductMarketMakerFactory.FixedProductMarketMakerCreation event
       ↓
handleFixedProductMarketMakerCreation()
       ↓
Create FPMM entity:
  - id = FPMM address
  - conditionId = first condition ID
       ↓
Create dynamic data source (template) for this FPMM
       ↓
[Now listening to Buy/Sell/FundingAdded/FundingRemoved events]

──────────────────────────────────────

User buys from AMM
       ↓
FPMM.FPMMBuy event
       ↓
handleBuy()
       ↓
Calculate price = investmentAmount * 10^6 / outcomeTokensBought
       ↓
Get positionId from Condition entity
       ↓
updateUserPositionWithBuy(buyer, positionId, price, amount)

──────────────────────────────────────

User sells to AMM
       ↓
FPMM.FPMMSell event
       ↓
handleSell()
       ↓
Calculate price = returnAmount * 10^6 / outcomeTokensSold
       ↓
Get positionId from Condition entity
       ↓
updateUserPositionWithSell(seller, positionId, price, amount)

──────────────────────────────────────

User adds liquidity
       ↓
FPMM.FPMMFundingAdded event
       ↓
handleFundingAdded()
       ↓
Parse sendback details (which token was sent back)
       ↓
Phase 1: Track received token
  - Calculate price at time of funding
  - BUY the sendback token at market price
       ↓
Phase 2: Track LP shares
  - totalUSDCSpend = max(amountsAdded)
  - tokenCost = sendback_amount * sendback_price
  - lpShareCost = totalUSDCSpend - tokenCost
  - lpSharePrice = lpShareCost / sharesMinted
  - BUY LP shares at calculated price

──────────────────────────────────────

User removes liquidity
       ↓
FPMM.FPMMFundingRemoved event
       ↓
handleFundingRemoved()
       ↓
Phase 1: Track received tokens
  For each outcome (YES, NO):
    - Calculate market price at time of removal
    - BUY received tokens at market price
    - Track tokensCost
       ↓
Phase 2: Track LP shares burned
  - lpSalePrice = (collateralRemoved - tokensCost) / sharesBurnt
  - SELL LP shares at calculated price
```

**AMM Liquidity Example:**
- User adds $1000 liquidity
- Receives 10 YES tokens (worth $300) + 990 LP shares
- tokenCost = 10 * $30 = $300
- lpShareCost = $1000 - $300 = $700
- lpSharePrice = $700 / 990 = $0.707 per LP share
- User now tracks: 10 YES at $30, 990 LP at $0.707

---

## Critical Filtering Rules

### Events That Are IGNORED

| Contract | Event | Condition | Reason |
|----------|-------|-----------|--------|
| ConditionalTokens | PositionSplit | stakeholder = NegRiskAdapter | Handled by NegRiskAdapter handler |
| ConditionalTokens | PositionSplit | stakeholder = CTFExchange | Internal bookkeeping |
| ConditionalTokens | PositionsMerge | stakeholder = NegRiskAdapter | Handled by NegRiskAdapter handler |
| ConditionalTokens | PositionsMerge | stakeholder = CTFExchange | Internal bookkeeping |
| ConditionalTokens | PayoutRedemption | redeemer = NegRiskAdapter | Handled by NegRiskAdapter handler |
| NegRiskAdapter | PositionSplit | stakeholder = NegRiskExchange | Internal bookkeeping |
| NegRiskAdapter | PositionsMerge | stakeholder = NegRiskExchange | Internal bookkeeping |
| ConditionalTokens | ConditionPreparation | outcomeSlotCount != 2 | Only track binary markets |

**WHY THESE FILTERS EXIST:**

1. **NegRiskAdapter/NegRiskExchange filters**: Prevent double-counting when the adapter/exchange performs internal operations
2. **CTFExchange filters**: The exchange splits/merges on behalf of users but doesn't change user positions
3. **Outcome count filter**: Subgraph only supports binary (YES/NO) markets

---

## State Management

### UserPosition State Machine

```
New position (not exists)
       ↓
loadOrCreateUserPosition()
       ↓
Initial state:
  - amount = 0
  - avgPrice = 0
  - realizedPnl = 0
  - totalBought = 0
       ↓
       ├─ BUY event
       │    → amount increases
       │    → avgPrice updated (weighted average)
       │    → totalBought increases
       │
       └─ SELL event
            → amount decreases (up to current holdings)
            → realizedPnl increases (or decreases if loss)
            → avgPrice unchanged
```

### Condition State Machine

```
ConditionPreparation event
       ↓
createCondition()
       ↓
Initial state:
  - id = conditionId
  - positionIds = [yesTokenId, noTokenId]
  - payoutNumerators = []
  - payoutDenominator = 0
  - negRisk = (oracle == NegRiskAdapter)
       ↓
[Used for all trades/splits/merges]
       ↓
ConditionResolution event
       ↓
Update:
  - payoutNumerators = [winning_payout, losing_payout]
  - payoutDenominator = sum of numerators
       ↓
[Used for all redemptions]
```

### NegRiskEvent State Machine

```
MarketPrepared event
       ↓
handleMarketPrepared()
       ↓
Initial state:
  - id = marketId
  - questionCount = 0
       ↓
For each question:
  QuestionPrepared event
       ↓
  handleQuestionPrepared()
       ↓
  questionCount += 1
       ↓
[Used for PositionsConverted calculations]
```

---

## PnL Calculation Formula

### Core Formula (Realized PnL)

```typescript
// On BUY
newAvgPrice = (oldAvgPrice * oldAmount + buyPrice * buyAmount) / (oldAmount + buyAmount)
amount += buyAmount
totalBought += buyAmount

// On SELL
adjustedAmount = min(sellAmount, currentAmount)
deltaPnL = adjustedAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE
realizedPnl += deltaPnL
amount -= adjustedAmount
```

### Unrealized PnL (Not Tracked by Subgraph)

```typescript
// Calculated at query time
unrealizedPnL = amount * (currentPrice - avgPrice) / COLLATERAL_SCALE
```

### Total PnL

```typescript
totalPnL = realizedPnl + unrealizedPnL
```

---

## Important Constants

| Constant | Value | Usage |
|----------|-------|-------|
| `COLLATERAL_SCALE` | 10^6 | USDC has 6 decimals |
| `FIFTY_CENTS` | 500000 | Price for split/merge (0.50 * 10^6) |
| `TradeType.BUY` | 0 | Enum for buy side |
| `TradeType.SELL` | 1 | Enum for sell side |

---

## Trade Side Detection (parseOrderFilled)

```typescript
// From ExchangeMapping.ts
const side = event.params.makerAssetId.equals(BigInt.zero())
  ? TradeType.BUY
  : TradeType.SELL;

if (side == TradeType.BUY) {
  // User is buying tokens, paying USDC
  account = maker
  baseAmount = takerAmountFilled  // tokens received
  quoteAmount = makerAmountFilled // USDC paid
  positionId = takerAssetId
} else {
  // User is selling tokens, receiving USDC
  account = maker
  baseAmount = makerAmountFilled  // tokens sold
  quoteAmount = takerAmountFilled // USDC received
  positionId = makerAssetId
}
```

**Key Insight:**
- If `makerAssetId == 0`, maker is paying USDC (BUY)
- If `makerAssetId != 0`, maker is paying tokens (SELL)

---

## Edge Cases Handled

### 1. Selling More Than Holdings

```typescript
// In updateUserPositionWithSell
const adjustedAmount = amount.gt(userPosition.amount)
  ? userPosition.amount
  : amount;
```

**Scenario:** User acquired tokens outside tracked mechanisms (airdrops, transfers).
**Solution:** Only realize PnL for tracked holdings. Extra tokens sold at $0 cost basis (no PnL impact).

### 2. Zero-Amount Trades

```typescript
// In handleBuy/handleSell
if (event.params.outcomeTokensBought.isZero()) {
  return;
}
```

**Scenario:** Edge case trades with no token movement.
**Solution:** Skip processing entirely.

### 3. Unresolved Redemptions

```typescript
// In handlePayoutRedemption
if (condition.payoutDenominator == BigInt.zero()) {
  log.error('Failed to update market positions: payoutDenominator is 0', []);
  return;
}
```

**Scenario:** Redemption event before ConditionResolution event.
**Solution:** Log error and skip. Subgraph processes events in order, so this should never happen.

### 4. Markets with >2 Outcomes

```typescript
// In handleConditionPreparation
if (event.params.outcomeSlotCount.toI32() != 2) {
  return;
}
```

**Scenario:** Multi-outcome markets (3+ outcomes).
**Solution:** Ignore entirely. Only binary markets supported.

---

## Data Flow Summary

### Complete Trade Lifecycle

```
1. CONDITION PREPARATION
   ConditionalTokens emits ConditionPreparation
   → Subgraph creates Condition entity
   → positionIds calculated for YES/NO outcomes

2. MARKET CREATION
   FixedProductMarketMakerFactory emits FixedProductMarketMakerCreation
   → Subgraph creates FPMM entity
   → Dynamic template instantiated for AMM events

3. USER ACQUIRES TOKENS
   Option A: Buy from CLOB
     Exchange/NegRiskExchange emits OrderFilled
     → Subgraph calls updateUserPositionWithBuy
     → UserPosition.amount increases
     → UserPosition.avgPrice updated

   Option B: Split USDC
     ConditionalTokens/NegRiskAdapter emits PositionSplit
     → Subgraph calls updateUserPositionWithBuy for YES and NO
     → Both positions at $0.50 cost basis

   Option C: Buy from AMM
     FPMM emits FPMMBuy
     → Subgraph calls updateUserPositionWithBuy
     → Price calculated from investment/tokens ratio

4. USER TRADES TOKENS
   Option A: Sell on CLOB
     Exchange/NegRiskExchange emits OrderFilled
     → Subgraph calls updateUserPositionWithSell
     → UserPosition.realizedPnl increases/decreases
     → UserPosition.amount decreases

   Option B: Merge to USDC
     ConditionalTokens/NegRiskAdapter emits PositionsMerge
     → Subgraph calls updateUserPositionWithSell for YES and NO
     → Both positions sold at $0.50

   Option C: Sell to AMM
     FPMM emits FPMMSell
     → Subgraph calls updateUserPositionWithSell
     → Price calculated from return/tokens ratio

5. MARKET RESOLUTION
   ConditionalTokens emits ConditionResolution
   → Subgraph updates Condition.payoutNumerators
   → Condition.payoutDenominator set to sum

6. USER REDEEMS
   ConditionalTokens/NegRiskAdapter emits PayoutRedemption
   → Subgraph calculates payout price
   → Calls updateUserPositionWithSell for all positions
   → Final PnL realized
```

---

## Query Patterns

### Get User's Total Realized PnL

```graphql
{
  userPositions(where: { user: "0x..." }) {
    tokenId
    amount
    avgPrice
    realizedPnl
    totalBought
  }
}
```

Then sum `realizedPnl` across all positions.

### Get User's Current Holdings

```graphql
{
  userPositions(where: { user: "0x...", amount_gt: 0 }) {
    tokenId
    amount
    avgPrice
  }
}
```

Positions with `amount > 0` are still held.

### Calculate Unrealized PnL

```typescript
// For each position with amount > 0
const currentPrice = await getCurrentMarketPrice(tokenId)
const unrealizedPnl = position.amount * (currentPrice - position.avgPrice) / 10^6
```

**Note:** Current price must be fetched from external source (CLOB orderbook, AMM reserves).

---

## Performance Considerations

### Indexing Efficiency

- **Early filtering**: Ignore non-binary markets immediately
- **Lazy loading**: Only load Condition/NegRiskEvent when needed
- **Minimal writes**: Only save when state changes

### State Size

- **UserPosition**: One entity per user-token pair
- **Condition**: One entity per market (conditionId)
- **NegRiskEvent**: One entity per neg risk market
- **FPMM**: One entity per AMM instance

**Estimated Growth:**
- 10k active users * 100 markets = 1M UserPosition entities
- 1k markets = 1k Condition entities
- 100 neg risk markets = 100 NegRiskEvent entities
- 50 AMMs = 50 FPMM entities

---

## Comparison to Cascadian's Approach

| Feature | Polymarket Subgraph | Cascadian |
|---------|---------------------|-----------|
| **Data Source** | Blockchain events only | CLOB API + ERC1155 events |
| **PnL Calculation** | Real-time (event-driven) | Batch calculation (V1) / API fetch (V7) |
| **Cost Basis** | FIFO weighted average | FIFO weighted average (V1) |
| **Neg Risk Handling** | Separate handlers + conversions | Attempted mapping (failed) |
| **State Management** | Graph entities (persistent) | ClickHouse tables |
| **Redemptions** | Tracked separately | Attempted integration (complex) |
| **AMM Support** | Full support (FPMM events) | Not tracked |
| **Performance** | Sub-second queries | 2-30s for V1 calculation |

### Why Cascadian Can't Replicate This

1. **Event ordering**: Subgraph processes events in blockchain order. Cascadian's CLOB data is missing this ordering.
2. **Internal bookkeeping**: Subgraph filters out CTFExchange/NegRiskAdapter internal events. Cascadian sees them in CLOB data as real trades.
3. **AMM data**: Cascadian doesn't ingest AMM events (FPMMBuy, FPMMSell).
4. **Redemptions**: Cascadian doesn't track PayoutRedemption events.
5. **Neg risk conversions**: Cascadian doesn't have PositionsConverted events or the indexSet logic.

**Root Cause:** Cascadian relies on CLOB API which contains adapter-generated bookkeeping trades. The subgraph filters these out at the source.

---

## Recommendations for Cascadian

### Short Term (API-based approach - CURRENT)

1. **Continue using V7 (Polymarket API)** as primary PnL source
2. Accept that CLOB-only calculation is impossible for neg risk markets
3. Document the root cause clearly (adapter bookkeeping trades)

### Medium Term (Hybrid approach)

1. Ingest ERC1155 transfer events for splits/merges/redemptions
2. Use CLOB data ONLY for Exchange.OrderFilled events
3. Filter out trades where maker/taker = NegRiskAdapter address
4. Track redemptions separately from trades

### Long Term (Subgraph replication)

1. Run own Graph node with Polymarket's PnL subgraph
2. Query UserPosition entities directly
3. Supplement with CLOB data for real-time updates
4. Maintain fallback to API if subgraph unavailable

**Effort Estimate:**
- Hybrid approach: 2-3 weeks
- Subgraph replication: 1-2 months

---

## Appendix: File Structure

```
polymarket-subgraph/
├── pnl-subgraph/
│   ├── src/
│   │   ├── ConditionalTokensMapping.ts     # Splits, merges, redemptions
│   │   ├── ExchangeMapping.ts              # CLOB trades
│   │   ├── FixedProductMarketMakerMapping.ts   # AMM trades
│   │   ├── NegRiskAdapterMapping.ts        # Neg risk conversions
│   │   ├── FixedProductMarketMakerFactoryMapping.ts  # AMM creation
│   │   └── utils/
│   │       ├── updateUserPositionWithBuy.ts
│   │       ├── updateUserPositionWithSell.ts
│   │       ├── loadOrCreateUserPosition.ts
│   │       ├── parseOrderFilled.ts
│   │       └── [other helpers]
│   ├── schema.graphql                      # Entity definitions
│   └── subgraph.template.yaml              # Event mappings
├── common/
│   └── constants.template.ts               # Contract addresses, constants
└── abis/
    ├── ConditionalTokens.json
    ├── Exchange.json
    ├── NegRiskAdapter.json
    ├── FixedProductMarketMaker.json
    └── FixedProductMarketMakerFactory.json
```

---

## Key Takeaways

1. **Two core operations**: `updateUserPositionWithBuy` and `updateUserPositionWithSell` handle ALL PnL tracking
2. **FIFO average cost**: Same approach as Cascadian V1, but applied to all event types
3. **Critical filtering**: Adapter/exchange internal events are ignored to prevent double-counting
4. **Event ordering matters**: Blockchain events processed sequentially maintain consistent state
5. **Neg risk is special**: Separate handlers + conversion logic required
6. **AMM support**: Full integration with FPMM events for liquidity providers
7. **Cascadian's challenge**: CLOB API contains bookkeeping trades that subgraph filters out

**Bottom line:** Polymarket's subgraph succeeds because it has access to raw blockchain events with proper filtering. Cascadian's CLOB-only approach fails because the API includes internal bookkeeping trades that should be ignored.
