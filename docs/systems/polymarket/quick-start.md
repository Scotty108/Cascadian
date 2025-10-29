# Polymarket Integration Quick Start

## TL;DR

To integrate real Polymarket trading into our copy trading system:

1. Install: `pnpm add @polymarket/clob-client ethers`
2. Set env var: `POLYMARKET_PK=your_private_key`
3. Update `PolymarketExecutor` with CLOB client
4. Start with small positions in MOCK mode, then enable real trading

---

## 5-Minute Integration

### 1. Install Dependencies

```bash
pnpm add @polymarket/clob-client ethers
```

### 2. Update PolymarketExecutor

Replace the `executeReal()` method in `/lib/trading/polymarket-executor.ts`:

```typescript
import { ClobClient, Side, OrderType } from "@polymarket/clob-client";
import { Wallet } from "ethers";

export class PolymarketExecutor {
  private clobClient?: ClobClient;
  private isInitialized = false;

  // Add initialization method
  private async initializeClobClient(): Promise<void> {
    if (this.isInitialized) return;

    const privateKey = process.env.POLYMARKET_PK;
    if (!privateKey) throw new Error('POLYMARKET_PK not set');

    const wallet = new Wallet(privateKey);
    const host = "https://clob.polymarket.com";
    const chainId = 137;
    
    this.clobClient = new ClobClient(host, chainId, wallet);
    await this.clobClient.createOrDeriveApiKey();
    
    this.isInitialized = true;
    console.log('[PolymarketExecutor] CLOB client ready');
  }

  // Replace executeReal() method
  private async executeReal(
    strategy: Strategy,
    trade: Trade,
    decision: CopyDecision,
    owrr: OWRRResult
  ): Promise<ExecutionResult> {
    await this.initializeClobClient();
    
    if (!this.clobClient) {
      throw new Error('CLOB client not initialized');
    }

    // 1. Get market metadata
    const market = await this.clobClient.getMarket(trade.market_id);
    const tokenData = market.tokens.find((t: any) => 
      t.outcome === (trade.side === 'YES' ? 'Yes' : 'No')
    );
    const tokenId = tokenData.token_id;
    const tickSize = await this.clobClient.getTickSize(tokenId);
    const negRisk = await this.clobClient.getNegRisk(tokenId);

    // 2. Execute market order
    const positionSizeUsd = decision.factors?.position_size_usd || trade.usd_value;
    
    const orderResponse = await this.clobClient.createAndPostMarketOrder(
      {
        tokenID: tokenId,
        amount: positionSizeUsd,
        side: trade.side === 'YES' ? Side.BUY : Side.SELL,
        orderType: OrderType.FOK,
      },
      { tickSize, negRisk },
      OrderType.FOK
    );

    // 3. Parse results
    const executedPrice = parseFloat(orderResponse.takingAmount) / parseFloat(orderResponse.makingAmount);
    const executedShares = parseFloat(orderResponse.makingAmount);
    const totalCost = parseFloat(orderResponse.takingAmount);
    const fees = totalCost * 0.02;

    // 4. Record to database
    const copyTradeId = await this.recordCopyTrade(
      strategy, trade, decision, owrr,
      {
        orderId: orderResponse.orderID,
        transactionHash: orderResponse.transactionsHashes[0] || '',
        executedShares,
        executedPrice,
        totalCost,
        fees,
      }
    );

    return {
      success: true,
      order_id: orderResponse.orderID,
      transaction_hash: orderResponse.transactionsHashes[0],
      executed_shares: executedShares,
      executed_price: executedPrice,
      total_cost: totalCost,
      fees,
      copy_trade_id: copyTradeId,
    };
  }
}
```

### 3. Environment Setup

```env
# .env.local
POLYMARKET_PK=your_wallet_private_key_here
MOCK_TRADING=true  # Set to 'false' to enable real trading
```

### 4. Test Flow

```bash
# 1. Test in mock mode (safe)
MOCK_TRADING=true npm run dev

# 2. Enable real trading (carefully)
MOCK_TRADING=false npm run dev
```

---

## Key Concepts

### Market Orders

