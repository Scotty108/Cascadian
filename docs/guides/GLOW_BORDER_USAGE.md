# Glow Border Effect - Usage Guide

Apple Intelligence-inspired animated gradient borders with matching glow effects.

## Overview

The glow border effect creates an animated gradient that rotates around an element with a matching glow/blur. This draws attention to important UI elements and creates a premium, modern feel inspired by Apple Intelligence.

## When to Use

Use the glow border effect sparingly on **truly important** elements to maintain impact:

### ✅ Recommended Use Cases

1. **High-Conviction Signals** ⭐
   - TSI signals with conviction > 80%
   - Entry signal indicators
   - Market signals with high confidence
   - Example: Already implemented in `TSISignalCard`

2. **Premium Features** 💎
   - Pro/Premium upgrade CTAs
   - Omega S-grade badges (>3.0 ratio)
   - Elite wallet indicators
   - Smart Money consensus cards

3. **Live/Real-Time Data** 📡
   - Live market data feeds
   - Real-time whale activity
   - Active trading signals
   - Live price updates

4. **Critical Actions** 🎯
   - Primary CTAs (Connect Wallet, Place Trade)
   - Important confirmations
   - High-value actions
   - Critical warnings (when intensity=strong)

5. **Outstanding Performance** 🏆
   - Top 1% traders
   - Record-breaking metrics
   - Exceptional win rates
   - Market-beating returns

### ❌ Avoid Using For

- Standard cards or content
- Navigation elements
- Regular buttons
- Common metrics
- Multiple elements on the same screen (max 2-3)

## Implementation

### React Component

```tsx
import { GlowBorder } from "@/components/ui/glow-border";

<GlowBorder
  color="purple"      // default | purple | blue | emerald
  intensity="strong"  // subtle | medium | strong
  speed="medium"      // slow | medium | fast
  thick={false}       // boolean
>
  <Card>Your content</Card>
</GlowBorder>
```

### CSS Classes (Direct)

```tsx
<div className="glow-border glow-border-purple glow-border-strong">
  Your content
</div>
```

## Color Guide

| Color | Use For | Example |
|-------|---------|---------|
| **Default (Cyan)** | Primary actions, main features | Connect Wallet, Primary signals |
| **Purple** | Premium/AI features, high conviction | Pro features, TSI signals, Elite traders |
| **Blue** | Information, data-driven content | Market data, Analytics |
| **Emerald** | Positive metrics, success states | Profitable trades, Winning streaks |

## Intensity Guide

| Intensity | Blur | Use For |
|-----------|------|---------|
| **Subtle** | 8px | Background elements, secondary importance |
| **Medium** | 16px | Standard important elements |
| **Strong** | 24px | Critical actions, urgent signals |

## Speed Guide

| Speed | Duration | Use For |
|-------|----------|---------|
| **Slow** | 12s | Calm, informational content |
| **Medium** | 8s | Standard animated elements |
| **Fast** | 4s | Live data, urgent signals |

## Examples by Component

### TSI Signal Card ✅ Already Implemented
```tsx
// Automatically glows when conviction > 80% or meets entry threshold
<TSISignalCard marketId={id} showLiveIndicator />
```

### Omega S-Grade Badge
```tsx
{omegaScore?.grade === 'S' && (
  <GlowBorder color="purple" intensity="strong">
    <Badge>S Grade - Ω {omegaScore.omega_ratio.toFixed(2)}</Badge>
  </GlowBorder>
)}
```

### Premium Upgrade CTA
```tsx
<GlowBorder color="purple" speed="slow">
  <Button size="lg" className="bg-purple-600">
    Upgrade to Pro - Unlock Smart Money Signals
  </Button>
</GlowBorder>
```

### Live Market Signal
```tsx
<GlowBorder color="emerald" intensity="strong" speed="fast">
  <Card>
    <Badge className="animate-pulse">LIVE</Badge>
    <h3>Market Moving - 94% Conviction</h3>
    <p>Smart Money flowing to YES</p>
  </Card>
</GlowBorder>
```

### Top Performer Highlight
```tsx
{walletRank === 1 && (
  <GlowBorder color="emerald" intensity="medium">
    <Card>
      <Badge>🏆 #1 Trader</Badge>
      <WalletMetrics {...wallet} />
    </Card>
  </GlowBorder>
)}
```

## Browser Support

- **Chrome/Edge 85+**: Full support with animated gradient
- **Safari 16.4+**: Full support (in progress)
- **Firefox**: Graceful fallback to static gradient
- **Older browsers**: Static gradient border (still looks good!)

The effect uses Progressive Enhancement - newer browsers get the animated glow, older browsers get a static gradient border.

## Performance Considerations

- Uses GPU-accelerated CSS animations (transform/filter)
- Pseudo-elements prevent re-renders
- No JavaScript runtime cost
- Smooth 60fps animations on modern hardware

## Best Practices

1. **Limit Usage**: Max 2-3 glowing elements per screen
2. **Context Matters**: Use stronger intensity for more important elements
3. **Color Consistency**: Match colors to your design system
4. **Animation Speed**: Slower for calm/info, faster for urgent/live
5. **Accessibility**: Ensure sufficient contrast for readability
6. **Testing**: Test on both light and dark modes

## Demo Page

Visit `/demo/glow-border` to see all variants and examples in action.

## Technical Details

Uses CSS Houdini `@property` to register a custom property for the gradient angle, enabling smooth animation of the conic-gradient. Falls back gracefully in unsupported browsers.

See `app/globals.css` for the CSS implementation.
