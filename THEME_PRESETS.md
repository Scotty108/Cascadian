# Theme Preset System Documentation

## Overview

The Theme Preset System provides curated, professionally-designed color schemes and design configurations for the Cascadian app. Users can instantly apply complete themes optimized for different trading styles, moods, and use cases—or use them as starting points for custom themes.

## Available Presets

### 🔷 Cascadian Default
**Best for:** Professional trading, analytics, all-purpose use

**Description:** Professional blue theme optimized for crypto trading with high contrast and modern aesthetics.

**Mood:** Professional, Trustworthy, Modern

**Colors:**
- Primary: `hsl(217.2, 91.2%, 59.8%)` - Vibrant blue
- Accent: `hsl(240, 4.8%, 95.9%)` - Light gray
- Background (Light): White
- Background (Dark): Deep blue-black

**Design Properties:**
- Border Radius: 0.5rem (moderate rounding)
- Spacing Scale: 1.0x (standard)
- Font Size: 16px
- Heading Scale: 1.5x
- Line Height: 1.5

**Tags:** `#default` `#professional` `#trading`

---

### 🌲 Forest Canopy
**Best for:** Extended sessions, wellness-focused trading, nature lovers

**Description:** Earth-tone greens inspired by Pacific Northwest forests, perfect for reducing eye strain during extended trading sessions.

**Mood:** Calm, Natural, Grounded

**Colors:**
- Primary: `hsl(142, 76%, 36%)` - Forest green
- Accent: `hsl(85, 38%, 54%)` - Sage green
- Background (Light): Warm white `hsl(60, 9%, 98%)`
- Background (Dark): Deep forest `hsl(150, 15%, 8%)`

**Design Properties:**
- Border Radius: 0.75rem (softer, more rounded)
- Spacing Scale: 1.1x (slightly more spacious)
- Font Size: 16px
- Heading Scale: 1.4x
- Line Height: 1.6 (more relaxed)

**Use Cases:**
- Long trading sessions (reduces eye fatigue)
- Wellness-conscious traders
- Natural, organic aesthetic preference

**Tags:** `#nature` `#calm` `#wellness` `#green`

---

### 🌃 Midnight Matrix
**Best for:** Night trading, dark environments, maximum focus

**Description:** High-contrast cyberpunk theme with neon accents, designed for late-night trading sessions with minimal eye fatigue.

**Mood:** Intense, Focused, Futuristic

**Colors:**
- Primary: `hsl(180, 100%, 45%)` - Cyan
- Accent: `hsl(300, 100%, 60%)` - Magenta
- Background (Light): Very dark blue `hsl(240, 20%, 10%)`
- Background (Dark): True black-blue `hsl(240, 30%, 5%)`

**Design Properties:**
- Border Radius: 0.25rem (sharp, angular edges)
- Spacing Scale: 0.9x (compact, information-dense)
- Font Size: 15px
- Heading Scale: 1.6x (strong hierarchy)
- Line Height: 1.4

**Use Cases:**
- Late-night trading sessions
- Low-light environments
- High-intensity focus work
- Cyberpunk aesthetic lovers

**Tags:** `#dark` `#cyberpunk` `#night` `#high-contrast` `#neon`

---

### 🌊 Oceanic Depths
**Best for:** Stress reduction, clarity, long-term strategy

**Description:** Serene deep-water blues and teals that promote calm decision-making and reduce trading stress.

**Mood:** Serene, Clear, Flowing

**Colors:**
- Primary: `hsl(195, 85%, 48%)` - Ocean blue
- Accent: `hsl(175, 45%, 65%)` - Aqua
- Background (Light): Light blue-white `hsl(200, 25%, 97%)`
- Background (Dark): Deep ocean `hsl(210, 45%, 12%)`

**Design Properties:**
- Border Radius: 0.6rem
- Spacing Scale: 1.05x
- Font Size: 16px
- Heading Scale: 1.45x
- Line Height: 1.55

**Use Cases:**
- Reducing trading stress
- Promoting clear thinking
- Long-term strategy planning
- Calming environment

**Tags:** `#blue` `#calm` `#water` `#serene` `#ocean`

---

### ✨ Golden Hour
**Best for:** Evening trading, blue light reduction, optimistic outlook

**Description:** Warm amber and gold tones that energize while reducing blue light, perfect for evening sessions.

**Mood:** Optimistic, Warm, Energizing

