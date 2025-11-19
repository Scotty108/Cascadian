# CASCADIAN - Agent OS Documentation

**Last Updated**: 2025-10-23
**Product**: Polymarket Prediction Market Intelligence Platform
**Version**: 2.0 (Production Ready - Phase 1)

---

## Overview

CASCADIAN is an advanced **Polymarket prediction market intelligence platform** with AI-powered workflow automation, whale tracking, and comprehensive market analytics.

This directory contains **Agent OS product documentation** for structured product management, development workflows, and feature specifications.

---

## 📁 Directory Structure

```
.agent-os/
├── README.md                    # This file
├── product/                     # Core product documentation
│   ├── spec.md                 # ⭐ Unified product specification (v2.0)
│   ├── ARCHITECTURE.md         # ⭐ System architecture (v2.0)
│   ├── ROADMAP_CHECKLIST.md    # ⭐ Development roadmap (NEW)
│   ├── CRITICAL_TECHNICAL_DECISIONS.md
│   ├── IMPLEMENTATION_OPERATIONS_MANUAL.md
│   ├── roadmap.md              # Original roadmap (reference)
│   ├── tech-stack.md           # Technology stack
│   ├── component-mapping.md    # UI component inventory
│   └── template-audit.md       # Template UI reference
├── polymarket-integration/      # Polymarket API integration
│   ├── active/                 # Current implementation docs
│   └── finished/               # Completed integration work
├── ai-copilot/                  # AI workflow builder
│   ├── active/                 # Current AI features
│   └── finished/               # Completed AI features
├── features/                    # Feature specifications
├── general/                     # Cross-cutting concerns
│   ├── active/                 # Theme system, deployment guides
│   └── finished/               # Completed work
└── _archive/                    # ⚠️ Outdated documentation (historical)
```

---

## 🚀 Quick Start

### Essential Documents (Start Here)

1. **[spec.md](./product/spec.md)** - Complete product specification
   - Product overview and vision
   - 9 major features with detailed capabilities
   - Technical architecture
   - Success metrics and roadmap

2. **[ARCHITECTURE.md](./product/ARCHITECTURE.md)** - System architecture
   - 3-tier architecture diagrams
   - Data flow documentation
   - Database design (ER diagrams, indexes)
   - API catalog (28+ endpoints)
   - Security architecture

3. **[ROADMAP_CHECKLIST.md](./product/ROADMAP_CHECKLIST.md)** - Development roadmap
   - ✅ Phase 1 complete (foundation)
   - 🔄 Phase 2 in progress (intelligence signals)
   - Checklist of features to build
   - Critical path for next 30 days

---

## 📊 Current Project State

### ✅ Phase 1: COMPLETE (Production Ready)

**Polymarket Integration**:
- ✅ Complete Gamma, CLOB, Data API integration
- ✅ Background sync system (5-minute intervals)
- ✅ 16+ API endpoints
- ✅ Supabase PostgreSQL with 10+ migrations

**Core Features**:
- ✅ Market discovery & screening (1000+ markets)
- ✅ Whale intelligence & tracking
- ✅ Portfolio analytics & wallet tracking
- ✅ Visual workflow builder (ReactFlow)
- ✅ AI copilot (conversational strategy builder)
- ✅ Theme system (dark/light + custom themes)

**Infrastructure**:
- ✅ Next.js 15.3.4 + React 19.1.0
- ✅ TailwindCSS + shadcn/ui (40+ components)
- ✅ TanStack Query for state management
- ✅ Supabase Auth + RLS policies

### 🔄 Phase 2: IN PROGRESS (Intelligence & Signals)

**Immediate Priorities**:
- [ ] ClickHouse database setup
- [ ] Trade aggregation pipeline
- [ ] Momentum scoring implementation
- [ ] Smart Imbalance Index (SII)
- [ ] WebSocket real-time updates

### 📋 Phase 3+: PLANNED

See [ROADMAP_CHECKLIST.md](./product/ROADMAP_CHECKLIST.md) for complete roadmap.

---

## 🔍 Key Features

### 1. Market Intelligence
- Browse 1000+ Polymarket markets
- Advanced filtering (category, volume, liquidity)
- OHLC price charts
- Order book visualization
- Related markets suggestions

### 2. Whale Tracking
- Identify large position holders (> $10K)
- Track smart money flows
- Detect position reversals
- Whale leaderboard (Sharpe ratio, ROI, win rate)

### 3. Portfolio Analytics
- Track positions and P&L
- Win rate and performance metrics
- Portfolio value over time
- Activity timeline

### 4. Visual Workflow Automation
- Drag-and-drop node-based builder
- 6+ node types (Stream, Filter, LLM Analysis, etc.)
- Real-time execution with streaming
- AI copilot for strategy building
- Save/load strategies to database

