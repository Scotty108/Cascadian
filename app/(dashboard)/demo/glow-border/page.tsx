"use client";

import { Card } from "@/components/ui/card";
import { GlowBorder } from "@/components/ui/glow-border";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function GlowBorderDemo() {
  return (
    <Card className="shadow-sm rounded-2xl overflow-hidden border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Glow Border Effect</h1>
        <p className="text-sm text-muted-foreground">
          Apple Intelligence-inspired animated gradient borders with matching glow effects
        </p>
      </div>

      <div className="px-6 py-6 space-y-8">
        {/* Color Variants */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Color Variants</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Default (Cyan) */}
            <GlowBorder>
              <Card className="p-6">
                <Badge className="mb-3">Default (Cyan)</Badge>
                <h3 className="text-lg font-semibold mb-2">Primary Accent</h3>
                <p className="text-sm text-muted-foreground">
                  Use for primary actions and important features
                </p>
              </Card>
            </GlowBorder>

            {/* Purple */}
            <GlowBorder color="purple">
              <Card className="p-6">
                <Badge variant="secondary" className="mb-3">Purple</Badge>
                <h3 className="text-lg font-semibold mb-2">Premium Features</h3>
                <p className="text-sm text-muted-foreground">
                  Perfect for premium or AI-powered features
                </p>
              </Card>
            </GlowBorder>

            {/* Blue */}
            <GlowBorder color="blue">
              <Card className="p-6">
                <Badge variant="secondary" className="mb-3">Blue</Badge>
                <h3 className="text-lg font-semibold mb-2">Information</h3>
                <p className="text-sm text-muted-foreground">
                  Ideal for informational or data-driven content
                </p>
              </Card>
            </GlowBorder>

            {/* Emerald */}
            <GlowBorder color="emerald">
              <Card className="p-6">
                <Badge variant="secondary" className="mb-3">Emerald</Badge>
                <h3 className="text-lg font-semibold mb-2">Positive Metrics</h3>
                <p className="text-sm text-muted-foreground">
                  Great for success states and positive performance
                </p>
              </Card>
            </GlowBorder>
          </div>
        </div>

        {/* Intensity Variants */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Intensity Levels</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <GlowBorder intensity="subtle" color="purple">
              <Card className="p-6">
                <Badge className="mb-2">Subtle</Badge>
                <p className="text-sm text-muted-foreground">Gentle, understated glow</p>
              </Card>
            </GlowBorder>

            <GlowBorder intensity="medium" color="purple">
              <Card className="p-6">
                <Badge className="mb-2">Medium</Badge>
                <p className="text-sm text-muted-foreground">Balanced, noticeable glow</p>
              </Card>
            </GlowBorder>

            <GlowBorder intensity="strong" color="purple">
              <Card className="p-6">
                <Badge className="mb-2">Strong</Badge>
                <p className="text-sm text-muted-foreground">Bold, prominent glow</p>
              </Card>
            </GlowBorder>
          </div>
        </div>

        {/* Speed Variants */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Animation Speed</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <GlowBorder speed="slow" color="blue">
              <Card className="p-6">
                <Badge className="mb-2">Slow (12s)</Badge>
                <p className="text-sm text-muted-foreground">Calm, meditative rotation</p>
              </Card>
            </GlowBorder>

            <GlowBorder speed="medium" color="blue">
              <Card className="p-6">
                <Badge className="mb-2">Medium (8s)</Badge>
                <p className="text-sm text-muted-foreground">Standard rotation speed</p>
              </Card>
            </GlowBorder>

            <GlowBorder speed="fast" color="blue">
              <Card className="p-6">
                <Badge className="mb-2">Fast (4s)</Badge>
                <p className="text-sm text-muted-foreground">Dynamic, energetic rotation</p>
              </Card>
            </GlowBorder>
          </div>
        </div>

        {/* Border Thickness */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Border Thickness</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <GlowBorder color="emerald">
              <Card className="p-6">
                <Badge className="mb-2">Standard</Badge>
                <p className="text-sm text-muted-foreground">Default 2px border width</p>
              </Card>
            </GlowBorder>

            <GlowBorder color="emerald" thick>
              <Card className="p-6">
                <Badge className="mb-2">Thick</Badge>
                <p className="text-sm text-muted-foreground">Bold 4px border width</p>
              </Card>
            </GlowBorder>
          </div>
        </div>

        {/* Real-World Examples */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Real-World Examples</h2>
          <div className="space-y-6">
            {/* Live Signal Card */}
            <GlowBorder color="purple" intensity="strong" speed="fast">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-semibold">Live TSI Signal</h3>
                  <Badge className="bg-purple-500 text-white animate-pulse">LIVE</Badge>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Signal</p>
                    <p className="text-lg font-bold text-green-500">BULLISH</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Conviction</p>
                    <p className="text-lg font-bold">94.3%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">TSI</p>
                    <p className="text-lg font-bold">+12.4</p>
                  </div>
                </div>
              </Card>
            </GlowBorder>

            {/* Premium Metric Card */}
            <GlowBorder color="emerald" intensity="medium">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Omega Ratio</h3>
                  <Badge className="bg-emerald-500 text-white">S Grade</Badge>
                </div>
                <p className="text-3xl font-bold text-emerald-500 mb-2">3.42</p>
                <p className="text-sm text-muted-foreground">
                  Top 1% of all traders - Superior risk-adjusted returns
                </p>
              </Card>
            </GlowBorder>

            {/* Action Button */}
            <div className="flex gap-4">
              <GlowBorder speed="slow" className="flex-1">
                <Button className="w-full h-14 text-lg bg-[#00E0AA] hover:bg-[#00E0AA]/90 text-black">
                  Connect Wallet
                </Button>
              </GlowBorder>

              <GlowBorder color="purple" speed="slow" className="flex-1">
                <Button className="w-full h-14 text-lg bg-purple-600 hover:bg-purple-700">
                  Upgrade to Pro
                </Button>
              </GlowBorder>
            </div>
          </div>
        </div>

        {/* Usage Instructions */}
        <div className="p-6 bg-muted/50 rounded-lg">
          <h3 className="font-semibold mb-3">Usage</h3>
          <pre className="bg-background p-4 rounded-md overflow-x-auto text-xs">
{`import { GlowBorder } from "@/components/ui/glow-border";

// Basic usage
<GlowBorder>
  <Card>Your content</Card>
</GlowBorder>

// With options
<GlowBorder
  color="purple"
  intensity="strong"
  speed="fast"
  thick
>
  <Card>Premium feature</Card>
</GlowBorder>

// Or use CSS classes directly
<div className="glow-border glow-border-purple glow-border-strong">
  Your content
</div>`}
          </pre>

          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p><strong>Color options:</strong> default (cyan), purple, blue, emerald</p>
            <p><strong>Intensity:</strong> subtle, medium, strong</p>
            <p><strong>Speed:</strong> slow (12s), medium (8s), fast (4s)</p>
            <p><strong>Progressive Enhancement:</strong> Falls back to static gradient in older browsers</p>
          </div>
        </div>
      </div>
    </Card>
  );
}
