"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Subtle pulse skeleton - uses CSS animation with staggered delays
function Skeleton({
  className,
  delay = 0
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        "bg-muted/60 rounded-md animate-pulse",
        className
      )}
      style={{
        animationDelay: `${delay}ms`,
        animationDuration: '2s'
      }}
    />
  );
}

// Group skeletons with staggered delays for visual variety
function SkeletonGroup({
  children,
  baseDelay = 0,
  stagger = 100
}: {
  children: React.ReactNode;
  baseDelay?: number;
  stagger?: number;
}) {
  return <>{children}</>;
}

export function WalletProfileSkeleton() {
  return (
    <div className="space-y-4">
      {/* Hero Section: Profile Card + PnL Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile Card Skeleton */}
        <Card className="p-6 border-border/50">
          <div className="flex items-start gap-4">
            {/* Avatar - no delay, loads first */}
            <Skeleton className="w-16 h-16 rounded-full flex-shrink-0" delay={0} />

            <div className="flex-1 space-y-3">
              {/* Username */}
              <Skeleton className="h-6 w-32" delay={50} />
              {/* Address */}
              <Skeleton className="h-4 w-48" delay={100} />
              {/* Bio */}
              <Skeleton className="h-4 w-full" delay={150} />
            </div>

            {/* Tier badge */}
            <Skeleton className="h-8 w-20 rounded-full" delay={200} />
          </div>

          {/* Stats grid - staggered */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-border/50">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16" delay={300 + i * 50} />
                <Skeleton className="h-6 w-12" delay={350 + i * 50} />
              </div>
            ))}
          </div>
        </Card>

        {/* PnL Chart Card Skeleton - slightly delayed from profile */}
        <Card className="p-6 border-border/50">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-5 w-32" delay={100} />
            <Skeleton className="h-8 w-24 rounded-md" delay={150} />
          </div>

          {/* PnL values - cascading delays */}
          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" delay={200} />
              <Skeleton className="h-6 w-28" delay={250} />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" delay={300} />
              <Skeleton className="h-5 w-24" delay={350} />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" delay={400} />
              <Skeleton className="h-5 w-20" delay={450} />
            </div>
          </div>

          {/* Chart area */}
          <Skeleton className="h-32 w-full rounded-lg" delay={500} />
        </Card>
      </div>

      {/* Stats Row Skeleton - wave pattern */}
      <Card className="p-0 border-border/50 overflow-hidden">
        <div className="grid grid-cols-5 divide-x divide-border/50">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" delay={600 + i * 80} />
                <Skeleton className="h-3 w-16" delay={650 + i * 80} />
              </div>
              <Skeleton className="h-6 w-12" delay={700 + i * 80} />
              <Skeleton className="h-3 w-20" delay={750 + i * 80} />
            </div>
          ))}
        </div>
        {/* CLV row */}
        <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4">
          <Skeleton className="h-4 w-28" delay={1100} />
          <Skeleton className="h-4 w-48" delay={1150} />
        </div>
      </Card>

      {/* Content Tabs Skeleton - appears last */}
      <Card className="border-border/50 overflow-hidden">
        {/* Tabs header */}
        <div className="flex gap-4 px-4 py-3 border-b border-border/50">
          <Skeleton className="h-4 w-20" delay={800} />
          <Skeleton className="h-4 w-20" delay={850} />
          <Skeleton className="h-4 w-20" delay={900} />
        </div>

        {/* Tab content - Overview style */}
        <div className="p-6 space-y-6">
          {/* Score cards row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Credibility Score skeleton */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-36" delay={950} />
                <Skeleton className="h-4 w-4 rounded-full" delay={1000} />
              </div>

              <div className="flex flex-col items-center py-4">
                {/* Circular gauge - simple circle, no shimmer */}
                <div
                  className="h-36 w-36 rounded-full border-8 border-muted/40 animate-pulse"
                  style={{ animationDelay: '1050ms', animationDuration: '2.5s' }}
                />

                {/* Secondary scores */}
                <div className="flex gap-6 mt-4">
                  <div className="text-center space-y-1">
                    <Skeleton className="h-3 w-12 mx-auto" delay={1100} />
                    <Skeleton className="h-5 w-8 mx-auto" delay={1150} />
                  </div>
                  <div className="text-center space-y-1">
                    <Skeleton className="h-3 w-16 mx-auto" delay={1200} />
                    <Skeleton className="h-5 w-8 mx-auto" delay={1250} />
                  </div>
                </div>
              </div>

              {/* Component bars - wave effect */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-20" delay={1300 + i * 60} />
                      <Skeleton className="h-3 w-8" delay={1330 + i * 60} />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" delay={1360 + i * 60} />
                  </div>
                ))}
              </div>
            </Card>

            {/* Trader Profile skeleton */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-40" delay={1000} />
                <div className="flex gap-1">
                  <Skeleton className="h-8 w-8 rounded" delay={1050} />
                  <Skeleton className="h-8 w-8 rounded" delay={1100} />
                  <Skeleton className="h-8 w-8 rounded" delay={1150} />
                </div>
              </div>

              {/* Radar chart placeholder - larger, slower pulse */}
              <div className="flex items-center justify-center py-8">
                <div
                  className="h-48 w-48 rounded-full border-8 border-muted/30 animate-pulse"
                  style={{ animationDelay: '1200ms', animationDuration: '3s' }}
                />
              </div>

              {/* Score */}
              <div className="flex justify-center">
                <Skeleton className="h-10 w-32 rounded-full" delay={1400} />
              </div>
            </Card>
          </div>
        </div>
      </Card>
    </div>
  );
}
