# Polymarket API Reference - Copy Trading Integration

## Quick Reference Card

### Package Information
- **NPM Package**: `@polymarket/clob-client`
- **Version**: 4.22.8
- **Repository**: https://github.com/Polymarket/clob-client
- **TypeScript**: Yes, fully typed
- **Dependencies**: `ethers` (v6+)

### Endpoints
- **Production CLOB**: `https://clob.polymarket.com`
- **Gamma API**: `https://gamma-api.polymarket.com`
- **Chain**: Polygon (137)

---

## Core API Methods

### Client Initialization

```typescript
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";

// Create wallet
const wallet = new Wallet(privateKey);

// Initialize client
const client = new ClobClient(
  "https://clob.polymarket.com",  // host
  137,                              // chainId (Polygon mainnet)
  wallet                            // signer
);

// Create/derive API credentials
const creds = await client.createOrDeriveApiKey();
// Credentials are automatically set on client
```

### Market Data Methods

```typescript
// Get single market by condition ID
const market = await client.getMarket(conditionId);
// Returns: { condition_id, tokens: [{token_id, outcome, price}], ... }

// Get all markets (paginated)
const markets = await client.getMarkets(nextCursor);

// Get simplified markets (less data)
const simplified = await client.getSimplifiedMarkets(nextCursor);

// Get orderbook for token
const orderbook = await client.getOrderBook(tokenId);
// Returns: { market, asset_id, bids: [], asks: [] }

// Get current price
const price = await client.getPrice(tokenId);
// Returns: number (e.g., 0.52)

// Get tick size
const tickSize = await client.getTickSize(tokenId);
// Returns: "0.01" or "0.001"

// Check if negative risk market
const negRisk = await client.getNegRisk(tokenId);
// Returns: boolean
```

### Order Execution Methods

```typescript
// Create and post market order (one step)
const result = await client.createAndPostMarketOrder(
  {
    tokenID: string,
    amount: number,     // USD for BUY, shares for SELL
    side: Side.BUY | Side.SELL,
    orderType?: OrderType.FOK | OrderType.FAK,
  },
  {
    tickSize: string,   // e.g., "0.01"
    negRisk: boolean,
  },
  OrderType.FOK | OrderType.FAK
);

// Returns: OrderResponse
// {
//   success: boolean,
//   orderID: string,
//   transactionsHashes: string[],
//   status: string,
//   takingAmount: string,
//   makingAmount: string
// }

// Create and post limit order
const result = await client.createAndPostOrder(
  {
    tokenID: string,
    price: number,
    size: number,
    side: Side.BUY | Side.SELL,
    feeRateBps?: number,
  },
  {
    tickSize: string,
    negRisk: boolean,
  },
  OrderType.GTC
);
```

### Account Management Methods

```typescript
// Get balance and allowance
const balance = await client.getBalanceAllowance({
  asset_type: 'USDC'
});
// Returns: { balance: string, allowance: string }

// Update allowance (approve spending)
await client.updateBalanceAllowance({
  asset_type: 'USDC',
  exchange_address: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  amount: 'max' | number,
});

// Get open orders
const orders = await client.getOpenOrders();

// Get trades
const trades = await client.getTrades({ market: conditionId });

// Cancel order
await client.cancelOrder(orderId);

// Cancel all orders
await client.cancelAll();
```

---

## Type Definitions

### Side Enum
```typescript
enum Side {
  BUY = "BUY",
  SELL = "SELL"
}
```

### OrderType Enum
```typescript
enum OrderType {
  GTC = "GTC",  // Good til Cancelled
  FOK = "FOK",  // Fill or Kill
  GTD = "GTD",  // Good til Date
  FAK = "FAK",  // Fill and Kill
}
```

### UserMarketOrder Interface
```typescript
interface UserMarketOrder {
  tokenID: string;
  amount: number;
  side: Side;
  price?: number;
  feeRateBps?: number;
  nonce?: number;
  taker?: string;
  orderType?: OrderType.FOK | OrderType.FAK;
}
```