**Colors:**
- Primary: `hsl(35, 85%, 55%)` - Golden orange
- Accent: `hsl(45, 100%, 70%)` - Bright gold
- Background (Light): Cream `hsl(40, 35%, 96%)`
- Background (Dark): Dark amber `hsl(30, 25%, 15%)`

**Design Properties:**
- Border Radius: 0.65rem
- Spacing Scale: 1.0x
- Font Size: 16px
- Heading Scale: 1.5x
- Line Height: 1.55

**Use Cases:**
- Evening/sunset trading
- Reducing blue light exposure
- Creating optimistic atmosphere
- Warm color preference

**Tags:** `#warm` `#gold` `#evening` `#amber` `#energizing`

---

### ⬛ Minimalist Obsidian
**Best for:** Technical analysis, distraction-free work, monochrome preference

**Description:** Pure monochrome theme with maximum contrast for distraction-free technical analysis and data focus.

**Mood:** Minimal, Focused, Elegant

**Colors:**
- Primary: `hsl(0, 0%, 40%)` - Medium gray
- Accent: `hsl(0, 0%, 70%)` - Light gray
- Background (Light): Pure white `hsl(0, 0%, 100%)`
- Background (Dark): Near black `hsl(0, 0%, 5%)`

**Design Properties:**
- Border Radius: 0.3rem (minimal rounding)
- Spacing Scale: 0.95x (tight, efficient)
- Font Size: 15px
- Heading Scale: 1.7x (strong hierarchy)
- Line Height: 1.4

**Use Cases:**
- Technical chart analysis
- Eliminating color distraction
- Minimalist aesthetic preference
- Maximum data clarity

**Tags:** `#minimal` `#monochrome` `#contrast` `#focus` `#black-white`

---

## TypeScript Interface

```typescript
import type { ThemePreset } from '@/lib/theme-presets'

interface ThemeColors {
  primary: { hue: number; saturation: number; lightness: number }
  accent: { hue: number; saturation: number; lightness: number }
  background: { hue: number; saturation: number; lightness: number }
  foreground: { hue: number; saturation: number; lightness: number }
  darkBackground: { hue: number; saturation: number; lightness: number }
  darkForeground: { hue: number; saturation: number; lightness: number }
}

interface ThemeSpacing {
  radiusBase: number    // 0-2 rem
  spacingScale: number  // 0.5-2 multiplier
}

interface ThemeTypography {
  baseFontSize: number  // 12-20 px
  headingScale: number  // 1-2.5 multiplier
  bodyLineHeight: number // 1-2 ratio
  fontFamily?: string
}

interface ThemePreset {
  id: string
  name: string
  description: string
  mood: string
  useCases: string[]
  colors: ThemeColors
  spacing: ThemeSpacing
  typography: ThemeTypography
  author?: string
  tags?: string[]
}
```

## Usage Guide

### Method 1: Using the Theme Editor Panel

1. Click the 🎨 Palette icon in the header
2. Navigate to the **Presets** tab (first tab)
3. Click any preset card to instantly apply it
4. Switch between presets to find your favorite
5. After selecting a preset, customize it further in the Colors, Spacing, or Typography tabs

### Method 2: Using the Theme Preset Switcher (Dropdown)

If your app includes the dropdown switcher:

```tsx
import { ThemePresetSwitcher } from '@/components/theme-preset-switcher'

export function MyComponent() {
  return (
    <div>
      <ThemePresetSwitcher showLabel={true} />
    </div>
  )
}
```

### Method 3: Programmatic Application

```tsx
import { applyThemePreset, forestTheme } from '@/lib/theme-presets'
import { useTheme } from 'next-themes'

function MyComponent() {
  const { theme } = useTheme() // 'light' or 'dark'

  const handleApplyForest = () => {
    applyThemePreset(forestTheme, theme === 'dark')
  }

  return (
    <button onClick={handleApplyForest}>
      Apply Forest Theme
    </button>
  )
}
```

### Method 4: Using Theme Provider (Context)

Wrap your app with the provider:

```tsx
// app/layout.tsx
import { ThemePresetProvider } from '@/components/theme-preset-provider'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ThemeProvider attribute="class">
          <ThemePresetProvider>
            {children}
          </ThemePresetProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

Then use the hook in components:

```tsx
import { useThemePreset } from '@/components/theme-preset-provider'

