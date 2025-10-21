# Theme Editor Documentation

## Overview

The Theme Editor is a powerful, user-friendly interface that allows Cascadian app users to customize the visual appearance of the application in real-time. It provides granular control over colors, spacing, and typography through an intuitive hover/click panel interface.

## Features

### 🎨 **Color Customization**
- **Primary Color**: Customize the main brand color used throughout the app
- **Accent Color**: Adjust secondary accent colors for highlights and interactive elements
- **HSL Controls**: Fine-tune hue, saturation, and lightness values independently
- **Color Picker**: Visual color picker with hex input for precise color selection
- **Real-time Preview**: See changes instantly across the entire application

### 📐 **Spacing Controls**
- **Border Radius**: Adjust the roundness of corners (0rem to 2rem)
- **Visual Preview**: Three sample cards showing small, medium, and large border radius
- **Spacing Scale**: Global multiplier for padding, margins, and gaps (0.5x to 2x)

### 📝 **Typography Settings**
- **Base Font Size**: Control the root font size (12px to 20px)
- **Heading Scale**: Adjust the size ratio between headings and body text (1x to 2.5x)
- **Line Height**: Control text line spacing for readability (1 to 2)
- **Live Preview**: See typography changes in real-time preview

### ♿ **Accessibility Features**
- **Keyboard Navigation**: Full keyboard support with Escape key to close
- **ARIA Labels**: Comprehensive screen reader support
- **Focus States**: High-contrast focus indicators on all interactive elements
- **Semantic HTML**: Proper heading hierarchy and landmark regions

### 💾 **Persistence**
- **localStorage**: Settings automatically saved to browser storage
- **Instant Load**: Theme preferences restored on page load
- **Reset Function**: One-click restore to default values

## Integration Guide

### 1. Component Location

The Theme Editor is located at:
```
/components/theme-editor.tsx
```

### 2. Current Integration

The Theme Editor is already integrated into the Topbar component:

```tsx
// components/topbar.tsx
import { ThemeEditor } from "@/components/theme-editor";

export function Topbar() {
  return (
    <header>
      {/* Right section */}
      <div className="flex items-center gap-2 w-1/4 justify-end">
        <ThemeEditor />
        <ThemeToggle variant="ghost" />
        {/* Other header items */}
      </div>
    </header>
  );
}
```

### 3. How to Use in Other Components

You can add the Theme Editor anywhere in your app:

```tsx
import { ThemeEditor } from "@/components/theme-editor";

export function YourComponent() {
  return (
    <div>
      <ThemeEditor className="your-custom-class" />
    </div>
  );
}
```

## CSS Variables

The Theme Editor controls the following CSS custom properties:

### Color Variables
```css
--primary: [hue] [saturation]% [lightness]%
--ring: [hue] [saturation]% [lightness]%
--accent: [hue] [saturation]% [lightness]%
```

### Spacing Variables
```css
--radius: [value]rem
--spacing-scale: [multiplier]
```

### Typography Variables
```css
--base-font-size: [value]px
--heading-scale: [multiplier]
--body-line-height: [value]
```

## Extending the Design Tokens

### Adding New Color Variables

To add a new color token:

1. **Add to the default theme** in `theme-editor.tsx`:

```tsx
const DEFAULT_THEME = {
  // Existing colors...

  // Add new color
  successHue: 142,
  successSaturation: 76,
  successLightness: 36,
}
```

2. **Update the type**:

```tsx
type ThemeConfig = typeof DEFAULT_THEME
```

3. **Add the CSS variable** in the `useEffect` hook:

```tsx
useEffect(() => {
  const root = document.documentElement

  // Add new variable
  root.style.setProperty(
    '--success',
    `${theme.successHue} ${theme.successSaturation}% ${theme.successLightness}%`
  )
}, [theme])
```

4. **Add UI controls** in the Colors tab:

