# Staged INSERT Statements - Wallets #7-20 Discovery

**Date:** November 16, 2025 (PST)
**Agent:** C1 (Database Agent)
**Source:** Wallet #7-20 batch discovery results

---

## Summary

**Validated Wallets:** 8 wallets (≥95% overlap)
**Combined Volume:** $542.3M
**Multi-Proxy Cluster:** All map to account `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

---

## Validated Mappings (Ready for INSERT)

### Wallet #8: `0x9d84ce0306f8551e02efef1680475fc0f1dc1344`
- **Overlap:** 97.61% (176,431 shared transactions)
- **Volume:** $86,879,953.18
- **Trades:** 190,666

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #9: `0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009`
- **Overlap:** 97.75% (86,816 shared transactions)
- **Volume:** $79,996,735.40
- **Trades:** 133,657

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #12: `0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1`
- **Overlap:** 96.53% (17,873 shared transactions)
- **Volume:** $66,913,038.81
- **Trades:** 22,369

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #13: `0x0540f430df85c770e0a4fb79d8499d71ebc298eb`
- **Overlap:** 95.63% (290,528 shared transactions)
- **Volume:** $64,525,780.41
- **Trades:** 599,345

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x0540f430df85c770e0a4fb79d8499d71ebc298eb',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #14: `0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b`
- **Overlap:** 99.94% (80,102 shared transactions)
- **Volume:** $63,844,668.98
- **Trades:** 97,393

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #15: `0x461f3e886dca22e561eee224d283e08b8fb47a07`
- **Overlap:** 100% (4,042 shared transactions)
- **Volume:** $61,806,018.27
- **Trades:** 6,818

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x461f3e886dca22e561eee224d283e08b8fb47a07',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #16: `0xb68a63d94676c8630eb3471d82d3d47b7533c568`
- **Overlap:** 100% (23,098 shared transactions)
- **Volume:** $60,981,486.42
- **Trades:** 44,021

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0xb68a63d94676c8630eb3471d82d3d47b7533c568',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #19: `0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1`
- **Overlap:** 96.09% (82,746 shared transactions)
- **Volume:** $58,204,333.42
- **Trades:** 94,436

```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

---

## Wallets Parked for Deeper Review

### Borderline Cases (84-94% overlap)

| Wallet # | Address | Overlap | Volume | Status |
|----------|---------|---------|--------|--------|
| #7 | `0x3151...0977` | 84.20% | $90.4M | Review after dedup |
| #10 | `0xfb1c...963e` | 93.74% | $79.1M | Review after dedup |
| #11 | `0xc658...3784` | 91.12% | $67.8M | Review after dedup |
| #17 | `0xcc50...4c82` | 87.11% | $60.1M | Review after dedup |
| #18 | `0x8b1d...74cc` | 93.97% | $58.8M | Review after dedup |

**Combined Volume:** $355.6M (borderline cases)

**Note:** Per user directive, these should be re-evaluated with stricter heuristics after dedup finishes to avoid dup noise.

### Not Discoverable

- **Wallet #20** (`0xccf20dc64040bf1dd0a4d40dee1bab95ad3b50e6`): No collision transactions found

---

## Execution Instructions

**CRITICAL:** Database write permissions required before execution.

**Once permissions granted:**
1. Execute all 8 INSERT statements above
2. Verify persistence with: `SELECT count() FROM wallet_identity_overrides FINAL`
3. Expected result: 12 total mappings (1 existing + 3 from #2,#5,#6 + 8 new)

---

## Multi-Proxy Cluster Update

**Account:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`

**Validated Executors (After INSERTs):**
- Wallet #1 (XCN): $5.8B ✅ Persisted
- Wallet #2: $308M ⚠️ Staged
- Wallet #5: $111M ⚠️ Staged
- Wallet #6: $104M ⚠️ Staged
- Wallet #8: $86.9M ⚠️ Staged (NEW)
- Wallet #9: $80M ⚠️ Staged (NEW)
- Wallet #12: $66.9M ⚠️ Staged (NEW)
- Wallet #13: $64.5M ⚠️ Staged (NEW)
- Wallet #14: $63.8M ⚠️ Staged (NEW)
- Wallet #15: $61.8M ⚠️ Staged (NEW)
- Wallet #16: $61M ⚠️ Staged (NEW)
- Wallet #19: $58.2M ⚠️ Staged (NEW)

**Combined Validated Volume:** $6.87B (66% of top 100 collision wallets)

---

**Status:** ✅ Ready for execution (permissions required)
**Agent:** C1 (Database Agent)
**Date:** November 16, 2025 (PST)
