# UMA CTF Adapter - Integration Code Examples

**Purpose:** Ready-to-use code snippets for CASCADIAN integration
**Language:** TypeScript/JavaScript, Solidity, SQL
**Status:** Production-ready templates

---

## 1. Event Listener (Node.js + Ethers.js)

### Set Up Event Listener for QuestionInitialized

```typescript
import { ethers } from 'ethers';

const UMA_ADAPTER_ADDRESS = '0x...'; // Get from Polymarket docs
const UMA_ADAPTER_ABI = [
  // Only the events we need
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'questionID', type: 'bytes32' },
      { indexed: false, name: 'ancillaryData', type: 'bytes' },
      { indexed: false, name: 'reward', type: 'uint256' }
    ],
    name: 'QuestionInitialized',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'questionID', type: 'bytes32' },
      { indexed: false, name: 'price', type: 'int256' },
      { indexed: false, name: 'payouts', type: 'uint256[]' }
    ],
    name: 'QuestionResolved',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'questionID', type: 'bytes32' }
    ],
    name: 'QuestionReset',
    type: 'event'
  }
];

async function startEventListener() {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL // Polygon or Ethereum RPC
  );
  
  const adapter = new ethers.Contract(
    UMA_ADAPTER_ADDRESS,
    UMA_ADAPTER_ABI,
    provider
  );

  // Listen for QuestionInitialized
  adapter.on('QuestionInitialized', (questionID, ancillaryData, reward, event) => {
    console.log('Market Created:');
    console.log('  questionID:', questionID);
    console.log('  ancillaryData:', Buffer.from(ancillaryData).toString());
    console.log('  reward:', ethers.utils.formatUnits(reward, 6), 'USDC');
    console.log('  blockNumber:', event.blockNumber);
    
    // Store in database
    storeInitializedMarket({
      questionID,
      ancillaryData: Buffer.from(ancillaryData).toString(),
      reward,
      blockNumber: event.blockNumber
    });
  });

  // Listen for QuestionResolved
  adapter.on('QuestionResolved', (questionID, price, payouts, event) => {
    console.log('Market Resolved:');
    console.log('  questionID:', questionID);
    console.log('  price:', price.toString());
    console.log('  payouts:', payouts.map(p => p.toString()));
    console.log('  blockNumber:', event.blockNumber);
    
    // Update database and trigger PnL recalculation
    storeResolvedMarket({
      questionID,
      price,
      payouts,
      blockNumber: event.blockNumber,
      timestamp: new Date()
    });
    
    // Trigger PnL update for affected wallets
    recalculateWalletPnL(questionID, price, payouts);
  });

  // Listen for QuestionReset (disputes)
  adapter.on('QuestionReset', (questionID, event) => {
    console.log('Market Disputed and Reset:');
    console.log('  questionID:', questionID);
    console.log('  blockNumber:', event.blockNumber);
    
    // Mark market as disputed
    markMarketDisputed(questionID, event.blockNumber);
  });

  console.log('Event listeners started...');
}

startEventListener().catch(console.error);
```

---

## 2. Query Resolution Status (Smart Contract Interaction)

### Check If Market is Ready to Resolve

```typescript
import { ethers } from 'ethers';

async function checkResolutionStatus(questionID: string) {
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_URL
  );
  
  const adapter = new ethers.Contract(
    UMA_ADAPTER_ADDRESS,
    [
      {
        inputs: [{ name: 'questionID', type: 'bytes32' }],
        name: 'ready',
        outputs: [{ name: '', type: 'bool' }],
        stateMutability: 'view',
        type: 'function'
      },
      {
        inputs: [{ name: 'questionID', type: 'bytes32' }],
        name: 'getExpectedPayouts',
        outputs: [{ name: '', type: 'uint256[]' }],
        stateMutability: 'view',
        type: 'function'
      }
    ],
    provider
  );

  try {
    // Check if market ready to resolve
    const isReady = await adapter.ready(questionID);
    console.log(`Market ${questionID} ready to resolve:`, isReady);

    if (isReady) {
      // Get expected payouts
      const payouts = await adapter.getExpectedPayouts(questionID);
      console.log('Expected payouts:', payouts.map(p => p.toString()));
      
      return {
        ready: true,
        payouts: payouts.map(p => p.toNumber())
      };
    }

    return { ready: false, payouts: null };
  } catch (error) {
    console.error('Error checking resolution status:', error);
    throw error;
  }
}

// Usage
const result = await checkResolutionStatus('0x...');
```

---

## 3. Derive IDs (ID Calculation)

### Compute questionID and conditionID from Ancillary Data

