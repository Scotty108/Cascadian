"use client";

import { useState, useRef, useEffect } from "react";
import { HeroTitle } from "./hero-title";
import { ProbabilityChartLarge } from "./probability-chart-large";
import { ScoreComparisonCard } from "./score-comparison-card";
import { UnifiedAnalysisCard } from "./unified-analysis-card";
import { DeepResearchCopilot } from "./deep-research-copilot";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

// Height of the chart area only (not including title)
// Charts are 360px + gap/padding ≈ 376px
const CHART_AREA_HEIGHT = 376;

// Scroll smoothing factor (0.5 = smoother but slower, 1.0 = direct)
const SCROLL_SMOOTHING = 0.6;

/**
 * Pitch Deck Dashboard - Two-Phase Scroll System
 *
 * Phase 1: Card position controlled by JS (scrolls up to cover charts)
 * Phase 2: Card internal content scrolls natively
 *
 * Key insight: Title stays fixed and visible. Card covers only the charts.
 */
export function PitchDeckDashboard() {
  const [isCopilotOpen, setIsCopilotOpen] = useState(true);
  // Card offset from top of chart area (starts at CHART_AREA_HEIGHT, goes to 0)
  const [cardOffset, setCardOffset] = useState(CHART_AREA_HEIGHT);
  const innerScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Use ref to track cardOffset in event listener to avoid stale closure
  const cardOffsetRef = useRef(cardOffset);
  cardOffsetRef.current = cardOffset;

  // For smooth animation using requestAnimationFrame
  const targetOffsetRef = useRef(CHART_AREA_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const isAnimatingRef = useRef(false);

  // Calculate fade based on card position
  const scrollProgress = 1 - cardOffset / CHART_AREA_HEIGHT;

  // Start animation loop only when needed
  const startAnimation = () => {
    if (isAnimatingRef.current) return;
    isAnimatingRef.current = true;

    const animate = () => {
      const current = cardOffsetRef.current;
      const target = targetOffsetRef.current;
      const diff = target - current;

      // If close enough, snap to target and STOP
      if (Math.abs(diff) < 0.5) {
        if (Math.abs(current - target) > 0.01) {
          setCardOffset(target);
        }
        // Stop animation loop when done
        isAnimatingRef.current = false;
        animationRef.current = null;
        return;
      }

      // Smooth interpolation
      const newOffset = current + diff * 0.15;
      setCardOffset(newOffset);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Add non-passive wheel listener to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const inner = innerScrollRef.current;
      if (!inner) return;

      const delta = e.deltaY * SCROLL_SMOOTHING;
      const innerScrollTop = inner.scrollTop;
      const currentTarget = targetOffsetRef.current;
      const currentActual = cardOffsetRef.current;

      // Card is "at top" only when both target AND actual position are at 0
      const cardIsAtTop = currentTarget === 0 && currentActual < 1;

      // Scrolling DOWN (delta > 0)
      if (delta > 0) {
        // Phase 1: Card hasn't fully reached top yet - move card up
        // Block inner scroll until card is completely at top
        if (!cardIsAtTop) {
          e.preventDefault();
          e.stopPropagation();
          targetOffsetRef.current = Math.max(0, currentTarget - delta);
          startAnimation();
        }
        // Phase 2: Card is fully at top - let inner scroll naturally
        // (no preventDefault, native scroll handles it)
      }
      // Scrolling UP (delta < 0)
      else {
        // If inner content is scrolled down, let it scroll up naturally
        if (innerScrollTop > 0) {
          // Native scroll handles it
        }
        // Inner is at top - move card down (Phase 1 reverse)
        else {
          e.preventDefault();
          e.stopPropagation();
          targetOffsetRef.current = Math.min(CHART_AREA_HEIGHT, currentTarget - delta);
          startAnimation();
        }
      }
    };

    // Add as non-passive to allow preventDefault
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div className="h-[calc(100vh-4rem)] p-2">
      <div className={`flex h-full overflow-hidden ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950`}>
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Title - Always visible, fixed at top */}
          <div className="flex-shrink-0 px-5 pt-3 pb-2 bg-zinc-50 dark:bg-zinc-950 z-20 relative">
            <HeroTitle />
          </div>

          {/* Chart + Card Area */}
          <div
            ref={containerRef}
            className="flex-1 relative overflow-hidden"
          >
            {/* Chart Layer - Fixed behind, fades as card covers it */}
            <div
              className="absolute inset-0 z-0 px-5"
              style={{ opacity: 1 - scrollProgress * 0.7 }}
            >
              <div className="flex gap-4">
                {/* Chart Area */}
                <div className="flex-1 min-w-0 h-[360px]">
                  <ProbabilityChartLarge />
                </div>
                {/* Score Comparison */}
                <div className="w-72 flex-shrink-0 h-[360px]">
                  <ScoreComparisonCard />
                </div>
              </div>
            </div>

            {/* Card - Positioned by JS with GPU-accelerated transform */}
            <div
              className="absolute left-0 right-0 z-10 bg-zinc-50 dark:bg-zinc-950 px-5"
              style={{
                top: 0,
                bottom: -CHART_AREA_HEIGHT,
                transform: `translateY(${cardOffset}px)`,
                willChange: 'transform',
              }}
            >
              {/* UnifiedAnalysisCard handles its own internal scroll, we pass ref to monitor it */}
              <UnifiedAnalysisCard scrollRef={innerScrollRef} />
            </div>
          </div>
        </div>

        {/* Deep Research Copilot Sidebar */}
        <DeepResearchCopilot
          isOpen={isCopilotOpen}
          onToggle={() => setIsCopilotOpen(!isCopilotOpen)}
          eventTitle="Fed Rate Cut December 2025"
          marketQuestion="Will the Federal Reserve cut interest rates at the December 2025 FOMC meeting?"
          category="Macro / FOMC"
        />
      </div>
    </div>
  );
}