function ThemeSelector() {
  const { currentPreset, setPreset, availablePresets } = useThemePreset()

  return (
    <select
      value={currentPreset.id}
      onChange={(e) => {
        const preset = availablePresets.find(p => p.id === e.target.value)
        if (preset) setPreset(preset)
      }}
    >
      {availablePresets.map(preset => (
        <option key={preset.id} value={preset.id}>
          {preset.name}
        </option>
      ))}
    </select>
  )
}
```

## Creating Custom Presets

### Step 1: Define Your Theme

Create a new preset object in `/lib/theme-presets.ts`:

```typescript
export const myCustomTheme: ThemePreset = {
  id: 'custom-sunset',
  name: 'Sunset Trader',
  description: 'Warm sunset colors for evening trading sessions',
  mood: 'Relaxed, Warm, Optimistic',
  useCases: ['Evening Trading', 'Relaxation', 'Warm Colors'],
  colors: {
    primary: { hue: 15, saturation: 90, lightness: 55 },
    accent: { hue: 30, saturation: 85, lightness: 65 },
    background: { hue: 20, saturation: 30, lightness: 97 },
    foreground: { hue: 10, saturation: 25, lightness: 20 },
    darkBackground: { hue: 15, saturation: 20, lightness: 10 },
    darkForeground: { hue: 30, saturation: 80, lightness: 90 },
  },
  spacing: {
    radiusBase: 0.7,
    spacingScale: 1.05,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.5,
    bodyLineHeight: 1.6,
  },
  author: 'Your Name',
  tags: ['custom', 'sunset', 'warm', 'evening'],
}
```

### Step 2: Add to Presets Array

```typescript
export const themePresets: ThemePreset[] = [
  defaultTheme,
  forestTheme,
  midnightTheme,
  oceanicTheme,
  goldenHourTheme,
  obsidianTheme,
  myCustomTheme, // Add your theme here
]
```

### Step 3: Use Immediately

Your new preset will now appear in:
- The Theme Editor Presets tab
- The Theme Preset Switcher dropdown
- All theme provider hooks

## Design Guidelines

When creating custom themes, follow these guidelines for best results:

### Color Selection

**Primary Color:**
- Should be bold and distinctive
- Used for buttons, links, primary actions
- Ensure good contrast with backgrounds
- Saturation: 70-100% for vibrant, 30-60% for subtle

**Accent Color:**
- Complements the primary color
- Used for highlights, secondary actions
- Can be analogous or complementary to primary

**Backgrounds:**
- Light mode: 95-100% lightness
- Dark mode: 3-15% lightness
- Low saturation (0-10%) for neutral backgrounds
- Higher saturation (10-30%) for colored backgrounds

### Spacing

**Border Radius:**
- 0-0.3rem: Sharp, modern, technical
- 0.4-0.7rem: Balanced, professional
- 0.8-1.5rem: Soft, friendly, approachable
- 1.5-2rem: Very rounded, playful

**Spacing Scale:**
- 0.8-0.9x: Compact, information-dense
- 1.0x: Standard, balanced
- 1.1-1.3x: Spacious, comfortable
- 1.4x+: Very airy, relaxed

### Typography

**Base Font Size:**
- 14-15px: Compact, data-dense
- 16px: Standard, comfortable
- 17-18px: Large, accessible
- 19-20px: Extra large, high accessibility

**Heading Scale:**
- 1.2-1.4x: Subtle hierarchy
- 1.5-1.6x: Standard hierarchy
- 1.7-2.0x: Strong hierarchy
- 2.1x+: Very dramatic hierarchy

**Line Height:**
- 1.2-1.4: Compact, technical
- 1.5-1.6: Comfortable reading
- 1.7-1.8: Very relaxed
- 1.9-2.0: Maximum readability

## Theme Psychology & Use Cases

### Trading Psychology Alignment

Different themes can psychologically impact trading behavior:

**Cool Colors (Blues, Greens):**
- Promote calm, rational decision-making
- Reduce impulsive trades
- Better for long-term strategy
- Examples: Default, Oceanic, Forest

**Warm Colors (Oranges, Golds):**
- Energizing and optimistic
- Can increase confidence
- Better for active trading
- Examples: Golden Hour

**Monochrome:**
- Maximum focus on data
- Eliminates emotional color associations
- Best for pure technical analysis
- Examples: Minimalist Obsidian

**High Contrast (Neons, Dark):**
- Heightens alertness
- Better for late-night sessions
- Can increase focus intensity
- Examples: Midnight Matrix

### Time-of-Day Recommendations

**Morning (6am-12pm):**
- Default: Professional start to the day
- Oceanic: Clear-minded morning trading
- Forest: Gentle morning energy

**Afternoon (12pm-6pm):**
- Default: Continued professionalism
- Forest: Combat afternoon fatigue
- Oceanic: Maintain clarity

**Evening (6pm-12am):**
- Golden Hour: Reduce blue light
- Midnight Matrix: High-contrast visibility
- Forest: Gentle on eyes

**Late Night (12am-6am):**
- Midnight Matrix: Maximum alertness
- Obsidian: Pure focus
- Any dark theme to reduce eye strain

## Advanced Customization

### Modifying Presets Dynamically

```typescript
import { forestTheme } from '@/lib/theme-presets'

