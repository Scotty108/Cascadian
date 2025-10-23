# Archive - Outdated Documentation

**Created**: 2025-10-23
**Purpose**: Historical documentation from early development phases

---

## What's in this folder?

This folder contains **outdated or superseded documentation** from earlier phases of the CASCADIAN project when it was being built from a crypto trading template. These files are kept for reference but are **no longer accurate** for the current Polymarket prediction market platform.

---

## Archived Files

### Product Documentation (Outdated)
1. **IMPLEMENTATION_COMPLETE.md** - Phase 1 completion marker (Oct 21, 2025)
   - Historical marker for crypto template completion
   - Replaced by: ROADMAP_CHECKLIST.md

2. **dummy-data-generation-guide.md** - Mock data generation guide
   - No longer relevant - using real Polymarket data
   - Real data system documented in: ARCHITECTURE.md

3. **implementation-tasks-breakdown.md** - Old task tracking
   - Historical task list from early development
   - Replaced by: ROADMAP_CHECKLIST.md

4. **ui-implementation-gaps.md** - UI gap analysis
   - UI redesign is complete
   - Current UI documented in: /docs/README-UI-REDESIGN.md

5. **SPEC-wallet-market-detail-redesign.md** - Specific redesign spec
   - Redesign complete and integrated into main spec
   - Replaced by: spec.md (unified specification)

6. **ai-copilot-COMPLETED.md** - AI copilot completion marker
   - Feature complete marker
   - Moved from: .agent-os/features/

7. **COMPLETE_IMPLEMENTATION_GUIDE.md** - Implementation guide
   - Early implementation reference
   - Replaced by: ARCHITECTURE.md + spec.md

---

## Why were these archived?

**Platform Pivot**: CASCADIAN evolved from a general cryptocurrency trading bot template into a specialized **Polymarket prediction market intelligence platform**. These docs reference:
- Generic crypto trading features (DCA bots, arbitrage bots)
- Mock/dummy data systems (replaced with real Polymarket API)
- UI gaps that have been filled
- Completion markers for finished work

**Documentation Consolidation**: To maintain clarity, we created:
- **spec.md** - Single source of truth for product
- **ARCHITECTURE.md** - Complete system architecture
- **ROADMAP_CHECKLIST.md** - Current roadmap and progress

---

## Current Documentation

For up-to-date documentation, see:

**Core Specs** (`.agent-os/product/`):
- `spec.md` - Unified product specification (v2.0)
- `ARCHITECTURE.md` - System architecture documentation
- `ROADMAP_CHECKLIST.md` - Development roadmap and checklist
- `CRITICAL_TECHNICAL_DECISIONS.md` - Important architectural decisions
- `IMPLEMENTATION_OPERATIONS_MANUAL.md` - Polymarket integration reference

**UI Documentation** (`/docs/`):
- `README-UI-REDESIGN.md` - UI redesign guide
- `ui-redesign-executive-summary.md`
- `ui-redesign-wallet-market-detail.md`
- `ui-components-reference.md`

**Database** (`/supabase/`):
- `README.md` - Database setup guide
- `docs/polymarket-schema.md` - Schema documentation

---

## Should I delete these files?

**No** - Keep them archived for:
- Historical reference
- Understanding evolution of the product
- Recovering old ideas if needed
- Onboarding context for new developers

If you need to permanently delete them, wait until after a successful production launch to ensure nothing is needed.

---

**Last Updated**: 2025-10-23
