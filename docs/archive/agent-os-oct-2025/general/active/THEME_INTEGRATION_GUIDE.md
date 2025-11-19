# Theme System Integration Guide

Quick reference for integrating the Theme Editor and Theme Preset system into your Cascadian app.

## Quick Start

### 1. Files Created

The theme system consists of these files:

```
/lib/theme-presets.ts                    # Theme definitions and utilities
/components/theme-editor.tsx              # Main theme editor panel
/components/theme-preset-provider.tsx     # React context provider
/components/theme-preset-switcher.tsx     # Preset selector components
/app/globals.css                          # Extended CSS variables
THEME_EDITOR.md                          # Editor documentation
THEME_PRESETS.md                         # Presets documentation
```

### 2. Already Integrated

✅ **ThemeEditor** is already added to the Topbar component
✅ **CSS Variables** are extended in globals.css
✅ **Presets Tab** is integrated into ThemeEditor

### 3. Optional: Add Theme Preset Provider

For advanced theme management with context, add the provider to your root layout:

```tsx
// app/layout.tsx
import { ThemeProvider } from "next-themes"
import { ThemePresetProvider } from "@/components/theme-preset-provider"

export default function RootLayout({ children }) {
  return (
    <html suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ThemePresetProvider>
            {children}
          </ThemePresetProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
```

### 4. Optional: Add Preset Dropdown to Topbar

If you want a quick dropdown selector in addition to the editor panel:

```tsx
// components/topbar.tsx
import { ThemePresetSwitcherCompact } from "@/components/theme-preset-switcher"

export function Topbar() {
  return (
    <header>
      {/* Right section */}
      <div className="flex items-center gap-2">
        <ThemePresetSwitcherCompact />  {/* Add this */}
        <ThemeEditor />
        <ThemeToggle variant="ghost" />
        {/* ... rest of topbar */}
      </div>
    </header>
  )
}
```

### 5. Optional: Create a Theme Settings Page

For a dedicated theme customization page:

```tsx
// app/(dashboard)/settings/theme/page.tsx
import { ThemePresetGallery } from "@/components/theme-preset-switcher"
import { ThemeEditor } from "@/components/theme-editor"

export default function ThemeSettingsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Theme Settings</h1>
        <p className="text-muted-foreground mt-2">
          Customize the appearance of your Cascadian dashboard
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Preset Themes</h2>
        <ThemePresetGallery />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Advanced Customization</h2>
        <ThemeEditor />
      </section>
    </div>
  )
}
```

## How It Works

### User Flow

1. **User opens Theme Editor** (🎨 icon in header)
2. **Selects Presets tab** (default tab)
3. **Clicks a preset** → Instantly applied
4. **Optionally customizes** via Colors/Spacing/Typography tabs
5. **Settings auto-save** to localStorage

### Technical Flow

```
User clicks preset
    ↓
applyPreset() called
    ↓
Converts preset to config via themePresetToConfig()
    ↓
Updates React state
    ↓
useEffect triggers
    ↓
CSS custom properties updated on :root
    ↓
Entire app re-renders with new theme
    ↓
Settings saved to localStorage
```

### Data Flow

```typescript
ThemePreset (lib/theme-presets.ts)
    ↓ themePresetToConfig()
ThemeConfig (components/theme-editor.tsx)
    ↓ useEffect
CSS Variables (--primary, --radius, etc.)
    ↓ CSS cascade
Tailwind Classes (bg-primary, rounded-md, etc.)
    ↓
Visual appearance
```

## Code Examples

### Using a Preset Programmatically

```tsx
import { applyThemePreset, forestTheme } from '@/lib/theme-presets'

function MyComponent() {
  return (
    <button onClick={() => applyThemePreset(forestTheme, false)}>
      Apply Forest Theme
    </button>
  )
}
```

### Getting Current Preset (with Context)

```tsx
import { useThemePreset } from '@/components/theme-preset-provider'

function MyComponent() {
  const { currentPreset, setPreset, isCustom } = useThemePreset()

  return (
    <div>
      <p>Current: {currentPreset.name}</p>
      {isCustom && <Badge>Customized</Badge>}
    </div>
  )
}
```

### Creating a Custom Preset Selector

```tsx
import { themePresets } from '@/lib/theme-presets'
import { useThemePreset } from '@/components/theme-preset-provider'

function CustomSelector() {
  const { currentPreset, setPreset } = useThemePreset()

  return (
    <div className="grid grid-cols-3 gap-2">
      {themePresets.map(preset => (
        <button
          key={preset.id}
          onClick={() => setPreset(preset)}
          className={cn(
            "p-2 rounded border",
            currentPreset.id === preset.id && "border-primary"
          )}
        >
          {preset.name}
        </button>
      ))}
    </div>
  )
}
```

