# CASCADIAN - Agent OS Integration

## Overview
This directory contains Agent OS product documentation for CASCADIAN, an AI-powered cryptocurrency trading platform.

Agent OS has been integrated to provide structured product management, development workflows, and AI-assisted feature development.

## Directory Structure

```
.agent-os/
├── README.md              # This file
└── product/
    ├── spec.md           # Complete product specification
    ├── tech-stack.md     # Technology stack documentation
    ├── roadmap.md        # Development roadmap
    └── architecture.md   # System architecture
```

## Quick Reference

### Product Documents

#### 1. spec.md
- Product overview and vision
- Target audience
- Feature breakdown (19+ major features)
- Current MVP state
- Success metrics
- Development priorities

#### 2. tech-stack.md
- Current tech stack (Next.js 15, React 19, TypeScript 5.8)
- UI libraries (Radix UI + shadcn/ui)
- Planned integrations (Supabase, exchange APIs)
- Differences from global defaults
- Recommended next steps

#### 3. roadmap.md
- 8-phase development plan
- Detailed task breakdowns
- Timeline estimates
- Success criteria per phase
- Risk mitigation strategies
- Release strategy (Alpha → Beta → V1.0)

#### 4. architecture.md
- System architecture diagrams
- Frontend structure
- Backend design (planned)
- Database schema
- API routes
- Security architecture
- Performance optimizations
- Deployment architecture

## Current Project State

### Completed ✅
- UI/UX foundation with shadcn/ui
- All major page routes and layouts
- Dashboard navigation with 20+ features
- Theme system (dark/light)
- Responsive design
- TypeScript setup
- Component library (40+ shadcn/ui components)
- **Strategy Builder**: Visual workflow designer with React Flow
  - Strategy Library with default template
  - Node-based workflow editor (12+ node types)
  - Import/Export strategies (JSON)
  - Code export functionality
  - Real-time execution panel
  - Start/Stop/Stats controls per strategy
- Git workflow with staging and main branches
- Comprehensive .gitignore
- Environment variable templates

### In Progress 🔄
- Authentication integration
- Backend setup (Supabase)
- Real trading bot logic
- Strategy execution engine

### Planned 📋
- Exchange API integration
- DeFi protocol connections
- Strategy marketplace transactions
- Backend for strategy persistence
- Mobile app

## Development Workflow

### Git Branch Strategy

**CASCADIAN uses a two-branch workflow:**

```bash
# Staging branch - All development work
git checkout staging
# Make changes, commit, and push
git push origin staging

# Main branch - Production releases only
# When staging is stable and tested:
git checkout main
git merge staging
git push origin main

# Return to staging for continued development
git checkout staging
```

**Branch Purposes:**
- `staging` - Active development, feature testing, integration
- `main` - Production-ready code, stable releases only

### Using Agent OS Commands

The following commands work with CASCADIAN:

```bash
# Analyze product and update documentation
/analyze-product

# Plan a new feature
/create-spec

# Execute tasks from roadmap
/execute-task

# Get help with implementation
Ask Claude Code to reference these docs
```

### Working with Specifications

When requesting new features:
1. Reference the **roadmap.md** for planned features
2. Check **architecture.md** for implementation patterns
3. Review **tech-stack.md** for technology choices
4. Update **spec.md** when features are completed

### Example Prompts

```
"Let's implement Phase 1.2 from the roadmap - Authentication"

"Following the architecture.md, help me set up the bot execution system"

"According to spec.md, we need a DCA bot. Let's build it using the tech stack in tech-stack.md"
```

## Key Product Insights

### Core Features (from spec.md)
1. **Trading Automation** - AI, DCA, Arbitrage, Signal bots
2. **Portfolio Management** - Analytics, tracking, tax reporting
3. **Wallet Management** - Multi-wallet, multi-chain support
4. **DeFi Integration** - Protocol aggregation
5. **Marketplace** - Strategy trading platform

### Technical Architecture (from architecture.md)
- **Frontend**: Next.js App Router with Server/Client Components
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Integrations**: Exchange APIs, DeFi protocols, price feeds
- **Deployment**: Vercel (frontend) + Supabase (backend)

### Development Phases (from roadmap.md)
1. **Phase 1**: Foundation (Auth + Database) - 2-3 weeks
2. **Phase 2**: Trading Core (DCA bot + Exchange APIs) - 3-4 weeks
3. **Phase 3**: Advanced Trading (All bots) - 4-5 weeks
4. **Phase 4**: DeFi Integration - 3-4 weeks
5. **Phase 5**: Marketplace - 3-4 weeks
6. **Phase 6**: Analytics - 2-3 weeks
7. **Phase 7**: Security - 2-3 weeks
8. **Phase 8**: Scale & Polish - Ongoing

## Next Steps

Based on the roadmap, the immediate priorities are:

### 1. Backend Setup (Phase 1.1)
- Initialize Supabase project
- Design database schema
- Set up environment variables

### 2. Authentication (Phase 1.2)
- Implement Supabase Auth
- Connect sign-in/sign-up pages
- Add Google OAuth

### 3. Development Tooling (Phase 1.3)
- Standardize to pnpm
- Add .nvmrc and .env.example
- Configure linting and formatting

### 4. Data Integration (Phase 1.4)
- Replace mock data with real Supabase queries
- Add loading states
- Implement error handling

## Updating This Documentation

As the product evolves:

1. **spec.md**: Update when features are completed or requirements change
2. **tech-stack.md**: Update when adding new dependencies or changing stack
3. **roadmap.md**: Mark phases as completed, adjust timelines
4. **architecture.md**: Update when architecture decisions change

## Resources

### Global Agent OS Standards
Located in `~/.agent-os/standards/`:
- `tech-stack.md` - Global tech preferences
- `code-style.md` - Code style guidelines
- `best-practices.md` - Development best practices

### Instructions
Located in `~/.agent-os/instructions/`:
- `plan-product.md` - Product planning workflow
- `create-spec.md` - Feature specification workflow
- `execute-tasks.md` - Task execution workflow

---

**Last Updated**: October 20, 2025
**Product Version**: Pre-Alpha
**Agent OS Integration**: Active
