# CASCADIAN Tech Stack

## Context
Project-specific tech stack for CASCADIAN, overriding global Agent OS defaults where necessary.

## Current Stack

### Core Framework
- **App Framework**: Next.js 15.3.4 (App Router)
- **Language**: TypeScript 5.8.3
- **Runtime**: Node.js (detected from package.json)
- **Build Tool**: Next.js built-in
- **Package Manager**: npm/pnpm (to be standardized)

### Frontend
- **JavaScript Framework**: React 19.1.0
- **CSS Framework**: Tailwind CSS 3.4.17
- **UI Components**: Radix UI + shadcn/ui
- **Icons**: Lucide React 0.523.0
- **Font**: Inter (Google Fonts)
- **Theme**: next-themes 0.4.6 (dark/light mode)

### UI Component Library
**Radix UI Primitives**:
- Accordion, Alert Dialog, Aspect Ratio
- Avatar, Checkbox, Collapsible
- Context Menu, Dialog, Dropdown Menu
- Hover Card, Label, Menubar
- Navigation Menu, Popover, Progress
- Radio Group, Scroll Area, Select
- Separator, Slider, Slot
- Switch, Tabs, Toast
- Toggle, Toggle Group, Tooltip

**Additional UI**:
- `cmdk` 1.1.1 - Command palette
- `embla-carousel-react` 8.6.0 - Carousels
- `input-otp` 1.4.2 - OTP inputs
- `react-resizable-panels` 3.0.3 - Resizable layouts
- `sonner` 2.0.5 - Toast notifications
- `vaul` 1.1.2 - Drawer component

### Data & Charts
- **Charts**: Recharts 3.0.0
- **Date Handling**: date-fns 4.1.0
- **Date Picker**: react-day-picker 9.7.0
- **Visual Workflow**: @xyflow/react 12.9.0 (React Flow for Strategy Builder)

### Forms & Validation
- **Validation**: Zod 3.25.67
- **Form Library**: (To be added - React Hook Form recommended)

### Utilities
- **Class Merging**: clsx 2.1.1 + tailwind-merge 3.3.1
- **Class Variants**: class-variance-authority 0.7.1
- **Animations**: tailwindcss-animate 1.0.7

### Database & Backend
**Status**: Not Yet Implemented

**Planned**:
- **Database**: Supabase (PostgreSQL)
- **ORM**: Supabase client libraries
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage
- **Real-time**: Supabase Realtime subscriptions

### External APIs (Planned)
- **Exchange APIs**: Binance, Coinbase, Kraken
- **DeFi Protocols**: Uniswap, Aave, Compound
- **Price Feeds**: CoinGecko, CoinMarketCap
- **Blockchain RPC**: Alchemy, Infura

### Deployment
**Status**: Not Configured

**Target**:
- **Hosting**: Vercel
- **CI/CD**: GitHub Actions
- **Environments**:
  - Development (local)
  - Staging (staging branch)
  - Production (main branch)
- **CDN**: Vercel Edge Network

### Development Tools
- **Linting**: ESLint 9.31.0 + eslint-config-next 15.4.1
- **Type Checking**: TypeScript 5.8.3
- **Dead Code Detection**: ts-prune 0.10.3
- **PostCSS**: 8.5.6 (for Tailwind)

## Differences from Global Defaults

### Upgrades from Global Standards
- ✅ Next.js: 15.3.4 (global: 14.2.16)
- ✅ React: 19.1.0 (global: 18.x)
- ✅ TypeScript: 5.8.3 (global: 5.x)
- ✅ Node: Needs standardization to 20.19.3

### Missing from Global Standards
- ⚠️ **Database**: Supabase not yet configured
- ⚠️ **Authentication**: Not implemented
- ⚠️ **Font**: Using Inter instead of Geist
- ⚠️ **Package Manager**: Should standardize to pnpm 10.13.1
- ⚠️ **AI Integration**: No CopilotKit yet
- ⚠️ **Animations**: Has tailwindcss-animate, missing Framer Motion
- ⚠️ **Forms**: Missing React Hook Form

### Additional Libraries (Not in Global)
- ✨ Recharts for data visualization
- ✨ date-fns for date manipulation
- ✨ Multiple Radix UI primitives
- ✨ cmdk for command palette
- ✨ Embla Carousel
- ✨ Sonner for toasts
- ✨ Vaul for drawers
- ✨ React Flow (@xyflow/react) for visual strategy builder
- ✨ AI SDK (Vercel AI SDK) for AI integrations
- ✨ Geist font for modern typography

## Recommended Next Steps

### Immediate Actions
1. **Standardize Package Manager**: Migrate to pnpm 10.13.1
2. **Add Node Version**: Create `.nvmrc` with `20.19.3`
3. **Set Up Supabase**: Initialize database and auth
4. **Add React Hook Form**: For form management
5. **Environment Variables**: Create `.env.example`

### Optional Enhancements
1. **Switch to Geist Font**: For better performance
2. **Add Framer Motion**: For advanced animations
3. **Add CopilotKit**: For AI features
4. **Add Testing**: Jest + React Testing Library
5. **Add Storybook**: Component documentation

## Configuration Files

### Current State
- ✅ `tsconfig.json` - TypeScript config
- ✅ `tailwind.config.ts` - Tailwind config
- ✅ `next.config.mjs` - Next.js config
- ✅ `package.json` - Dependencies
- ⚠️ Missing `.nvmrc` - Node version
- ⚠️ Missing `.env.example` - Environment template
- ⚠️ Missing `supabase/config.toml` - Supabase config

### TypeScript Paths
Current alias: `@/*` maps to `./*`

This allows:
```typescript
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
```

## Dependencies to Add

### High Priority
```json
{
  "react-hook-form": "^7.x",
  "@supabase/supabase-js": "^2.x",
  "@supabase/auth-helpers-nextjs": "^0.x"
}
```

### Medium Priority
```json
{
  "@geist/font": "^1.x",
  "framer-motion": "^11.x",
  "@copilotkit/react-core": "^1.x",
  "@copilotkit/react-ui": "^1.x"
}
```

### Testing (Recommended)
```json
{
  "jest": "^29.x",
  "@testing-library/react": "^14.x",
  "@testing-library/jest-dom": "^6.x",
  "vitest": "^1.x"
}
```

## Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES2022+ features
- Mobile responsive (iOS Safari, Chrome Mobile)
