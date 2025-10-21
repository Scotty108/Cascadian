/**
 * Theme Preset System for Cascadian App - BOLD & BEAUTIFUL EDITION
 *
 * These are visually striking, modern themes designed to inspire.
 * Each has a strong personality and premium feel.
 */

export interface ThemeColors {
  primary: {
    hue: number
    saturation: number
    lightness: number
  }
  accent: {
    hue: number
    saturation: number
    lightness: number
  }
  background: {
    hue: number
    saturation: number
    lightness: number
  }
  foreground: {
    hue: number
    saturation: number
    lightness: number
  }
  darkBackground: {
    hue: number
    saturation: number
    lightness: number
  }
  darkForeground: {
    hue: number
    saturation: number
    lightness: number
  }
}

export interface ThemeSpacing {
  radiusBase: number
  spacingScale: number
}

export interface ThemeTypography {
  baseFontSize: number
  headingScale: number
  bodyLineHeight: number
  fontFamily?: string
}

export interface ThemePreset {
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

/**
 * ELECTRIC VIOLET
 * Bold neon purple with electric blue accents - cyberpunk meets premium
 */
export const electricVioletTheme: ThemePreset = {
  id: 'electric-violet',
  name: 'Electric Violet',
  description: 'Bold neon purple with electric blue - a premium cyberpunk aesthetic that commands attention',
  mood: 'Bold, Futuristic, Premium',
  useCases: ['Night Trading', 'Making a Statement', 'High Energy'],
  colors: {
    primary: { hue: 270, saturation: 95, lightness: 65 },      // Vibrant purple
    accent: { hue: 200, saturation: 100, lightness: 55 },      // Electric cyan
    background: { hue: 0, saturation: 0, lightness: 98 },      // Almost white
    foreground: { hue: 270, saturation: 40, lightness: 15 },   // Deep purple-black
    darkBackground: { hue: 270, saturation: 30, lightness: 8 }, // Deep purple-black
    darkForeground: { hue: 270, saturation: 90, lightness: 92 }, // Bright purple-white
  },
  spacing: {
    radiusBase: 0.75,
    spacingScale: 1.05,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.6,
    bodyLineHeight: 1.5,
  },
  tags: ['neon', 'purple', 'cyberpunk', 'premium', 'bold'],
}

/**
 * DEEP SPACE
 * Rich cosmic purples and blues with golden accents - like trading among the stars
 */
export const deepSpaceTheme: ThemePreset = {
  id: 'deep-space',
  name: 'Deep Space',
  description: 'Cosmic purples and deep blues with golden star accents - sophisticated and otherworldly',
  mood: 'Mysterious, Sophisticated, Cosmic',
  useCases: ['Focused Trading', 'Late Night', 'Premium Feel'],
  colors: {
    primary: { hue: 250, saturation: 70, lightness: 58 },     // Royal purple
    accent: { hue: 45, saturation: 90, lightness: 65 },       // Golden amber
    background: { hue: 250, saturation: 20, lightness: 96 },  // Soft purple-white
    foreground: { hue: 250, saturation: 50, lightness: 12 },  // Deep purple
    darkBackground: { hue: 250, saturation: 40, lightness: 6 }, // Deep space
    darkForeground: { hue: 45, saturation: 85, lightness: 85 }, // Soft gold
  },
  spacing: {
    radiusBase: 0.8,
    spacingScale: 1.08,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.55,
    bodyLineHeight: 1.6,
  },
  tags: ['purple', 'gold', 'premium', 'cosmic', 'sophisticated'],
}

/**
 * EMERALD WEALTH
 * Deep emerald greens with rose gold - luxury fintech vibes
 */
export const emeraldWealthTheme: ThemePreset = {
  id: 'emerald-wealth',
  name: 'Emerald Wealth',
  description: 'Deep emerald with rose gold accents - the premium feel of luxury fintech',
  mood: 'Luxurious, Confident, Prosperous',
  useCases: ['Portfolio Growth', 'Professional Trading', 'Premium Experience'],
  colors: {
    primary: { hue: 155, saturation: 70, lightness: 42 },     // Rich emerald
    accent: { hue: 25, saturation: 75, lightness: 60 },       // Rose gold
    background: { hue: 155, saturation: 12, lightness: 98 },  // Soft green-white
    foreground: { hue: 155, saturation: 45, lightness: 15 },  // Deep green-black
    darkBackground: { hue: 155, saturation: 35, lightness: 9 }, // Deep emerald
    darkForeground: { hue: 25, saturation: 70, lightness: 88 }, // Soft rose gold
  },
  spacing: {
    radiusBase: 0.6,
    spacingScale: 1.1,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.5,
    bodyLineHeight: 1.6,
  },
  tags: ['green', 'gold', 'luxury', 'wealth', 'premium'],
}

/**
 * SUNSET GRADIENT
 * Warm gradient from coral to deep purple - Instagram-worthy aesthetic
 */
export const sunsetGradientTheme: ThemePreset = {
  id: 'sunset-gradient',
  name: 'Sunset Gradient',
  description: 'Warm coral to deep purple gradient - beautiful, modern, and energizing',
  mood: 'Warm, Creative, Inspiring',
  useCases: ['Creative Trading', 'Positive Vibes', 'Evening Sessions'],
  colors: {
    primary: { hue: 340, saturation: 85, lightness: 60 },     // Coral pink
    accent: { hue: 280, saturation: 75, lightness: 58 },      // Purple
    background: { hue: 15, saturation: 25, lightness: 97 },   // Warm white
    foreground: { hue: 280, saturation: 40, lightness: 18 },  // Deep purple
    darkBackground: { hue: 280, saturation: 35, lightness: 10 }, // Deep purple
    darkForeground: { hue: 340, saturation: 80, lightness: 88 }, // Soft coral
  },
  spacing: {
    radiusBase: 1.0,
    spacingScale: 1.12,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.55,
    bodyLineHeight: 1.65,
  },
  tags: ['gradient', 'warm', 'coral', 'purple', 'creative'],
}

/**
 * ARCTIC GLASS
 * Frosted glass aesthetic with cool blues - modern iOS/premium feel
 */
export const arcticGlassTheme: ThemePreset = {
  id: 'arctic-glass',
  name: 'Arctic Glass',
  description: 'Frosted glass aesthetic with crystal blues - ultra-modern and sophisticated',
  mood: 'Clean, Premium, Refined',
  useCases: ['Clarity', 'Professional', 'Modern Aesthetic'],
  colors: {
    primary: { hue: 200, saturation: 95, lightness: 52 },     // Crystal blue
    accent: { hue: 190, saturation: 50, lightness: 75 },      // Soft cyan
    background: { hue: 200, saturation: 20, lightness: 98 },  // Ice white
    foreground: { hue: 210, saturation: 50, lightness: 12 },  // Deep blue-black
    darkBackground: { hue: 210, saturation: 25, lightness: 11 }, // Deep ice
    darkForeground: { hue: 200, saturation: 85, lightness: 90 }, // Bright ice
  },
  spacing: {
    radiusBase: 1.2,
    spacingScale: 1.15,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.5,
    bodyLineHeight: 1.6,
  },
  tags: ['blue', 'glass', 'modern', 'premium', 'clean'],
}

/**
 * HOT MAGMA
 * Bold reds and oranges - high energy trading aesthetic
 */
export const hotMagmaTheme: ThemePreset = {
  id: 'hot-magma',
  name: 'Hot Magma',
  description: 'Bold reds and fiery oranges - intense energy for aggressive trading',
  mood: 'Intense, Energetic, Bold',
  useCases: ['Day Trading', 'High Energy', 'Aggressive Moves'],
  colors: {
    primary: { hue: 355, saturation: 90, lightness: 58 },     // Hot red
    accent: { hue: 25, saturation: 100, lightness: 60 },      // Bright orange
    background: { hue: 15, saturation: 15, lightness: 98 },   // Warm white
    foreground: { hue: 355, saturation: 50, lightness: 15 },  // Deep red-black
    darkBackground: { hue: 10, saturation: 30, lightness: 8 }, // Deep magma
    darkForeground: { hue: 25, saturation: 95, lightness: 88 }, // Bright orange
  },
  spacing: {
    radiusBase: 0.4,
    spacingScale: 0.98,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.7,
    bodyLineHeight: 1.45,
  },
  tags: ['red', 'orange', 'fire', 'energy', 'bold'],
}

/**
 * VELVET NOIR
 * Deep burgundy and rich blacks - ultra-premium dark aesthetic
 */
export const velvetNoirTheme: ThemePreset = {
  id: 'velvet-noir',
  name: 'Velvet Noir',
  description: 'Deep burgundy with rich blacks - the ultimate premium dark mode experience',
  mood: 'Luxurious, Sophisticated, Dramatic',
  useCases: ['Premium Trading', 'Night Sessions', 'Sophisticated Feel'],
  colors: {
    primary: { hue: 345, saturation: 65, lightness: 48 },     // Deep burgundy
    accent: { hue: 35, saturation: 80, lightness: 68 },       // Champagne gold
    background: { hue: 345, saturation: 8, lightness: 97 },   // Soft rose-white
    foreground: { hue: 345, saturation: 40, lightness: 12 },  // Deep burgundy-black
    darkBackground: { hue: 345, saturation: 25, lightness: 7 }, // Rich velvet black
    darkForeground: { hue: 35, saturation: 75, lightness: 85 }, // Soft champagne
  },
  spacing: {
    radiusBase: 0.5,
    spacingScale: 1.05,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.6,
    bodyLineHeight: 1.55,
  },
  tags: ['burgundy', 'gold', 'dark', 'luxury', 'premium'],
}

/**
 * LIME PULSE
 * Electric lime with deep navy - fresh, modern, energetic
 */
export const limePulseTheme: ThemePreset = {
  id: 'lime-pulse',
  name: 'Lime Pulse',
  description: 'Electric lime green with deep navy - fresh, modern, and impossible to ignore',
  mood: 'Fresh, Energetic, Modern',
  useCases: ['Active Trading', 'High Energy', 'Standing Out'],
  colors: {
    primary: { hue: 75, saturation: 95, lightness: 50 },      // Electric lime
    accent: { hue: 215, saturation: 80, lightness: 35 },      // Deep navy
    background: { hue: 75, saturation: 20, lightness: 98 },   // Soft lime-white
    foreground: { hue: 215, saturation: 70, lightness: 15 },  // Deep navy
    darkBackground: { hue: 215, saturation: 50, lightness: 8 }, // Deep navy
    darkForeground: { hue: 75, saturation: 90, lightness: 88 }, // Bright lime
  },
  spacing: {
    radiusBase: 0.65,
    spacingScale: 1.0,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.65,
    bodyLineHeight: 1.5,
  },
  tags: ['green', 'lime', 'navy', 'fresh', 'modern'],
}

/**
 * DEFAULT (Keeping one conservative option)
 */
export const defaultTheme: ThemePreset = {
  id: 'default',
  name: 'Cascadian Blue',
  description: 'Classic professional blue - clean, trustworthy, and timeless',
  mood: 'Professional, Clean, Reliable',
  useCases: ['Traditional Trading', 'Professional Use', 'Conservative Preference'],
  colors: {
    primary: { hue: 217, saturation: 91, lightness: 60 },
    accent: { hue: 240, saturation: 5, lightness: 96 },
    background: { hue: 0, saturation: 0, lightness: 100 },
    foreground: { hue: 240, saturation: 10, lightness: 4 },
    darkBackground: { hue: 240, saturation: 10, lightness: 4 },
    darkForeground: { hue: 0, saturation: 0, lightness: 98 },
  },
  spacing: {
    radiusBase: 0.5,
    spacingScale: 1.0,
  },
  typography: {
    baseFontSize: 16,
    headingScale: 1.5,
    bodyLineHeight: 1.5,
  },
  tags: ['blue', 'professional', 'classic', 'default'],
}

export const themePresets: ThemePreset[] = [
  electricVioletTheme,
  deepSpaceTheme,
  emeraldWealthTheme,
  sunsetGradientTheme,
  arcticGlassTheme,
  hotMagmaTheme,
  velvetNoirTheme,
  limePulseTheme,
  defaultTheme,
]

export function getThemeById(id: string): ThemePreset | undefined {
  return themePresets.find(theme => theme.id === id)
}

export function getThemesByTag(tag: string): ThemePreset[] {
  return themePresets.filter(theme => theme.tags?.includes(tag))
}

export function themePresetToConfig(preset: ThemePreset) {
  return {
    primaryHue: preset.colors.primary.hue,
    primarySaturation: preset.colors.primary.saturation,
    primaryLightness: preset.colors.primary.lightness,
    accentHue: preset.colors.accent.hue,
    accentSaturation: preset.colors.accent.saturation,
    accentLightness: preset.colors.accent.lightness,
    radiusBase: preset.spacing.radiusBase,
    spacingScale: preset.spacing.spacingScale,
    baseFontSize: preset.typography.baseFontSize,
    headingScale: preset.typography.headingScale,
    bodyLineHeight: preset.typography.bodyLineHeight,
  }
}

export function formatHSL(color: { hue: number; saturation: number; lightness: number }): string {
  return `${color.hue} ${color.saturation}% ${color.lightness}%`
}

export function applyThemePreset(preset: ThemePreset, isDark: boolean = false) {
  const root = document.documentElement
  const { colors } = preset

  root.style.setProperty('--primary', formatHSL(colors.primary))
  root.style.setProperty('--ring', formatHSL(colors.primary))
  root.style.setProperty('--accent', formatHSL(colors.accent))

  if (isDark) {
    root.style.setProperty('--background', formatHSL(colors.darkBackground))
    root.style.setProperty('--foreground', formatHSL(colors.darkForeground))
  } else {
    root.style.setProperty('--background', formatHSL(colors.background))
    root.style.setProperty('--foreground', formatHSL(colors.foreground))
  }

  root.style.setProperty('--radius', `${preset.spacing.radiusBase}rem`)
  root.style.setProperty('--spacing-scale', `${preset.spacing.spacingScale}`)
  root.style.setProperty('--base-font-size', `${preset.typography.baseFontSize}px`)
  root.style.setProperty('--heading-scale', `${preset.typography.headingScale}`)
  root.style.setProperty('--body-line-height', `${preset.typography.bodyLineHeight}`)
}

// Export individual themes for direct access
export {
  electricVioletTheme as electricViolet,
  deepSpaceTheme as deepSpace,
  emeraldWealthTheme as emeraldWealth,
  sunsetGradientTheme as sunsetGradient,
  arcticGlassTheme as arcticGlass,
  hotMagmaTheme as hotMagma,
  velvetNoirTheme as velvetNoir,
  limePulseTheme as limePulse,
}
