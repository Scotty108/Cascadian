# CASCADIAN Documentation

**Last Updated**: 2025-11-10
**Product**: Polymarket Prediction Market Intelligence Platform
**Version**: 2.0 (85% Complete - Final Polish Phase)

---

## 🚀 Quick Start

### Essential Documents (Start Here)

1. **[PRODUCT_SPEC.md](./PRODUCT_SPEC.md)** - Complete product specification ⭐
   - Product overview and vision
   - 9 major features with detailed capabilities
   - Technical architecture overview
   - Success metrics and roadmap
   - **Start here** to understand "what is Cascadian"

2. **[ROADMAP.md](./ROADMAP.md)** - Development roadmap ⭐
   - ✅ Phase 1 complete (foundation)
   - 🔄 Current status (85% complete)
   - Feature checklist
   - Next priorities

3. **[architecture/SYSTEM_ARCHITECTURE.md](./architecture/SYSTEM_ARCHITECTURE.md)** - System architecture ⭐
   - 3-tier architecture diagrams
   - Data flow documentation
   - Database design (ER diagrams, indexes)
   - API catalog (28+ endpoints)
   - Security architecture

---

## 📁 Documentation Structure

\`\`\`
docs/
├── README.md                    # This file (entry point)
├── PRODUCT_SPEC.md             # ⭐ Complete product overview
├── ROADMAP.md                  # ⭐ Development roadmap
│
├── architecture/               # System architecture
│   └── SYSTEM_ARCHITECTURE.md # ⭐ Complete technical architecture
│
├── systems/                    # Technical subsystems (35 files)
│   ├── database/              # Database schemas, queries, optimization (19 files)
│   ├── pnl/                   # P&L calculation guides (5 files)
│   ├── polymarket/            # Polymarket API integration (8 files)
│   ├── data-pipeline/         # Data pipeline & backfill (3 files)
│   ├── resolution/            # Market resolution tracking
│   ├── authentication/        # Auth system
│   ├── bulk-sync/            # Bulk sync operations
│   └── goldsky/              # Goldsky integration
│
├── operations/                 # Runbooks & procedures (31 files)
│   ├── runbooks/             # Step-by-step operational guides
│   ├── troubleshooting/      # Debug guides
│   ├── deployment/           # Deployment procedures
│   └── maintenance/          # Maintenance tasks
│
├── reference/                  # Quick reference materials (10 files)
│
├── features/                   # Feature documentation
│   ├── copy-trading/
│   ├── smart-money-signals/
│   ├── strategy-builder/
│   └── wallet-analytics/
│
└── archive/                    # Historical documentation (450+ files)
    ├── agent-os-oct-2025/     # Original Agent OS structure (preserved)
    └── investigations/         # Historical investigations by topic
\`\`\`

---

## 🎯 Navigation Guide

### For AI Agents (Codex & Claude)
**Read in this order**:
1. \`/RULES.md\` - Workflow authority
2. \`/CLAUDE.md\` - Project context
3. \`docs/PRODUCT_SPEC.md\` - Complete product understanding
4. \`docs/ROADMAP.md\` - Current status and priorities

### For Developers
1. Read \`docs/PRODUCT_SPEC.md\` - Understand what Cascadian is
2. Read \`docs/architecture/SYSTEM_ARCHITECTURE.md\` - Understand how it works
3. Read \`docs/ROADMAP.md\` - Understand where we're going
4. Check \`/CLAUDE.md\` for quick navigation

---

## 📊 Current Project State

### ✅ Phase 1: COMPLETE
- Infrastructure (Next.js, ClickHouse, Supabase)
- Core features (market discovery, smart money, portfolio analytics)
- Polymarket integration (Gamma, CLOB, Data APIs)

### 🔄 Current Focus (85% Complete)
- Data quality validation
- P&L calculation verification
- UI/UX polish
- Performance optimization

See \`docs/ROADMAP.md\` for detailed status.

---

## 🔍 Finding Information

### By Topic
- **Database**: \`docs/systems/database/\`
- **P&L**: \`docs/systems/pnl/\`
- **APIs**: \`docs/systems/polymarket/\`
- **Operations**: \`docs/operations/\`

### By Task
- **Quick start**: \`docs/reference/\` + \`/CLAUDE.md\`
- **Deep dive**: \`docs/PRODUCT_SPEC.md\` + \`docs/architecture/SYSTEM_ARCHITECTURE.md\`
- **Debugging**: \`docs/operations/troubleshooting/\`

---

## 🎯 Quick Links

### Most Important
- [Product Specification](./PRODUCT_SPEC.md)
- [System Architecture](./architecture/SYSTEM_ARCHITECTURE.md)
- [Development Roadmap](./ROADMAP.md)
- [RULES.md](../RULES.md) - For AI agents
- [CLAUDE.md](../CLAUDE.md) - Project context

### Common Tasks
- [Database Schema](./systems/database/)
- [P&L System](./systems/pnl/)
- [Polymarket Integration](./systems/polymarket/)
- [Troubleshooting](./operations/troubleshooting/)

---

**Status**: Active Development (85% complete)
**Last Updated**: 2025-11-10