```typescript
import { keccak256, defaultAbiCoder } from 'ethers/lib/utils';
import { getAddress } from 'ethers/lib/utils';

function deriveQuestionID(
  ancillaryData: string,
  creatorAddress: string
): string {
  // Append ",initializer:" + address to ancillary data
  const fullData = ancillaryData + `,initializer:${creatorAddress.toLowerCase().slice(2)}`;
  
  // Compute keccak256 hash
  const questionID = keccak256(Buffer.from(fullData, 'utf-8'));
  
  return questionID;
}

function deriveConditionID(
  oracleAddress: string,
  questionID: string,
  outcomeSlotCount: number = 2
): string {
  // Encode oracle, questionID, outcomeSlotCount
  const encoded = defaultAbiCoder.encode(
    ['address', 'bytes32', 'uint256'],
    [getAddress(oracleAddress), questionID, outcomeSlotCount]
  );
  
  // Take keccak256 of encoded data
  const conditionID = keccak256(encoded);
  
  return conditionID;
}

// Usage
const ancillaryData = 'Will Bitcoin exceed $50k by 2024-12-31?';
const creator = '0xAbCdEf...';
const oracleAddress = '0x123456...';

const questionID = deriveQuestionID(ancillaryData, creator);
const conditionID = deriveConditionID(oracleAddress, questionID);

console.log('questionID:', questionID);
console.log('conditionID:', conditionID);
```

---

## 4. Map Oracle Price to Payouts

### Convert Oracle Response to Payout Array

```typescript
interface PayoutResult {
  payouts: [number, number];
  outcome: 'YES' | 'NO' | 'TIE' | 'INVALID' | 'IGNORE';
  description: string;
}

function mapOraclePriceToPayouts(price: string | BigNumber): PayoutResult {
  // Convert to string for comparison
  const priceStr = typeof price === 'string' ? price : price.toString();
  
  const ZERO = '0';
  const HALF_ETHER = '500000000000000000'; // 0.5 ether in wei
  const ONE_ETHER = '1000000000000000000'; // 1 ether in wei
  const IGNORE_PRICE = '-9223372036854775808'; // type(int256).min
  
  switch (priceStr) {
    case ZERO:
      return {
        payouts: [0, 1],
        outcome: 'NO',
        description: 'NO outcome selected - position 1 wins'
      };
    
    case HALF_ETHER:
      return {
        payouts: [1, 1],
        outcome: 'TIE',
        description: '50/50 split or unknown'
      };
    
    case ONE_ETHER:
      return {
        payouts: [1, 0],
        outcome: 'YES',
        description: 'YES outcome selected - position 0 wins'
      };
    
    case IGNORE_PRICE:
      return {
        payouts: [0, 0],
        outcome: 'IGNORE',
        description: 'Ignore price - market will reset'
      };
    
    default:
      return {
        payouts: [0, 0],
        outcome: 'INVALID',
        description: `Invalid price: ${priceStr}`
      };
  }
}

// Usage
const oracleResponse = '1000000000000000000'; // 1 ether
const result = mapOraclePriceToPayouts(oracleResponse);
console.log(result);
// Output:
// {
//   payouts: [1, 0],
//   outcome: 'YES',
//   description: 'YES outcome selected - position 0 wins'
// }
```

---

## 5. Calculate Token Payouts

### Convert Payout Array to User Redemption Amount

```typescript
interface TokenRedemption {
  outcome: string;
  userTokens: number;
  payoutFraction: number;
  redemptionAmount: number;
  description: string;
}

function calculateTokenRedemption(
  userTokenAmount: number,
  payouts: [number, number],
  outcomePosition: 0 | 1 // 0 = YES, 1 = NO
): TokenRedemption {
  const numerator = payouts[outcomePosition];
  const denominator = payouts.length; // Always 2 for binary markets
  const payoutFraction = numerator / denominator;
  const redemptionAmount = userTokenAmount * payoutFraction;
  
  const outcomeName = outcomePosition === 0 ? 'YES' : 'NO';
  
  return {
    outcome: outcomeName,
    userTokens: userTokenAmount,
    payoutFraction,
    redemptionAmount,
    description: `${userTokenAmount} ${outcomeName} tokens redeemable for ${redemptionAmount} USDC`
  };
}

// Usage example 1: YES wins
const result1 = calculateTokenRedemption(100, [1, 0], 0);
console.log(result1);
// Output:
// {
//   outcome: 'YES',
//   userTokens: 100,
//   payoutFraction: 0.5,
//   redemptionAmount: 50,
//   description: '100 YES tokens redeemable for 50 USDC'
// }

// Usage example 2: NO wins
const result2 = calculateTokenRedemption(100, [0, 1], 1);
console.log(result2);
// Output:
// {
//   outcome: 'NO',
//   userTokens: 100,
//   payoutFraction: 0.5,
//   redemptionAmount: 50,
//   description: '100 NO tokens redeemable for 50 USDC'
// }

// Usage example 3: Tie
const result3a = calculateTokenRedemption(100, [1, 1], 0);
const result3b = calculateTokenRedemption(100, [1, 1], 1);
console.log('YES:', result3a.redemptionAmount); // 50 USDC
console.log('NO:', result3b.redemptionAmount);  // 50 USDC
```

