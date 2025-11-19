---
name: test-first
description: Test-First Development workflow for Cascadian. Use when implementing features, fixing bugs, or refactoring code. Write focused tests first, implement to pass, verify. Prevents regret and keeps feedback tight.
---

# Test-First Development

Write focused tests FIRST, then implement to make them pass. This prevents rework and proves features work before moving to next phase.

---

## When to Use This Skill

Use this skill when:
- ✅ Implementing new features
- ✅ Fixing bugs
- ✅ Refactoring code
- ✅ Adding API endpoints
- ✅ Database schema changes
- ✅ Adding UI components

**Examples of triggers**:
- "Implement new feature X"
- "Fix bug in Y"
- "Add API endpoint for Z"
- "Refactor component A"

---

## Test-First Workflow

### Phase Pattern (Small Chunks)

Break features into 3-4 phases:
1. **Database** → Write schema tests, implement tables/queries, verify
2. **API** → Write endpoint tests, implement routes, verify
3. **UI** → Write component tests, implement interface, verify
4. **Integration** → Write E2E tests, verify full flow

**Each phase is independently verifiable** ✅

---

## Test Writing Rules

### Rule 1: Write Tests FIRST
```
❌ WRONG ORDER:
1. Write implementation
2. Write tests
3. Hope they pass

✅ CORRECT ORDER:
1. Write failing tests (RED)
2. Write minimal implementation (GREEN)
3. Refactor if needed (REFACTOR)
4. Verify tests pass
```

### Rule 2: Keep Tests Focused (2-8 per phase)
```
Per Task Group: 2-8 focused tests only
Per Feature: 16-34 tests maximum
```

**NOT comprehensive, NOT edge cases, JUST core functionality**

### Rule 3: Run ONLY New Tests
```bash
# ✅ GOOD - Run just this test
npm test -- path/to/specific.test.ts

# ❌ BAD - Run full suite (wastes time)
npm test
```

### Rule 4: Skip Edge Cases
```
Focus on:
✅ Happy path
✅ Core functionality
✅ Critical validation

Skip:
❌ Edge cases
❌ Exhaustive scenarios
❌ "What if" tests
```

---

## Test Templates

### API Endpoint Test
```typescript
import { describe, it, expect } from '@jest/globals';

describe('GET /api/wallet/:address/trades', () => {
  it('should return trades for valid wallet', async () => {
    // Arrange
    const walletAddress = '0x1234...';

    // Act
    const response = await fetch(`/api/wallet/${walletAddress}/trades`);
    const data = await response.json();

    // Assert
    expect(response.status).toBe(200);
    expect(data.trades).toBeInstanceOf(Array);
    expect(data.trades.length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid wallet', async () => {
    // Arrange
    const invalidAddress = 'invalid';

    // Act
    const response = await fetch(`/api/wallet/${invalidAddress}/trades`);

    // Assert
    expect(response.status).toBe(400);
  });
});
```

### Database Query Test
```typescript
import { describe, it, expect } from '@jest/globals';
import { clickhouse } from '@/lib/clickhouse/client';

describe('Wallet Trades Query', () => {
  it('should fetch trades for wallet', async () => {
    // Arrange
    const walletAddress = '0x1234...';

    // Act
    const result = await clickhouse.query({
      query: `
        SELECT * FROM trades_raw
        WHERE wallet_address = {address:String}
        LIMIT 10
      `,
      query_params: { address: walletAddress },
      format: 'JSONEachRow'
    });
    const trades = await result.json();

    // Assert
    expect(trades).toBeInstanceOf(Array);
    expect(trades[0]).toHaveProperty('trade_id');
    expect(trades[0]).toHaveProperty('wallet_address');
  });
});
```