```tsx
<TabsContent value="colors">
  {/* Existing controls... */}

  <div className="space-y-2">
    <Label htmlFor="success-color">Success Color</Label>
    <Input
      id="success-color"
      type="color"
      value={hslToHex(theme.successHue, theme.successSaturation, theme.successLightness)}
      onChange={(e) => handleColorChange('success', e.target.value)}
      className="w-16 h-10 p-1 cursor-pointer"
    />
  </div>
</TabsContent>
```

### Adding New Spacing Variables

1. **Add to default theme**:

```tsx
const DEFAULT_THEME = {
  // Existing values...

  // Add new spacing
  customPadding: 1.0, // rem
}
```

2. **Apply in useEffect**:

```tsx
root.style.setProperty('--custom-padding', `${theme.customPadding}rem`)
```

3. **Add slider control**:

```tsx
<div className="space-y-2">
  <Label htmlFor="custom-padding">
    Custom Padding: {theme.customPadding.toFixed(2)}rem
  </Label>
  <Slider
    id="custom-padding"
    value={[theme.customPadding]}
    onValueChange={([value]) => updateTheme('customPadding', value)}
    min={0}
    max={5}
    step={0.1}
  />
</div>
```

### Adding New Typography Variables

1. **Add to default theme**:

```tsx
const DEFAULT_THEME = {
  // Existing values...

  // Add new typography
  monoFontSize: 14, // px
}
```

2. **Apply in useEffect**:

```tsx
root.style.setProperty('--mono-font-size', `${theme.monoFontSize}px`)
```

3. **Add control in Typography tab**:

```tsx
<div className="space-y-2">
  <Label htmlFor="mono-font-size">
    Monospace Font Size: {theme.monoFontSize}px
  </Label>
  <Slider
    id="mono-font-size"
    value={[theme.monoFontSize]}
    onValueChange={([value]) => updateTheme('monoFontSize', value)}
    min={10}
    max={18}
    step={1}
  />
</div>
```

## Using Design Tokens in Components

### Using CSS Variables Directly

```tsx
export function CustomCard() {
  return (
    <div
      className="p-4 rounded"
      style={{
        borderRadius: 'var(--radius)',
        padding: 'calc(1rem * var(--spacing-scale))'
      }}
    >
      <h2 style={{ fontSize: 'calc(var(--base-font-size) * var(--heading-scale))' }}>
        Heading
      </h2>
      <p style={{
        fontSize: 'var(--base-font-size)',
        lineHeight: 'var(--body-line-height)'
      }}>
        Body text
      </p>
    </div>
  )
}
```

### Using with Tailwind

Update your `tailwind.config.ts` to reference CSS variables:

```ts
module.exports = {
  theme: {
    extend: {
      spacing: {
        'scaled': 'calc(1rem * var(--spacing-scale))',
      },
      fontSize: {
        'base-scaled': 'var(--base-font-size)',
        'heading': 'calc(var(--base-font-size) * var(--heading-scale))',
      },
      lineHeight: {
        'body': 'var(--body-line-height)',
      },
    },
  },
}
```

Then use in components:

```tsx
<div className="p-scaled rounded-[var(--radius)]">
  <h1 className="text-heading">Title</h1>
  <p className="text-base-scaled leading-body">Content</p>
</div>
```

## Technical Details

### Component Architecture

```
theme-editor.tsx
├── State Management (useState)
│   ├── isOpen: Panel visibility
│   ├── theme: Current theme configuration
│   └── mounted: Hydration check
│
├── Effects (useEffect)
│   ├── Load from localStorage
│   ├── Apply CSS variables
│   ├── Click outside detection
│   └── Keyboard navigation
│
├── UI Structure
│   ├── Trigger Button (🎨)
│   ├── Floating Panel
│   │   ├── Header (Title + Actions)
│   │   └── Tabs
│   │       ├── Colors Tab
│   │       ├── Spacing Tab
│   │       └── Typography Tab
│   └── Controls (Sliders, Inputs, Color Pickers)
│
└── Utility Functions
    ├── hslToHex: Convert HSL to hex color
    ├── hexToHsl: Convert hex to HSL values
    └── handleColorChange: Update color from picker
```