### OrderResponse Interface
```typescript
interface OrderResponse {
  success: boolean;
  errorMsg: string;
  orderID: string;
  transactionsHashes: string[];
  status: string;
  takingAmount: string;
  makingAmount: string;
}
```

### Market Data Interface
```typescript
interface Market {
  condition_id: string;
  question: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: string;
  }>;
  minimum_tick_size: string;
  neg_risk: boolean;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  // ... more fields
}
```

---

## Common Patterns

### Pattern 1: Execute Market Buy

```typescript
// Full workflow for buying YES
const conditionId = "0x123...";
const side = "YES";
const amountUsd = 100;

// 1. Get market data
const market = await client.getMarket(conditionId);

// 2. Find token ID
const token = market.tokens.find(t => 
  t.outcome === (side === 'YES' ? 'Yes' : 'No')
);
const tokenId = token.token_id;

// 3. Get metadata
const tickSize = await client.getTickSize(tokenId);
const negRisk = await client.getNegRisk(tokenId);

// 4. Execute order
const result = await client.createAndPostMarketOrder(
  {
    tokenID: tokenId,
    amount: amountUsd,
    side: Side.BUY,
    orderType: OrderType.FOK,
  },
  { tickSize, negRisk },
  OrderType.FOK
);

// 5. Parse result
if (result.success) {
  const executedPrice = parseFloat(result.takingAmount) / parseFloat(result.makingAmount);
  const executedShares = parseFloat(result.makingAmount);
  console.log(`Bought ${executedShares} shares at ${executedPrice}`);
}
```

### Pattern 2: Check Balance Before Trade

```typescript
async function canAffordTrade(amountUsd: number): Promise<boolean> {
  const balance = await client.getBalanceAllowance({
    asset_type: 'USDC'
  });
  
  return parseFloat(balance.balance) >= amountUsd;
}

// Use before trading
if (await canAffordTrade(100)) {
  // Execute trade
} else {
  console.warn('Insufficient balance');
}
```

### Pattern 3: Get Current Market Price

```typescript
async function getCurrentPrice(conditionId: string, side: 'YES' | 'NO'): Promise<number> {
  const market = await client.getMarket(conditionId);
  const token = market.tokens.find(t => 
    t.outcome === (side === 'YES' ? 'Yes' : 'No')
  );
  
  return await client.getPrice(token.token_id);
}

// Use for slippage checks
const currentPrice = await getCurrentPrice(conditionId, 'YES');
const sourcePrice = 0.52;
const slippage = Math.abs(currentPrice - sourcePrice) / sourcePrice;

if (slippage > 0.05) {
  console.warn('High slippage detected:', slippage * 100, '%');
}
```

### Pattern 4: Sell Position

```typescript
// Selling shares (closing position)
async function closePosition(
  conditionId: string,
  side: 'YES' | 'NO',
  shares: number
): Promise<OrderResponse> {
  const market = await client.getMarket(conditionId);
  const token = market.tokens.find(t => 
    t.outcome === (side === 'YES' ? 'Yes' : 'No')
  );
  
  const tickSize = await client.getTickSize(token.token_id);
  const negRisk = await client.getNegRisk(token.token_id);
  
  return await client.createAndPostMarketOrder(
    {
      tokenID: token.token_id,
      amount: shares,  // Note: shares, not USD
      side: Side.SELL,
      orderType: OrderType.FOK,
    },
    { tickSize, negRisk },
    OrderType.FOK
  );
}
```

---

## Error Handling

### Common Errors

```typescript
try {
  const result = await client.createAndPostMarketOrder(...);
} catch (error) {
  if (error.message.includes('insufficient balance')) {
    // Handle insufficient funds
  } else if (error.message.includes('market closed')) {
    // Handle closed market
  } else if (error.message.includes('rate limit')) {
    // Handle rate limiting
  } else if (error.message.includes('slippage')) {
    // Handle high slippage
  } else {
    // Generic error handling
    console.error('Order failed:', error);
  }
}
```

