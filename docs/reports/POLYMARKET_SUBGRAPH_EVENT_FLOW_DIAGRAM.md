# Polymarket Subgraph Event Flow Diagram

## Complete Event Handler Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         POLYMARKET SUBGRAPH ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
└──────────────────────────────────────────────────────────────────────────────┘

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 1. ConditionalTokens Contract                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: ConditionPreparation
├─ Handler: handleConditionPreparation()
├─ File: ConditionalTokensMapping.ts
├─ Action: Create new Condition entity (if outcomeSlotCount == 2)
└─ Stores: conditionId, positionIds[YES, NO], negRisk flag

Event: ConditionResolution
├─ Handler: handleConditionResolution()
├─ File: ConditionalTokensMapping.ts
├─ Action: Update Condition with payout ratios
└─ Stores: payoutNumerators[], payoutDenominator

Event: PositionSplit
├─ Handler: handlePositionSplit()
├─ File: ConditionalTokensMapping.ts
├─ Filters: SKIP if stakeholder = NegRiskAdapter | CTFExchange
├─ Action: User splits USDC → YES + NO tokens
└─ Effect: BUY YES at $0.50, BUY NO at $0.50

Event: PositionsMerge
├─ Handler: handlePositionsMerge()
├─ File: ConditionalTokensMapping.ts
├─ Filters: SKIP if stakeholder = NegRiskAdapter | CTFExchange
├─ Action: User merges YES + NO → USDC
└─ Effect: SELL YES at $0.50, SELL NO at $0.50

Event: PayoutRedemption
├─ Handler: handlePayoutRedemption()
├─ File: ConditionalTokensMapping.ts
├─ Filters: SKIP if redeemer = NegRiskAdapter
├─ Action: User redeems winning tokens for USDC
└─ Effect: SELL all positions at payout price

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 2. Exchange Contract (CTFExchange)                                         ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: OrderFilled
├─ Handler: handleOrderFilled()
├─ File: ExchangeMapping.ts
├─ Action: Process CLOB trade
├─ Parse: 
│  ├─ If makerAssetId == 0 → BUY (maker pays USDC, receives tokens)
│  └─ If makerAssetId != 0 → SELL (maker pays tokens, receives USDC)
└─ Effect: 
   ├─ BUY → updateUserPositionWithBuy(maker, price, amount)
   └─ SELL → updateUserPositionWithSell(maker, price, amount)

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 3. NegRiskExchange Contract                                                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: OrderFilled
├─ Handler: handleOrderFilled() [SAME AS CTFExchange]
├─ File: ExchangeMapping.ts
└─ Effect: Identical to CTFExchange.OrderFilled

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 4. NegRiskAdapter Contract                                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: MarketPrepared
├─ Handler: handleMarketPrepared()
├─ File: NegRiskAdapterMapping.ts
├─ Action: Create NegRiskEvent entity
└─ Stores: marketId, questionCount = 0

Event: QuestionPrepared
├─ Handler: handleQuestionPrepared()
├─ File: NegRiskAdapterMapping.ts
├─ Action: Increment questionCount for market
└─ Stores: Updated questionCount

Event: PositionSplit
├─ Handler: handlePositionSplit()
├─ File: NegRiskAdapterMapping.ts
├─ Filters: SKIP if stakeholder = NegRiskExchange
├─ Action: User splits via adapter
└─ Effect: BUY YES at $0.50, BUY NO at $0.50

Event: PositionsMerge
├─ Handler: handlePositionsMerge()
├─ File: NegRiskAdapterMapping.ts
├─ Filters: SKIP if stakeholder = NegRiskExchange
├─ Action: User merges via adapter
└─ Effect: SELL YES at $0.50, SELL NO at $0.50

Event: PositionsConverted
├─ Handler: handlePositionsConverted()
├─ File: NegRiskAdapterMapping.ts
├─ Action: Convert NO tokens from some questions → YES tokens in others
├─ Parse indexSet to determine which questions
├─ Phase 1: SELL NO tokens at their avgPrice
├─ Calculate: avgNoPrice = sum(NO prices) / noCount
├─ Calculate: yesPrice = (1.0 - noCount * avgNoPrice) / (questionCount - noCount)
└─ Phase 2: BUY YES tokens at calculated yesPrice

Event: PayoutRedemption
├─ Handler: handlePayoutRedemption()
├─ File: NegRiskAdapterMapping.ts
├─ Action: Redeem via adapter
└─ Effect: SELL positions at payout price (uses event.params.amounts)

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 5. FixedProductMarketMakerFactory Contract                                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: FixedProductMarketMakerCreation
├─ Handler: handleFixedProductMarketMakerCreation()
├─ File: FixedProductMarketMakerFactoryMapping.ts
├─ Action: Create FPMM entity + instantiate dynamic template
└─ Stores: FPMM address, conditionId

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ 6. FixedProductMarketMaker Template (Dynamic)                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