// Create a variation of an existing preset
const customForest: ThemePreset = {
  ...forestTheme,
  id: 'custom-forest-bright',
  name: 'Bright Forest',
  colors: {
    ...forestTheme.colors,
    primary: {
      ...forestTheme.colors.primary,
      lightness: 45, // Brighter than default
    },
  },
}
```

### Seasonal Themes

Create seasonal variations:

```typescript
export const springTheme: ThemePreset = {
  // Light greens, pastel colors
}

export const summerTheme: ThemePreset = {
  // Bright, vibrant colors
}

export const autumnTheme: ThemePreset = {
  // Warm oranges, reds, browns
}

export const winterTheme: ThemePreset = {
  // Cool blues, whites, grays
}
```

### Market Condition Themes

Themes that reflect market sentiment:

```typescript
export const bullMarketTheme: ThemePreset = {
  colors: {
    primary: { hue: 142, saturation: 76, lightness: 36 }, // Green
    // ...optimistic colors
  },
}

export const bearMarketTheme: ThemePreset = {
  colors: {
    primary: { hue: 0, saturation: 84, lightness: 60 }, // Red
    // ...cautious colors
  },
}
```

## Accessibility Considerations

All presets are designed with accessibility in mind:

- **Contrast Ratios:** Primary colors meet WCAG AA standards (4.5:1 minimum)
- **Focus States:** High-contrast focus indicators on all interactive elements
- **Color Blindness:** Themes rely on more than just color (text labels, icons)
- **Adjustable Typography:** All font sizes can be customized

### Testing Your Theme

Use these tools to verify accessibility:

1. **WebAIM Contrast Checker:** Check color contrast ratios
2. **Browser DevTools:** Test with different color vision deficiencies
3. **Screen Reader:** Test with VoiceOver (Mac) or NVDA (Windows)

## Performance Notes

- **CSS Variables:** All themes use native CSS custom properties for optimal performance
- **No JavaScript Overhead:** Color changes are pure CSS, no JS recalculation
- **localStorage:** Minimal storage impact (~1KB per saved theme)
- **Instant Switching:** Theme changes apply immediately with no page reload

## Troubleshooting

### Theme Not Persisting
**Issue:** Theme resets after page reload

**Solutions:**
- Ensure localStorage is enabled in browser
- Check for browser extensions blocking storage
- Clear cache and try again

### Colors Look Different
**Issue:** Colors appear inconsistent across browsers

**Solutions:**
- Different monitors have different color profiles
- Some browsers may apply color management
- Use hex values for exact matching if needed

### Performance Issues
**Issue:** Slow theme switching

**Solutions:**
- Reduce number of animated elements
- Check for heavy CSS transitions on theme change
- Ensure no JavaScript conflicts

## Future Enhancements

Potential additions to the theme preset system:

- [ ] **Community Themes:** User-submitted preset library
- [ ] **Import/Export:** Share themes via JSON
- [ ] **Theme Scheduling:** Auto-switch themes by time of day
- [ ] **AI Theme Generator:** Generate themes from a single color
- [ ] **Theme Voting:** Community rating system for presets
- [ ] **Gradient Support:** Multi-color gradient backgrounds
- [ ] **Animation Presets:** Different transition styles per theme
- [ ] **Sound Themes:** Audio feedback matching visual theme

---

**Version:** 1.0.0
**Last Updated:** 2025-10-21
**Author:** Cascadian Development Team