### Order Status Codes

- `MATCHED`: Order fully filled
- `RESTING`: Limit order on book (not used for market orders)
- `CANCELED`: Order canceled
- `EXPIRED`: Order expired
- `FAILED`: Order failed

---

## Rate Limits

### Default Limits (verify with Polymarket)
- Public endpoints: 100 req/min
- Authenticated endpoints: 300 req/min
- Order placement: 60 orders/min

### Handling Rate Limits

```typescript
class RateLimiter {
  private lastCall = 0;
  private minInterval = 1000; // 1 second

  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    
    if (elapsed < this.minInterval) {
      await new Promise(r => setTimeout(r, this.minInterval - elapsed));
    }
    
    this.lastCall = Date.now();
  }
}

const limiter = new RateLimiter();

// Before each API call
await limiter.throttle();
const result = await client.createAndPostMarketOrder(...);
```

---

## Wallet Addresses (Polygon)

### Exchange Contracts
- **CTF Exchange**: `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`
- **Neg Risk Exchange**: `0xC5d563A36AE78145C45a50134d48A1215220f80a`
- **Neg Risk Adapter**: `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296`

### Token Contracts
- **USDC**: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- **CTF**: `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`

### Approval Setup
```typescript
// Must approve USDC spending before trading
await client.updateBalanceAllowance({
  asset_type: 'USDC',
  exchange_address: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  amount: 'max',
});
```

---

## Integration Checklist

### Setup
- [ ] Install `@polymarket/clob-client` and `ethers`
- [ ] Set `POLYMARKET_PK` environment variable
- [ ] Create wallet instance
- [ ] Initialize ClobClient
- [ ] Derive API credentials

### Trading
- [ ] Fetch market data
- [ ] Extract token ID for side (YES/NO)
- [ ] Get tick size and neg risk
- [ ] Check balance before order
- [ ] Execute market order
- [ ] Parse execution response
- [ ] Handle errors gracefully

### Monitoring
- [ ] Log execution metrics
- [ ] Track slippage
- [ ] Monitor balance
- [ ] Set up alerts
- [ ] Record to database

---

## Mapping to Our Types

```typescript
// Our TradeSide → Polymarket Side
const polymarketSide = tradeSide === 'YES' ? Side.BUY : Side.SELL;

// Our ExecutionResult ← Polymarket OrderResponse
const executionResult: ExecutionResult = {
  success: orderResponse.success,
  order_id: orderResponse.orderID,
  transaction_hash: orderResponse.transactionsHashes[0],
  executed_shares: parseFloat(orderResponse.makingAmount),
  executed_price: parseFloat(orderResponse.takingAmount) / parseFloat(orderResponse.makingAmount),
  total_cost: parseFloat(orderResponse.takingAmount),
  fees: parseFloat(orderResponse.takingAmount) * 0.02,
};
```

---

## Testing

### Mock Mode
```typescript
// Keep MOCK_TRADING=true for testing
if (process.env.MOCK_TRADING !== 'false') {
  return executeMock(strategy, trade, decision, owrr);
}
```

### Real Mode (Start Small)
```typescript
// Limit position sizes during testing
const MAX_TEST_POSITION = 5; // $5 max
const positionSize = Math.min(calculatedSize, MAX_TEST_POSITION);
```

---

## Resources

- [CLOB Client GitHub](https://github.com/Polymarket/clob-client)
- [Examples Directory](https://github.com/Polymarket/clob-client/tree/main/examples)
- [Polymarket Docs](https://docs.polymarket.com/)
- [Gamma API Docs](https://gamma-api.polymarket.com/docs)
- [Order Utils](https://github.com/Polymarket/order-utils)

---

## See Also

- [Full Integration Guide](./POLYMARKET_INTEGRATION_GUIDE.md)
- [Quick Start Guide](./POLYMARKET_QUICK_START.md)
- [Current Executor Implementation](../lib/trading/polymarket-executor.ts)