Event: FPMMBuy
├─ Handler: handleBuy()
├─ File: FixedProductMarketMakerMapping.ts
├─ Action: User buys from AMM
├─ Calculate: price = investmentAmount / outcomeTokensBought
└─ Effect: BUY tokens at calculated price

Event: FPMMSell
├─ Handler: handleSell()
├─ File: FixedProductMarketMakerMapping.ts
├─ Action: User sells to AMM
├─ Calculate: price = returnAmount / outcomeTokensSold
└─ Effect: SELL tokens at calculated price

Event: FPMMFundingAdded
├─ Handler: handleFundingAdded()
├─ File: FixedProductMarketMakerMapping.ts
├─ Action: User adds liquidity
├─ Phase 1: Track sendback token
│  ├─ Calculate: sendback price
│  └─ BUY sendback tokens at market price
└─ Phase 2: Track LP shares
   ├─ Calculate: lpSharePrice = (totalUSDC - tokenCost) / sharesMinted
   └─ BUY LP shares at calculated price

Event: FPMMFundingRemoved
├─ Handler: handleFundingRemoved()
├─ File: FixedProductMarketMakerMapping.ts
├─ Action: User removes liquidity
├─ Phase 1: Track received tokens
│  ├─ Calculate: market price for YES/NO
│  └─ BUY received tokens at market price
└─ Phase 2: Track LP shares burned
   ├─ Calculate: lpSalePrice = (collateralRemoved - tokensCost) / sharesBurnt
   └─ SELL LP shares at calculated price


┌──────────────────────────────────────────────────────────────────────────────┐
│                         CORE STATE OPERATIONS                                │
└──────────────────────────────────────────────────────────────────────────────┘

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ updateUserPositionWithBuy(user, positionId, price, amount)                 ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

File: utils/updateUserPositionWithBuy.ts

LOGIC:
  1. Load or create UserPosition entity
  2. Calculate new average price:
     newAvgPrice = (oldAvgPrice * oldAmount + price * amount) / (oldAmount + amount)
  3. Update amount: amount += buyAmount
  4. Update totalBought: totalBought += buyAmount
  5. Save entity

EFFECT: Increases position, updates cost basis

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ updateUserPositionWithSell(user, positionId, price, amount)                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

File: utils/updateUserPositionWithSell.ts

LOGIC:
  1. Load or create UserPosition entity
  2. Adjust amount if selling more than holdings:
     adjustedAmount = min(sellAmount, currentAmount)
  3. Calculate PnL delta:
     deltaPnL = adjustedAmount * (price - avgPrice) / COLLATERAL_SCALE
  4. Update realizedPnl: realizedPnl += deltaPnL
  5. Update amount: amount -= adjustedAmount
  6. Save entity

EFFECT: Decreases position, realizes PnL (avgPrice unchanged)


┌──────────────────────────────────────────────────────────────────────────────┐
│                         ENTITY RELATIONSHIPS                                 │
└──────────────────────────────────────────────────────────────────────────────┘

UserPosition
  ├─ id: "{userAddress}-{tokenId}"
  ├─ user: Address (hex)
  ├─ tokenId: BigInt (position ID)
  ├─ amount: BigInt (current holdings)
  ├─ avgPrice: BigInt (cost basis)
  ├─ realizedPnl: BigInt (cumulative PnL)
  └─ totalBought: BigInt (lifetime purchases)

Condition
  ├─ id: conditionId (32-byte hex)
  ├─ positionIds: [yesTokenId, noTokenId]
  ├─ payoutNumerators: [winAmount, loseAmount]
  └─ payoutDenominator: sum of numerators

NegRiskEvent
  ├─ id: marketId
  └─ questionCount: Number of questions in market

FPMM
  ├─ id: FPMM address
  └─ conditionId: Associated condition


┌──────────────────────────────────────────────────────────────────────────────┐
│                         TRADE TYPE DECISION TREE                             │
└──────────────────────────────────────────────────────────────────────────────┘

OrderFilled Event
    ├─ makerAssetId == 0?
    │  ├─ YES → BUY
    │  │  ├─ account = maker
    │  │  ├─ baseAmount = takerAmountFilled (tokens received)
    │  │  ├─ quoteAmount = makerAmountFilled (USDC paid)
    │  │  ├─ positionId = takerAssetId
    │  │  └─ price = quoteAmount / baseAmount
    │  │
    │  └─ NO → SELL
    │     ├─ account = maker
    │     ├─ baseAmount = makerAmountFilled (tokens sold)
    │     ├─ quoteAmount = takerAmountFilled (USDC received)
    │     ├─ positionId = makerAssetId
    │     └─ price = quoteAmount / baseAmount