### Component Test
```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from '@jest/globals';
import WalletTrades from '@/components/WalletTrades';

describe('WalletTrades Component', () => {
  it('should render trades table', () => {
    // Arrange
    const trades = [
      { trade_id: '1', market_id: '0xabc', shares: 100, pnl: 50 }
    ];

    // Act
    render(<WalletTrades trades={trades} />);

    // Assert
    expect(screen.getByText(/Trade/i)).toBeInTheDocument();
    expect(screen.getByText(/100/)).toBeInTheDocument();
  });

  it('should show empty state when no trades', () => {
    // Arrange
    const trades = [];

    // Act
    render(<WalletTrades trades={trades} />);

    // Assert
    expect(screen.getByText(/No trades/i)).toBeInTheDocument();
  });
});
```

---

## Why This Works

### Prevents Regret/Rework
```
Without Tests:
Code → Deploy → Bug Found → Fix → Redeploy → Another Bug
(Lots of rework, context switching, frustration)

With Test-First:
Test → Code → Verify → Deploy
(One pass, proved it works, move on confidently)
```

### Keeps Feedback Loop Tight
```
Test-First: Write 5 min → Implement 10 min → Pass → Next
Direct Code: Write 30 min → Manual test → Fails → Debug 20 min → Retry
```

### Reduces Over-Engineering
```
Test-First: Only write code to pass focused tests
Direct Code: Write lots of "just in case" code, much unused
```

---

## Phase-by-Phase Example

### Feature: Add Wallet PnL Endpoint

#### Phase 1: Database (30 min)
**Tests** (10 min):
```typescript
describe('PnL Query', () => {
  it('should fetch PnL for wallet', async () => {
    // Test query returns data
  });

  it('should calculate realized PnL correctly', async () => {
    // Test PnL calculation
  });
});
```

**Implementation** (15 min):
```sql
-- Write query
SELECT
  wallet_address,
  sum(pnl) as realized_pnl
FROM trades_raw
WHERE wallet_address = {address}
  AND is_closed = true
GROUP BY wallet_address
```

**Verify** (5 min): Run tests, all pass ✅

---

#### Phase 2: API (30 min)
**Tests** (10 min):
```typescript
describe('GET /api/wallet/:address/pnl', () => {
  it('should return PnL for valid wallet', async () => {
    // Test endpoint returns 200 + data
  });

  it('should return 400 for invalid address', async () => {
    // Test validation
  });
});
```

**Implementation** (15 min):
```typescript
// Create API route in src/app/api/wallet/[address]/pnl/route.ts
export async function GET(request, { params }) {
  // Validate address
  // Query database
  // Return JSON
}
```

**Verify** (5 min): Run tests, all pass ✅

---

#### Phase 3: UI (45 min)
**Tests** (15 min):
```typescript
describe('WalletPnL Component', () => {
  it('should render PnL value', () => {
    // Test component displays data
  });

  it('should show loading state', () => {
    // Test loading UI
  });

  it('should show error state', () => {
    // Test error UI
  });
});
```

**Implementation** (25 min):
```typescript
// Create component
export function WalletPnL({ address }) {
  const { data, isLoading, error } = useQuery(...)
  // Render UI
}
```

**Verify** (5 min): Run tests, all pass ✅

---

#### Phase 4: Integration (30 min)
**Tests** (15 min):
```typescript
describe('Wallet PnL E2E', () => {
  it('should fetch and display PnL', async () => {
    // Test full flow: API → UI → Display
  });
});
```

**Implementation** (10 min):
```typescript
// Wire up components, routes, etc.
```

**Verify** (5 min): Run integration test, passes ✅

---

**Total**: ~2 hours, feature complete and proven to work

---

## Common Test Patterns

### Pattern 1: Arrange-Act-Assert (AAA)
```typescript
it('should do X', () => {
  // Arrange - Set up test data
  const input = 'test';

  // Act - Execute the code
  const result = myFunction(input);

  // Assert - Verify the result
  expect(result).toBe('expected');
});
```

