"use client";

import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";

// Animated skeleton component with shimmer effect
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden bg-muted/50 rounded-md ${className}`}
    >
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent"
        animate={{ translateX: ["-100%", "100%"] }}
        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
      />
    </div>
  );
}

export function WalletProfileSkeleton() {
  return (
    <div className="space-y-4">
      {/* Hero Section: Profile Card + PnL Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profile Card Skeleton */}
        <Card className="p-6 border-border/50">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <Skeleton className="w-16 h-16 rounded-full flex-shrink-0" />

            <div className="flex-1 space-y-3">
              {/* Username */}
              <Skeleton className="h-6 w-32" />
              {/* Address */}
              <Skeleton className="h-4 w-48" />
              {/* Bio */}
              <Skeleton className="h-4 w-full" />
            </div>

            {/* Tier badge */}
            <Skeleton className="h-8 w-20 rounded-full" />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-border/50">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
        </Card>

        {/* PnL Chart Card Skeleton */}
        <Card className="p-6 border-border/50">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>

          {/* PnL values */}
          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-28" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-20" />
            </div>
          </div>

          {/* Chart area */}
          <Skeleton className="h-32 w-full rounded-lg" />
        </Card>
      </div>

      {/* Stats Row Skeleton */}
      <Card className="p-0 border-border/50 overflow-hidden">
        <div className="grid grid-cols-5 divide-x divide-border/50">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-6 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        {/* CLV row */}
        <div className="border-t border-border/50 px-4 py-2 flex items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>
      </Card>

      {/* Content Tabs Skeleton */}
      <Card className="border-border/50 overflow-hidden">
        {/* Tabs header */}
        <div className="flex gap-4 px-4 py-3 border-b border-border/50">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>

        {/* Tab content - Overview style */}
        <div className="p-6 space-y-6">
          {/* Score cards row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Credibility Score skeleton */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </div>

              <div className="flex flex-col items-center py-4">
                {/* Circular gauge */}
                <Skeleton className="h-36 w-36 rounded-full" />

                {/* Secondary scores */}
                <div className="flex gap-6 mt-4">
                  <div className="text-center space-y-1">
                    <Skeleton className="h-3 w-12 mx-auto" />
                    <Skeleton className="h-5 w-8 mx-auto" />
                  </div>
                  <div className="text-center space-y-1">
                    <Skeleton className="h-3 w-16 mx-auto" />
                    <Skeleton className="h-5 w-8 mx-auto" />
                  </div>
                </div>
              </div>

              {/* Component bars */}
              <div className="space-y-3 pt-4 border-t border-border/50">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </Card>

            {/* Performance Profile skeleton */}
            <Card className="p-6 border-border/50">
              <div className="flex items-center justify-between mb-4">
                <Skeleton className="h-5 w-40" />
                <div className="flex gap-1">
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-8 w-8 rounded" />
                  <Skeleton className="h-8 w-8 rounded" />
                </div>
              </div>

              {/* Radar chart placeholder */}
              <div className="flex items-center justify-center py-8">
                <Skeleton className="h-64 w-64 rounded-full" />
              </div>

              {/* Score */}
              <div className="flex justify-center">
                <Skeleton className="h-10 w-32 rounded-full" />
              </div>
            </Card>
          </div>

          {/* Trading Activity skeleton */}
          <Card className="p-5 border-border/50">
            <div className="flex items-center gap-3 mb-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-1">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>

            <div className="flex gap-6">
              {/* Bubble chart area */}
              <Skeleton className="flex-1 h-72 rounded-xl" />

              {/* Category breakdown */}
              <div className="w-64 space-y-3">
                <Skeleton className="h-4 w-36" />
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-between">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                    <Skeleton className="h-1 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );
}
