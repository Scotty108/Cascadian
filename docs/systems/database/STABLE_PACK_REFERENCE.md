# Database Stable Pack Reference

> **Token-Saving Technical Reference**
> This document contains frozen facts and stable patterns for database operations.

## Quick Reference

**One-Line Summary:** Normalize IDs, infer direction from net flows, compute PnL from payout vectors, rebuild atomically, and gate with neutrality thresholds. Arrays are 1-indexed.

---

## Stable Facts (Do Not Change)

- **ClickHouse arrays are 1-indexed.** Use `arrayElement(x, outcome_index + 1)` (add 1 to index)
- **condition_id is 32-byte hex.** Normalize as: lowercase, strip 0x, expect 64 chars. Store as String (avoid FixedString casts)
- **Atomic rebuilds only.** Pattern: `CREATE TABLE AS SELECT` then `RENAME`. Never `ALTER ... UPDATE` on large ranges
- **Direction from NET flows:**
  - BUY: usdc_net > 0 AND token_net > 0 (spent USDC, received tokens)
  - SELL: usdc_net < 0 AND token_net < 0 (received USDC, spent tokens)
  - Calculation: usdc_net = usdc_out - usdc_in, token_net = tokens_in - tokens_out
- **PnL source of truth:** payout vector + winner index
  - Formula: `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis`
- **ID hygiene:** Always join on normalized condition_id and consistent tx_hash casing

---

## Stable Skills (Use Short Labels in Chat)

| Skill | Label | When to Use | What to Do |
|-------|-------|------------|-----------|
| **ID Normalize** | **IDN** | Any time joining trades, transfers, or resolutions | `condition_id_norm = lower(replaceAll(condition_id, '0x','')); assert length=64; use String type` |
| **Net Direction** | **NDR** | Assigning BUY or SELL | BUY if usdc_net>0 and token_net>0; SELL if usdc_net<0 and token_net<0; else UNKNOWN; confidence HIGH if both legs present |
| **PnL from Vector** | **PNL** | Computing PnL from trade outcomes | `pnl_usd = shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis` |
| **Atomic Rebuild** | **AR** | Any mass correction or schema refactor | `CREATE TABLE AS SELECT`, then `RENAME` swap; never `ALTER UPDATE` large ranges |
| **ClickHouse Array Rule** | **CAR** | Indexing arrays in queries | Use 1-based indexing. Always +1 on outcome_index |
| **Join Discipline** | **JD** | Building canonical views | Join on normalized ids only; forbid slug-to-hex joins; assert rowcount changes |
| **Gate Defaults** | **GATE** | Quality checks and validation | Global cash neutrality error <2%; per-market <2% in 95% of markets, worst <5%; HIGH confidence coverage ≥95% of volume |
| **UltraThink** | **@ultrathink** | Schema design, complex SQL, performance risk | Use @ultrathink with brief goal, constraints, and rowcount expectations |

---

## File Anchors (Reference by Path, Don't Inline)

**Do not restate SQL blocks.** Reference these files instead:
- `scripts/step4-gate-then-swap.ts` - Atomic rebuild and gating
- `scripts/step5-rebuild-pnl.ts` - PnL recalculation
- `scripts/build-trades-canonical-v2.ts` - Canonical trade table
- `scripts/step3-compute-net-flows.ts` - Direction calculation
- `scripts/step2a-build-reliable-token-map.ts` - Token mapping

---

## Token-Saving Rules

1. **Use skill labels in replies** instead of re-explaining: Say "Apply **IDN** for condition IDs" not "Normalize condition IDs by..."
2. **Cache constants once:** Array indexing rule, alias packs, gate thresholds - mention once per conversation
3. **Reference files, not inline:** Link to `scripts/step3-compute-net-flows.ts` rather than paste SQL
4. **Prefer counts only:** When asked for data, provide rowcounts, not full dumps
5. **Short labels in code:** Use IDN, NDR, PNL, AR, JD, GATE, CAR, @ultrathink in comments and discussions

---

## Outcome Resolver Order (Stable)

1. Exact case-insensitive match within outcomes[]
2. Alias match filtered by event context (sport, election, yes/no)
3. Token set match after stopword removal
4. High threshold fuzzy match
5. If no winner found: refresh API and retry once
6. Else: route to manual queue (store resolver_method and full audit row)

---

## Minimal Alias Packs (Safe & Stable)

```
yes_no:     [["yes","y","long","buy"],  ["no","n","short","sell"]]
over_under: [["over",">","o"],          ["under","<","u"]]
up_down:    [["up","rise","increase"],  ["down","fall","decrease"]]
home_away:  [["home","h"],              ["away","a"]]
fav_dog:    [["favorite","fav","-"],    ["underdog","dog","+"]]
```

---

## Do Not Freeze Yet

- Team and city nickname dictionaries at scale
- Market category taxonomy details
- Any slug-to-hex mapping (only normalized hex is canonical)