┌──────────────────────────────────────────────────────────────────────────────┐
│                    CRITICAL FILTER RULES (PREVENT DOUBLE-COUNTING)           │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ConditionalTokens.PositionSplit                                             │
│ ✗ SKIP if stakeholder = NegRiskAdapter (handled by NegRiskAdapterMapping)  │
│ ✗ SKIP if stakeholder = CTFExchange (internal bookkeeping)                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ConditionalTokens.PositionsMerge                                            │
│ ✗ SKIP if stakeholder = NegRiskAdapter (handled by NegRiskAdapterMapping)  │
│ ✗ SKIP if stakeholder = CTFExchange (internal bookkeeping)                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ConditionalTokens.PayoutRedemption                                          │
│ ✗ SKIP if redeemer = NegRiskAdapter (handled by NegRiskAdapterMapping)     │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ NegRiskAdapter.PositionSplit                                                │
│ ✗ SKIP if stakeholder = NegRiskExchange (internal bookkeeping)             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ NegRiskAdapter.PositionsMerge                                               │
│ ✗ SKIP if stakeholder = NegRiskExchange (internal bookkeeping)             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ConditionalTokens.ConditionPreparation                                      │
│ ✗ SKIP if outcomeSlotCount != 2 (only binary markets supported)            │
└─────────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                         TRADE LIFECYCLE EXAMPLE                              │
└──────────────────────────────────────────────────────────────────────────────┘

1. MARKET CREATION
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ ConditionalTokens.ConditionPreparation                                  │
   │ ├─ conditionId = 0xabc123...                                            │
   │ ├─ outcomeSlotCount = 2                                                 │
   │ └─ Create Condition entity                                              │
   │    ├─ positionIds = [0x111..., 0x222...]                                │
   │    └─ negRisk = false                                                   │
   └─────────────────────────────────────────────────────────────────────────┘

2. USER SPLITS USDC
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ ConditionalTokens.PositionSplit                                         │
   │ ├─ stakeholder = 0xUSER                                                 │
   │ ├─ amount = 100 (100 USDC → 100 YES + 100 NO)                          │
   │ └─ Effect:                                                              │
   │    ├─ BUY 100 YES at $0.50 → cost = $50                                │
   │    └─ BUY 100 NO at $0.50 → cost = $50                                 │
   │                             Total cost = $100 ✓                         │
   └─────────────────────────────────────────────────────────────────────────┘

3. USER BUYS MORE YES ON CLOB
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Exchange.OrderFilled                                                    │
   │ ├─ maker = 0xUSER                                                       │
   │ ├─ makerAssetId = 0 (paying USDC)                                       │
   │ ├─ makerAmountFilled = 36 USDC                                          │
   │ ├─ takerAmountFilled = 50 YES                                           │
   │ └─ Effect:                                                              │
   │    ├─ BUY 50 YES at $0.72 (36/50)                                       │
   │    ├─ Old position: 100 YES at $0.50                                    │
   │    └─ New position: 150 YES at $0.573 ((50*100 + 36*50)/150)           │
   └─────────────────────────────────────────────────────────────────────────┘

4. USER SELLS SOME YES
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ Exchange.OrderFilled                                                    │
   │ ├─ maker = 0xUSER                                                       │
   │ ├─ makerAssetId = 0x111... (YES token)                                  │
   │ ├─ makerAmountFilled = 80 YES                                           │
   │ ├─ takerAmountFilled = 68 USDC                                          │
   │ └─ Effect:                                                              │
   │    ├─ SELL 80 YES at $0.85 (68/80)                                      │
   │    ├─ PnL = 80 * (0.85 - 0.573) = +$22.16                              │
   │    ├─ realizedPnl += 22.16                                              │
   │    └─ New position: 70 YES at $0.573 (avgPrice unchanged)              │
   └─────────────────────────────────────────────────────────────────────────┘

5. MARKET RESOLVES (YES wins)
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ ConditionalTokens.ConditionResolution                                   │
   │ ├─ conditionId = 0xabc123...                                            │
   │ ├─ payoutNumerators = [1, 0] (YES wins, NO loses)                      │
   │ └─ payoutDenominator = 1                                                │
   └─────────────────────────────────────────────────────────────────────────┘

6. USER REDEEMS
   ┌─────────────────────────────────────────────────────────────────────────┐
   │ ConditionalTokens.PayoutRedemption                                      │
   │ ├─ redeemer = 0xUSER                                                    │
   │ ├─ Current positions:                                                   │
   │ │  ├─ 70 YES at avgPrice $0.573                                         │
   │ │  └─ 100 NO at avgPrice $0.50                                          │
   │ └─ Effect:                                                              │
   │    ├─ SELL 70 YES at $1.00 → PnL = 70 * (1.00 - 0.573) = +$29.89      │
   │    ├─ SELL 100 NO at $0.00 → PnL = 100 * (0.00 - 0.50) = -$50.00      │
   │    └─ Total PnL = $22.16 + $29.89 - $50.00 = +$2.05                    │
   └─────────────────────────────────────────────────────────────────────────┘

FINAL RECONCILIATION:
  Cash flow: -$100 (split) - $36 (buy) + $68 (sell) + $70 (redeem YES) = +$2.00
  Realized PnL: +$2.05 (≈ $2.00 with rounding)
  ✓ MATCH