---

## 💻 Development Workflow

### Git Branch Strategy

```bash
# Main branch - Production releases
main

# Staging branch - Active development (if needed)
staging
```

**Current Branch**: `main` (all development on main for MVP)

### Using Agent OS

Reference these docs when working with Claude Code:

```bash
# Product planning
"According to spec.md, implement whale tracking feature"

# Architecture reference
"Following ARCHITECTURE.md, set up the database indexes"

# Roadmap tracking
"Check ROADMAP_CHECKLIST.md - what's next in Phase 2?"
```

---

## 📚 Documentation by Category

### Core Specifications
| Document | Purpose | Status |
|----------|---------|--------|
| `spec.md` | Unified product spec | ✅ v2.0 (Oct 23) |
| `ARCHITECTURE.md` | System architecture | ✅ v2.0 (Oct 23) |
| `ROADMAP_CHECKLIST.md` | Development roadmap | ✅ v1.0 (Oct 23) |
| `CRITICAL_TECHNICAL_DECISIONS.md` | Architecture decisions | ✅ Current |

### Integration Guides
| Document | Purpose | Location |
|----------|---------|----------|
| Polymarket Integration | API integration details | `polymarket-integration/active/` |
| AI Copilot | Workflow builder features | `ai-copilot/active/` |
| Theme System | Theme customization | `general/active/` |

### Database Documentation
| Document | Location |
|----------|----------|
| Schema documentation | `/supabase/docs/polymarket-schema.md` |
| Migration instructions | `/supabase/APPLY_MIGRATION.md` |
| Quick reference | `/supabase/docs/*-quick-reference.md` |

### UI Documentation
| Document | Location |
|----------|----------|
| UI Redesign Guide | `/docs/README-UI-REDESIGN.md` |
| Component Reference | `/docs/ui-components-reference.md` |
| Visual Comparison | `/docs/ui-redesign-visual-comparison.md` |

---

## 🏗️ Technical Stack

**Frontend**:
- Next.js 15.3.4 (App Router)
- React 19.1.0
- TypeScript 5.8.3
- TailwindCSS 3.4.17
- Radix UI + shadcn/ui
- TanStack Query (React Query)
- ReactFlow (workflow editor)

**Backend**:
- Supabase (PostgreSQL 15+)
- Vercel Serverless Functions
- Node.js 20.19.3
- pnpm 10.18.1

**External Services**:
- Polymarket APIs (Gamma, CLOB, Data)
- OpenAI GPT-4
- Anthropic Claude
- Google Gemini

**Future**:
- ClickHouse (analytics database)
- Redis (caching, rate limiting)
- WebSocket (real-time updates)

---

## 🎯 Next Steps (Critical Path)

Based on **ROADMAP_CHECKLIST.md**, the immediate priorities are:

### Week 1-2
1. ClickHouse database setup
2. Trade aggregation pipeline
3. Momentum scoring implementation

### Week 3-4
4. Smart Imbalance Index (SII)
5. WebSocket real-time updates
6. Wallet connection (MetaMask)

### Week 5-8
7. Order execution MVP
8. AI copilot improvements
9. Strategy marketplace MVP

---

## 📝 Updating Documentation

As the product evolves:

| Document | When to Update |
|----------|----------------|
| `spec.md` | Features completed or requirements change |
| `ARCHITECTURE.md` | Architecture decisions change |
| `ROADMAP_CHECKLIST.md` | Weekly progress updates |
| `tech-stack.md` | New dependencies added |

**Update Checklist**:
1. Mark features as complete in ROADMAP_CHECKLIST.md
2. Update success metrics in spec.md
3. Document new architecture patterns in ARCHITECTURE.md
4. Update version numbers and last updated dates

---

## 🗂️ Archive

Outdated documentation from early development (crypto trading template era) is stored in **`_archive/`**.

See [_archive/README.md](./_archive/README.md) for details on what was archived and why.

---

## 📖 Resources

### Global Agent OS Standards
Located in `~/.agent-os/standards/`:
- `tech-stack.md` - Global tech preferences
- `code-style.md` - Code style guidelines
- `best-practices.md` - Development best practices

### Agent OS Instructions
Located in `~/.agent-os/instructions/`:
- `plan-product.md` - Product planning workflow
- `create-spec.md` - Feature specification workflow
- `execute-tasks.md` - Task execution workflow
- `analyze-product.md` - Product analysis workflow

---

**Product**: CASCADIAN - Polymarket Prediction Market Intelligence Platform
**Status**: Production Ready (Phase 1), Phase 2 In Progress
**Agent OS**: Active Integration