### Using Theme Colors in Custom Components

```tsx
// Use CSS variables directly
function CustomCard() {
  return (
    <div
      style={{
        backgroundColor: 'hsl(var(--primary))',
        borderRadius: 'var(--radius)',
        padding: 'calc(1rem * var(--spacing-scale))'
      }}
    >
      Card content
    </div>
  )
}

// Or use Tailwind classes
function CustomCard() {
  return (
    <div className="bg-primary rounded-md p-4">
      Card content
    </div>
  )
}
```

## Extending the System

### Adding a New Preset

1. **Define in `/lib/theme-presets.ts`:**

```typescript
export const myTheme: ThemePreset = {
  id: 'my-theme',
  name: 'My Theme',
  description: 'A custom theme',
  mood: 'Energetic',
  useCases: ['Trading', 'Analysis'],
  colors: {
    primary: { hue: 280, saturation: 90, lightness: 55 },
    accent: { hue: 300, saturation: 70, lightness: 65 },
    background: { hue: 0, saturation: 0, lightness: 100 },
    foreground: { hue: 0, saturation: 0, lightness: 10 },
    darkBackground: { hue: 280, saturation: 20, lightness: 10 },
    darkForeground: { hue: 300, saturation: 80, lightness: 90 },
  },
  spacing: {
    radiusBase: 0.6,
    spacingScale: 1.0,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.5,
    bodyLineHeight: 1.5,
  },
  tags: ['custom', 'purple', 'energetic'],
}
```

2. **Add to array:**

```typescript
export const themePresets: ThemePreset[] = [
  defaultTheme,
  forestTheme,
  // ... other themes
  myTheme, // Add here
]
```

3. **It's live!** The theme now appears in all theme selectors.

### Adding a New CSS Variable

1. **Add to globals.css:**

```css
:root {
  --my-custom-property: 10px;
}
```

2. **Apply in ThemeEditor useEffect:**

```typescript
useEffect(() => {
  const root = document.documentElement
  root.style.setProperty('--my-custom-property', `${theme.myValue}px`)
}, [theme])
```

3. **Add UI control in ThemeEditor:**

```tsx
<Slider
  value={[theme.myValue]}
  onValueChange={([value]) => updateTheme('myValue', value)}
  min={0}
  max={100}
/>
```

## Testing Checklist

- [ ] Theme Editor opens on hover/click
- [ ] All 6 presets display correctly
- [ ] Clicking a preset applies it immediately
- [ ] Custom adjustments work (colors, spacing, typography)
- [ ] Settings persist after page reload
- [ ] Reset button works
- [ ] Theme works in both light and dark mode
- [ ] Keyboard navigation works (Tab, Escape)
- [ ] Mobile responsive
- [ ] Screen reader accessible

## Performance Tips

1. **CSS Variables are Fast:** No JavaScript recalculation needed
2. **Debouncing:** Sliders update immediately (no delay needed for good UX)
3. **localStorage:** Writes are async and don't block UI
4. **Minimal Re-renders:** Only theme state changes, not entire app

## Common Issues & Solutions

### Issue: Hydration Mismatch

**Error:** "Hydration failed because the initial UI does not match..."

**Solution:**
```tsx
const [mounted, setMounted] = useState(false)

useEffect(() => {
  setMounted(true)
}, [])

if (!mounted) return null
```

### Issue: Theme Not Applying to Some Components

**Problem:** Hard-coded colors instead of CSS variables

**Solution:**
```tsx
// ❌ Hard-coded
<div className="bg-blue-500">

// ✅ Uses theme
<div className="bg-primary">
```

### Issue: localStorage Quota Exceeded

**Problem:** Too much data stored

**Solution:** Clear old theme configs periodically or compress data

## Best Practices

1. **Always use CSS variables** for themeable properties
2. **Test in light AND dark mode** when creating presets
3. **Validate contrast ratios** for accessibility
4. **Provide preset descriptions** to guide users
5. **Tag appropriately** for easy discovery
6. **Consider use cases** when designing themes
7. **Test on multiple displays** (different color profiles)

## Resources

- **Theme Editor Docs:** `/THEME_EDITOR.md`
- **Preset Docs:** `/THEME_PRESETS.md`
- **shadcn/ui Docs:** https://ui.shadcn.com
- **HSL Color Picker:** https://hslpicker.com
- **Contrast Checker:** https://webaim.org/resources/contrastchecker/

---

**Need Help?** Check the full documentation in `THEME_EDITOR.md` and `THEME_PRESETS.md`