---

## 6. Database Schema & Inserts

### ClickHouse Table Creation and Sample Data

```sql
-- Create market_resolutions table
CREATE TABLE IF NOT EXISTS market_resolutions (
    market_id String,
    condition_id FixedString(64),
    question_id FixedString(64),
    oracle_address FixedString(42),
    
    resolution_status Enum8(
        'pending' = 0,
        'resolved' = 1,
        'disputed' = 2,
        'dvm_escalated' = 3
    ),
    oracle_price Nullable(Decimal(28, 18)),
    payout_yes UInt8,
    payout_no UInt8,
    
    request_timestamp DateTime,
    resolved_timestamp Nullable(DateTime),
    dispute_count UInt8 DEFAULT 0,
    
    ancillary_data String,
    reward_amount Decimal(18, 6),
    
    INDEX idx_market_id (market_id) TYPE set(0) GRANULARITY 1,
    INDEX idx_condition_id (condition_id) TYPE set(0) GRANULARITY 1,
    INDEX idx_status (resolution_status) TYPE set(0) GRANULARITY 1,
    INDEX idx_resolved (resolved_timestamp) TYPE minmax GRANULARITY 1
) ENGINE = ReplacingMergeTree()
ORDER BY (market_id, request_timestamp)
PARTITION BY toYYYYMM(request_timestamp);

-- Insert resolved market example
INSERT INTO market_resolutions VALUES
(
    'MARKET_BTC_50K_DEC24',           -- market_id
    'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', -- condition_id
    'f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9', -- question_id
    '0x1234567890123456789012345678901234567890',                      -- oracle_address
    'resolved',                        -- resolution_status
    1000000000000000000,              -- oracle_price (1 ether in wei)
    1,                                -- payout_yes
    0,                                -- payout_no
    '2024-11-12 10:00:00',           -- request_timestamp
    '2024-11-12 12:05:00',           -- resolved_timestamp
    0,                                -- dispute_count
    'Will Bitcoin exceed $50k by 2024-12-31?,initializer:0xabcd...',  -- ancillaryData
    1000000                          -- reward_amount (1M USDC)
);

-- Query examples
SELECT * FROM market_resolutions 
WHERE resolution_status = 'resolved'
AND resolved_timestamp > now() - interval 7 day;

SELECT market_id, oracle_price, payout_yes, payout_no
FROM market_resolutions
WHERE market_id = 'MARKET_BTC_50K_DEC24';
```

---

## 7. PnL Recalculation Trigger (PostgreSQL Function)

### Update Wallet PnL After Market Resolution

```sql
-- Function to recalculate PnL for affected wallets
CREATE OR REPLACE FUNCTION recalculate_wallet_pnl_on_resolution(
  p_market_id TEXT,
  p_payout_yes SMALLINT,
  p_payout_no SMALLINT
) RETURNS void AS $$
BEGIN
  -- Update position values based on payouts
  UPDATE wallet_positions
  SET 
    realized_payout = CASE 
      WHEN outcome = 'YES' THEN token_amount * (p_payout_yes::FLOAT / 2)
      WHEN outcome = 'NO' THEN token_amount * (p_payout_no::FLOAT / 2)
      ELSE 0
    END,
    status = 'settled',
    updated_at = NOW()
  WHERE market_id = p_market_id
    AND status IN ('open', 'pending');
  
  -- Aggregate updated PnL to wallet totals
  UPDATE wallet_metrics wm
  SET 
    total_realized_pnl = total_realized_pnl + new_payout,
    pnl_updated_at = NOW()
  FROM (
    SELECT 
      wallet_address,
      SUM(realized_payout - collateral_amount) as new_payout
    FROM wallet_positions
    WHERE market_id = p_market_id
      AND status = 'settled'
    GROUP BY wallet_address
  ) t
  WHERE wm.wallet_address = t.wallet_address;
  
END;
$$ LANGUAGE plpgsql;

-- Usage from Node.js
async function onMarketResolved(
  marketId: string,
  payoutYes: number,
  payoutNo: number
) {
  await db.query(
    'SELECT recalculate_wallet_pnl_on_resolution($1, $2, $3)',
    [marketId, payoutYes, payoutNo]
  );
  
  console.log(`PnL recalculated for market ${marketId}`);
}
```

---

## 8. Validation Helper Functions

### Data Safety Checks

