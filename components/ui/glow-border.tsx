import { cn } from "@/lib/utils";

interface GlowBorderProps {
  children: React.ReactNode;
  className?: string;
  color?: 'default' | 'purple' | 'blue' | 'emerald';
  intensity?: 'subtle' | 'medium' | 'strong';
  speed?: 'slow' | 'medium' | 'fast';
  thick?: boolean;
}

/**
 * GlowBorder Component
 *
 * Creates an animated gradient border with a matching glow effect.
 * Uses CSS Houdini @property for smooth gradient rotation.
 * Inspired by Apple Intelligence UI.
 *
 * @example
 * ```tsx
 * <GlowBorder color="purple" intensity="strong">
 *   <Card>Your content</Card>
 * </GlowBorder>
 * ```
 *
 * @param children - Content to wrap
 * @param className - Additional classes for the wrapper
 * @param color - Color variant: default (cyan), purple, blue, emerald
 * @param intensity - Glow intensity: subtle, medium, or strong (default: medium)
 * @param speed - Animation speed: slow, medium, fast (default: medium)
 * @param thick - Use thicker border (default: false)
 */
export function GlowBorder({
  children,
  className,
  color = 'default',
  intensity = 'medium',
  speed = 'medium',
  thick = false,
}: GlowBorderProps) {
  const colorClass = color !== 'default' ? `glow-border-${color}` : '';
  const intensityClass = intensity !== 'medium' ? `glow-border-${intensity}` : '';
  const speedClass = speed !== 'medium' ? `glow-border-${speed}` : '';
  const thickClass = thick ? 'glow-border-thick' : '';

  return (
    <div className={cn(
      "glow-border rounded-2xl",
      colorClass,
      intensityClass,
      speedClass,
      thickClass,
      className
    )}>
      {children}
    </div>
  );
}