```typescript
// BUY YES shares worth $100
await client.createAndPostMarketOrder(
  {
    tokenID: "...",
    amount: 100,        // USD amount for BUY
    side: Side.BUY,
    orderType: OrderType.FOK,
  },
  { tickSize: "0.01", negRisk: false },
  OrderType.FOK
);

// SELL shares (closing position)
await client.createAndPostMarketOrder(
  {
    tokenID: "...",
    amount: 200,        // Number of shares for SELL
    side: Side.SELL,
    orderType: OrderType.FOK,
  },
  { tickSize: "0.01", negRisk: false },
  OrderType.FOK
);
```

### Token IDs

Each market has TWO token IDs:
- YES token (for buying YES outcome)
- NO token (for buying NO outcome)

Fetch via: `await client.getMarket(conditionId)`

### Order Types

- **FOK** (Fill or Kill): All or nothing (recommended for copy trading)
- **FAK** (Fill and Kill): Partial fills OK
- **GTC** (Good til Cancel): Limit order
- **GTD** (Good til Date): Limit order with expiration

---

## Pre-Trading Checklist

- [ ] Install `@polymarket/clob-client` and `ethers`
- [ ] Set `POLYMARKET_PK` environment variable
- [ ] Fund wallet with USDC on Polygon
- [ ] Approve USDC allowances (one-time setup)
- [ ] Test in MOCK mode first
- [ ] Start with small positions ($1-5)
- [ ] Monitor execution logs
- [ ] Set up balance alerts

---

## Wallet Setup (One-Time)

### 1. Create Dedicated Wallet

```typescript
// Generate new wallet
import { Wallet } from "ethers";
const wallet = Wallet.createRandom();
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);
```

### 2. Fund with USDC

- Send USDC to wallet address on Polygon
- Minimum: $100 for testing
- Recommended: $500-1000 for production

### 3. Approve Allowances

```typescript
// Run this script once
import { ClobClient } from "@polymarket/clob-client";
import { Wallet } from "ethers";

const wallet = new Wallet(process.env.POLYMARKET_PK);
const client = new ClobClient("https://clob.polymarket.com", 137, wallet);

// Approve USDC for CTF exchange
await client.updateBalanceAllowance({
  asset_type: 'USDC',
  exchange_address: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  amount: 'max',
});

// Approve USDC for Neg Risk exchange
await client.updateBalanceAllowance({
  asset_type: 'USDC',
  exchange_address: '0xC5d563A36AE78145C45a50134d48A1215220f80a',
  amount: 'max',
});

console.log('Allowances approved!');
```

---

## Common Issues

### "CLOB client not initialized"
- Ensure `POLYMARKET_PK` is set
- Check wallet has USDC balance
- Verify network connectivity

### "Order rejected"
- Market may be closed
- Insufficient balance
- Slippage too high
- Try FAK instead of FOK

### "Rate limit exceeded"
- Add delay between trades
- Implement rate limiter
- Contact Polymarket for higher limits

### "High slippage"
- Market may have low liquidity
- Reduce position size
- Consider skipping trade

---

## Monitoring

### Essential Logs

```typescript
console.log('[PolymarketExecutor] Order placed:', {
  orderID: result.orderID,
  executionTimeMs: 1234,
  slippageBps: 15,
  fees: 2.00,
  success: true,
});
```

### Metrics to Track

- Execution latency (target: <5s)
- Slippage (target: <1%)
- Success rate (target: >95%)
- Fees paid
- Balance remaining

### Alerts to Set

1. Low balance (<$100)
2. High slippage (>2%)
3. Execution failures (>3 consecutive)
4. API errors
5. Latency spikes (>10s)

---

## Next Steps

1. Read full guide: `docs/POLYMARKET_INTEGRATION_GUIDE.md`
2. Review current executor: `lib/trading/polymarket-executor.ts`
3. Test in mock mode
4. Set up wallet and fund with USDC
5. Run approval script
6. Test with $1 trades
7. Gradually increase position sizes
8. Monitor and optimize

---

## Resources

- [Polymarket CLOB Client](https://github.com/Polymarket/clob-client)
- [Examples](https://github.com/Polymarket/clob-client/tree/main/examples)
- [Polymarket API Docs](https://docs.polymarket.com/)
- [Full Integration Guide](./POLYMARKET_INTEGRATION_GUIDE.md)

---

## Safety Reminder

**Always start with MOCK mode and small positions!**

```env
MOCK_TRADING=true  # Safe, no real money
MOCK_TRADING=false # Real trading, use caution
```

Real trading involves:
- Actual USDC being spent
- Irreversible transactions
- Market risk
- Smart contract risk
- Operational risk

Test thoroughly before enabling real trading.