### Pattern 2: Given-When-Then (BDD)
```typescript
it('should do X', () => {
  // Given - Initial state
  const user = { wallet: '0x...' };

  // When - Action occurs
  const trades = getUserTrades(user.wallet);

  // Then - Expected outcome
  expect(trades).toHaveLength(5);
});
```

### Pattern 3: Test Data Builders
```typescript
// Helper to create test data
function createMockTrade(overrides = {}) {
  return {
    trade_id: '1',
    wallet_address: '0xtest',
    shares: 100,
    pnl: 50,
    ...overrides
  };
}

it('should calculate total PnL', () => {
  const trades = [
    createMockTrade({ pnl: 100 }),
    createMockTrade({ pnl: -50 }),
  ];
  expect(calculateTotal(trades)).toBe(50);
});
```

---

## Test Organization

### File Structure
```
__tests__/
├── lib/
│   ├── clickhouse/
│   │   └── queries.test.ts        # Database tests
│   └── polymarket/
│       └── api.test.ts            # API client tests
├── components/
│   ├── WalletTrades.test.tsx     # Component tests
│   └── MarketCard.test.tsx
└── e2e/
    └── wallet-flow.test.ts        # E2E tests
```

### Test Naming
```typescript
// ✅ GOOD - Descriptive
describe('WalletPnL Component', () => {
  it('should render positive PnL in green', () => {});
  it('should render negative PnL in red', () => {});
});

// ❌ BAD - Vague
describe('Component', () => {
  it('works', () => {});
});
```

---

## Running Tests

### Run Specific Test File
```bash
npm test -- path/to/file.test.ts
```

### Run Tests Matching Pattern
```bash
npm test -- --testNamePattern="wallet"
```

### Run Tests in Watch Mode
```bash
npm test -- --watch
```

### Run with Coverage (occasionally)
```bash
npm test -- --coverage
```

---

## When NOT to Use Test-First

Don't use test-first when:
- ❌ Prototyping/exploring (unclear requirements)
- ❌ Quick UI tweaks (visual changes)
- ❌ Documentation updates
- ❌ Config file changes

**Use test-first for**: All features, bug fixes, refactoring, APIs, database work

---

## Anti-Patterns

### ❌ Writing Tests After Implementation
```
Problem: Tests just verify what you already wrote
Solution: Write tests first to define expected behavior
```

### ❌ Testing Implementation Details
```
❌ BAD:
expect(component.state.isLoading).toBe(true)

✅ GOOD:
expect(screen.getByText(/Loading/)).toBeInTheDocument()
```

### ❌ Over-Testing
```
❌ BAD: 100 tests covering every edge case
✅ GOOD: 8 focused tests covering core functionality
```

### ❌ Running Full Suite Every Time
```
❌ BAD: npm test (runs all 500 tests)
✅ GOOD: npm test -- wallet.test.ts (runs 8 relevant tests)
```

---

## Quick Reference

**Workflow**:
1. Write 2-8 focused tests (RED)
2. Implement minimal code (GREEN)
3. Refactor if needed (REFACTOR)
4. Run tests, verify pass
5. Move to next phase

**Test Count Guidelines**:
- Per phase: 2-8 tests
- Per feature: 16-34 tests max
- Focus on: Happy path, core functionality
- Skip: Edge cases, exhaustive scenarios

**Run Commands**:
```bash
npm test -- specific.test.ts  # Run one file
npm test -- --watch           # Watch mode
npm test -- --coverage        # Coverage (occasionally)
```

**Remember**:
- ✅ Tests first, implementation second
- ✅ Focused tests (2-8 per phase)
- ✅ Run only new tests
- ✅ Skip edge cases
- ✅ Prove it works, move on

---

## Related Resources

- **CLAUDE.md**: Test-Driven Development section
- **RULES.md**: Test-first approach required
- **package.json**: Test scripts configuration
- **jest.config.js**: Jest configuration

---

**Bottom Line**: Write 2-8 focused tests first, implement to pass them, verify, move on. Prevents rework, proves features work, keeps feedback tight.