### Browser Compatibility

- **Modern Browsers**: Full support (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)
- **localStorage**: Graceful fallback if unavailable
- **CSS Custom Properties**: Required (no fallback for older browsers)
- **Color Input**: Fallback to text input if not supported

### Performance Considerations

- **Debouncing**: Slider changes apply immediately (no debounce needed)
- **localStorage**: Writes on every change (minimal performance impact)
- **Re-renders**: Optimized with React hooks
- **CSS Variables**: Native browser performance, no JS recalculation needed

## User Guide

### Opening the Theme Editor

1. **Hover Method**: Hover over the 🎨 Palette icon in the header
2. **Click Method**: Click the 🎨 Palette icon to open/close
3. **Close**: Click X button, click outside panel, or press Escape key

### Customizing Colors

1. Navigate to the **Colors** tab
2. Click the color square to open color picker
3. Or, type/paste a hex color code directly
4. Use HSL sliders for fine-tuning:
   - **Hue**: 0-360° (color wheel position)
   - **Saturation**: 0-100% (color intensity)
   - **Lightness**: 0-100% (brightness)

### Adjusting Spacing

1. Navigate to the **Spacing** tab
2. **Border Radius**: Drag slider to adjust corner roundness
   - View preview boxes showing the effect
3. **Spacing Scale**: Adjust overall padding/margins
   - 1.0 = default, 0.5 = compact, 2.0 = spacious

### Modifying Typography

1. Navigate to the **Typography** tab
2. **Base Font Size**: Adjust root font size
3. **Heading Scale**: Control heading-to-body size ratio
4. **Line Height**: Adjust text line spacing
5. Preview changes in the sample text

### Resetting to Defaults

Click the **↻** Reset icon in the panel header to restore all settings to default values.

## Troubleshooting

### Theme Not Persisting

**Issue**: Settings reset on page reload

**Solution**:
- Check browser's localStorage is enabled
- Clear cache and hard reload (Cmd/Ctrl + Shift + R)
- Check browser console for errors

### Colors Not Updating

**Issue**: Color changes don't apply to components

**Solution**:
- Ensure components use CSS variables (`var(--primary)`)
- Check that components aren't using hard-coded colors
- Verify the component is within the scope of `:root` styles

### Panel Not Opening

**Issue**: Clicking palette icon doesn't open panel

**Solution**:
- Check browser console for JavaScript errors
- Ensure React is properly hydrated (no SSR mismatches)
- Try refreshing the page

### Spacing Changes Not Visible

**Issue**: Spacing scale doesn't affect layout

**Solution**:
- Components must explicitly use `var(--spacing-scale)`
- Update components to use scaled spacing values
- Example: `padding: calc(1rem * var(--spacing-scale))`

## Future Enhancements

Potential features for future versions:

- [ ] **Theme Presets**: Save and switch between multiple custom themes
- [ ] **Export/Import**: Share theme configurations via JSON
- [ ] **Color Palette Generator**: Auto-generate harmonious color schemes
- [ ] **Dark Mode Variants**: Separate customization for light/dark modes
- [ ] **Component Preview**: Live preview of specific components
- [ ] **Animation Controls**: Customize transition speeds and easing
- [ ] **Shadow System**: Customize elevation and shadow styles
- [ ] **Grid System**: Customize breakpoints and container widths
- [ ] **Theme Sharing**: Social sharing of custom themes
- [ ] **A11y Checker**: Real-time contrast ratio validation

## Credits

Built with:
- **React 18**: UI framework
- **Next.js 15**: App framework
- **Tailwind CSS**: Utility-first CSS
- **Radix UI**: Accessible component primitives
- **shadcn/ui**: Component library
- **Lucide React**: Icon library

---

**Version**: 1.0.0
**Last Updated**: 2025-10-21
**Maintainer**: Cascadian Development Team
