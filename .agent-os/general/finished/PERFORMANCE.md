# Performance Optimizations Guide

## 🚀 Optimizations Implemented

### 1. **Loading Skeletons**
Located in `/components/ui/skeletons/`

- **ChartSkeleton** - Animated loading state for charts
- **CardSkeleton** - Configurable skeleton for cards
- **TableSkeleton** - Loading state for data tables

Usage:
```tsx
import { ChartSkeleton } from '@/components/ui/skeletons'

<ChartSkeleton height="h-[400px]" />
```

### 2. **Lazy Loading**

#### Heavy Components
Located in `/components/lazy/lazy-chart.tsx`

- **LazyEChart** - Dynamically loaded ECharts component
- **LazyMarketDetail** - Code-split market detail page
- **LazyWalletDetail** - Code-split wallet detail page
- **LazyEventDetail** - Code-split event detail page

Usage:
```tsx
import { LazyEChart } from '@/components/lazy/lazy-chart'

<LazyEChart option={chartOption} />
```

#### Images
Use `LazyImage` component for optimized image loading:

```tsx
import { LazyImage } from '@/components/ui/lazy-image'

<LazyImage
  src="/avatar.png"
  alt="User avatar"
  className="w-12 h-12 rounded-full"
/>
```

### 3. **Code Splitting**

**Next.js Configuration** (`next.config.mjs`):
- Vendor chunks separated for better caching
- ECharts isolated in its own bundle (large library)
- Common components extracted for reuse
- Console logs removed in production

**Bundle Strategy:**
- `vendor.js` - All node_modules except ECharts
- `echarts.js` - ECharts library (heavy, cached separately)
- `common.js` - Shared components used across pages
- Per-page bundles - Route-specific code

### 4. **Intersection Observer**

Hook: `/hooks/use-intersection-observer.ts`

Lazy load components when they enter viewport:

```tsx
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'

const { ref, isIntersecting } = useIntersectionObserver({
  threshold: 0.1,
  freezeOnceVisible: true
})

return (
  <div ref={ref}>
    {isIntersecting && <HeavyComponent />}
  </div>
)
```

### 5. **Image Optimization**

**Configured in `next.config.mjs`:**
- AVIF and WebP formats
- Responsive image sizes
- Device-specific optimization

**Best Practices:**
```tsx
import Image from 'next/image'

<Image
  src="/chart.png"
  alt="Chart"
  width={800}
  height={400}
  loading="lazy"
  placeholder="blur"
/>
```

### 6. **Keyboard Shortcuts**

Hook: `/hooks/use-keyboard-shortcuts.ts`

Built-in navigation shortcuts:
- `Ctrl+H` - Dashboard
- `Ctrl+M` - Market Screener
- `Ctrl+E` - Events
- `Ctrl+S` - Intelligence Signals
- `Ctrl+W` - Whale Activity
- `Ctrl+/` - Focus search

Usage:
```tsx
import { useNavigationShortcuts } from '@/hooks/use-keyboard-shortcuts'

export function MyComponent() {
  useNavigationShortcuts()
  // Shortcuts now active
}
```

### 7. **Hover Animations**

Component: `/components/ui/animated-card.tsx`

Smooth micro-interactions on cards:

```tsx
import { AnimatedCard } from '@/components/ui/animated-card'

<AnimatedCard hoverScale={1.02} hoverGlow>
  <CardContent>...</CardContent>
</AnimatedCard>
```

### 8. **Empty States**

Component: `/components/ui/empty-state.tsx`

Professional empty states with icons:

```tsx
import { NoMarketsFound } from '@/components/ui/empty-state'

{markets.length === 0 && <NoMarketsFound />}
```

## 📊 Performance Metrics

### Bundle Sizes (Estimated)
- Main bundle: ~150KB (gzipped)
- Vendor chunk: ~200KB (gzipped, cached)
- ECharts chunk: ~280KB (gzipped, cached, lazy-loaded)
- Per-page chunks: ~20-50KB each

### Loading Times (Target)
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3.5s
- Largest Contentful Paint: < 2.5s

## 🎯 Best Practices

### 1. **Use Skeletons Instead of Spinners**
```tsx
// ❌ Bad
{loading && <Spinner />}

// ✅ Good
{loading ? <ChartSkeleton /> : <Chart />}
```

### 2. **Lazy Load Heavy Components**
```tsx
// ❌ Bad
import ReactECharts from 'echarts-for-react'

// ✅ Good
import { LazyEChart } from '@/components/lazy/lazy-chart'
```

### 3. **Use Intersection Observer for Below-Fold Content**
```tsx
const { ref, isIntersecting } = useIntersectionObserver()

<div ref={ref}>
  {isIntersecting && <ExpensiveComponent />}
</div>
```

### 4. **Memoize Expensive Calculations**
```tsx
import { useMemo } from 'react'

const expensiveValue = useMemo(() => {
  return calculateComplexMetrics(data)
}, [data])
```

### 5. **Debounce Search Inputs**
```tsx
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const [search, setSearch] = useState('')
const debouncedSearch = useDebouncedValue(search, 300)
```

## 🔧 Future Optimizations

- [ ] Service Worker for offline support
- [ ] Prefetching for predicted navigation
- [ ] Virtual scrolling for large tables
- [ ] React Server Components migration
- [ ] Edge runtime for API routes
- [ ] Incremental Static Regeneration

## 📈 Monitoring

Use these tools to track performance:
- Lighthouse CI
- Web Vitals
- Vercel Analytics
- Bundle Analyzer

Run bundle analysis:
```bash
ANALYZE=true pnpm build
```