```typescript
function isValidPayoutArray(payouts: any[]): boolean {
  // Must be exactly 2 elements
  if (!Array.isArray(payouts) || payouts.length !== 2) {
    return false;
  }
  
  const [p0, p1] = payouts;
  
  // Each element must be 0 or 1
  if (![0, 1].includes(p0) || ![0, 1].includes(p1)) {
    return false;
  }
  
  // [0, 0] is invalid (locks funds)
  if (p0 === 0 && p1 === 0) {
    return false;
  }
  
  return true;
}

function isValidOraclePrice(price: string | BigNumber): boolean {
  const priceStr = typeof price === 'string' ? price : price.toString();
  
  const ZERO = '0';
  const HALF_ETHER = '500000000000000000';
  const ONE_ETHER = '1000000000000000000';
  const IGNORE_PRICE = '-9223372036854775808';
  
  return [ZERO, HALF_ETHER, ONE_ETHER, IGNORE_PRICE].includes(priceStr);
}

function validateQuestionID(questionID: string): boolean {
  // Must be 66 characters (0x + 64 hex chars)
  return /^0x[a-f0-9]{64}$/i.test(questionID);
}

function validateConditionID(conditionID: string): boolean {
  // Same as questionID - 66 characters
  return /^0x[a-f0-9]{64}$/i.test(conditionID);
}

// Usage
console.log(isValidPayoutArray([1, 0])); // true
console.log(isValidPayoutArray([0, 0])); // false
console.log(isValidOraclePrice('1000000000000000000')); // true
console.log(isValidQuestionID('0xabcd1234...')); // true/false
```

---

## 9. Error Handling

### Comprehensive Error Scenarios

```typescript
async function resolveMarketSafely(questionID: string) {
  try {
    // Step 1: Validate input
    if (!validateQuestionID(questionID)) {
      throw new Error(`Invalid questionID format: ${questionID}`);
    }

    // Step 2: Check status
    const status = await checkResolutionStatus(questionID);
    if (!status.ready) {
      throw new Error('Market not ready to resolve - oracle still in liveness period');
    }

    // Step 3: Validate payouts
    if (!isValidPayoutArray(status.payouts)) {
      throw new Error(`Invalid payout array: ${status.payouts}`);
    }

    // Step 4: Call resolve
    const tx = await adapter.resolve(questionID);
    const receipt = await tx.wait();

    // Step 5: Verify event
    const resolved = receipt.events?.find(e => e.event === 'QuestionResolved');
    if (!resolved) {
      throw new Error('QuestionResolved event not found in transaction');
    }

    console.log('Market resolved successfully:', resolved.args);
    return resolved.args;

  } catch (error) {
    console.error('Resolution failed:');
    
    if (error.code === 'CALL_EXCEPTION') {
      console.error('Smart contract error:', error.reason);
      // Likely market already resolved or not ready
    } else if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error('Not enough funds for gas');
    } else {
      console.error('Unknown error:', error.message);
    }
    
    throw error;
  }
}
```

---

## 10. Complete Integration Workflow

### Full End-to-End Flow

```typescript
async function completeResolutionWorkflow(
  marketId: string,
  ancillaryData: string,
  creatorAddress: string
) {
  console.log(`Starting resolution workflow for ${marketId}...`);
  
  // Step 1: Derive IDs
  const questionID = deriveQuestionID(ancillaryData, creatorAddress);
  const conditionID = deriveConditionID(UMA_ADAPTER_ADDRESS, questionID);
  console.log(`Derived IDs: ${questionID} / ${conditionID}`);
  
  // Step 2: Check readiness
  const status = await checkResolutionStatus(questionID);
  if (!status.ready) {
    console.log('Not ready yet. Waiting...');
    return null;
  }
  
  // Step 3: Validate payouts
  if (!isValidPayoutArray(status.payouts)) {
    console.error('Invalid payout array received!');
    return null;
  }
  
  const { payouts, outcome } = mapOraclePriceToPayouts(status.payouts);
  console.log(`Market resolved: ${outcome} with payouts ${payouts}`);
  
  // Step 4: Store in database
  await db.query(
    `INSERT INTO market_resolutions 
     (market_id, condition_id, question_id, oracle_address, 
      resolution_status, payout_yes, payout_no, resolved_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      marketId,
      conditionID.slice(2).toLowerCase(),
      questionID.slice(2).toLowerCase(),
      UMA_ADAPTER_ADDRESS,
      'resolved',
      payouts[0],
      payouts[1],
      new Date()
    ]
  );
  
  // Step 5: Trigger PnL recalculation
  await recalculateWalletPnLOnResolution(marketId, payouts[0], payouts[1]);
  
  console.log(`Workflow complete for ${marketId}`);
  return { questionID, conditionID, payouts, outcome };
}
```

---

**Ready to implement? Check the [UMA_CTF_ADAPTER_RESEARCH.md](./UMA_CTF_ADAPTER_RESEARCH.md) for detailed technical specs.**

