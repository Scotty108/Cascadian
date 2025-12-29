"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  FileText,
  ExternalLink,
  GitBranch,
  Wallet,
  Lightbulb,
  TrendingUp,
  Users,
  BarChart3,
  Building2,
  Briefcase,
  User,
  Clock,
  Expand,
  Minimize2,
  MoreVertical,
  Link2,
  PieChart,
  X,
} from "lucide-react";

// ============================================
// TOGGLE: Change to "rounded" to revert back
// ============================================
const CORNER_STYLE: "rounded" | "sharp" = "sharp";

type SectionKey = "analysis" | "smart-money" | "recommendations" | "correlated" | "statistics";

const sections: { key: SectionKey; label: string; icon: React.ReactNode }[] = [
  { key: "analysis", label: "Market Analysis", icon: <FileText className="w-3.5 h-3.5" /> },
  { key: "smart-money", label: "Smart Money", icon: <Wallet className="w-3.5 h-3.5" /> },
  { key: "recommendations", label: "Recommendations", icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { key: "correlated", label: "Correlated Events", icon: <Link2 className="w-3.5 h-3.5" /> },
  { key: "statistics", label: "Statistical Analysis", icon: <PieChart className="w-3.5 h-3.5" /> },
];

/**
 * Unified Analysis Card - Continuous Scroll
 * All sections stacked in one scrollable container
 * Navigation buttons scroll to sections (not tabs)
 */
interface UnifiedAnalysisCardProps {
  scrollRef?: React.RefObject<HTMLDivElement | null>;
}

export function UnifiedAnalysisCard({ scrollRef }: UnifiedAnalysisCardProps) {
  // Active section for scroll spy
  const [activeSection, setActiveSection] = useState<SectionKey>("analysis");
  // Expanded fullscreen mode
  const [isExpanded, setIsExpanded] = useState(false);
  // Internal scroll ref for expanded mode
  const expandedScrollRef = useRef<HTMLDivElement>(null);
  // Portal container for SSR safety
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  // Separate refs for expanded modal sections
  const expandedSectionRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({
    analysis: null,
    "smart-money": null,
    recommendations: null,
    correlated: null,
    statistics: null,
  });

  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  // Refs for each section
  const sectionRefs = useRef<Record<SectionKey, HTMLDivElement | null>>({
    analysis: null,
    "smart-money": null,
    recommendations: null,
    correlated: null,
    statistics: null,
  });

  // Scroll spy - detect which section is in view
  useEffect(() => {
    const scrollContainer = scrollRef?.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const containerTop = containerRect.top;

      // Find the section closest to the top of the viewport
      let closestSection: SectionKey = "analysis";
      let closestDistance = Infinity;

      (Object.keys(sectionRefs.current) as SectionKey[]).forEach((key) => {
        const sectionEl = sectionRefs.current[key];
        if (sectionEl) {
          const sectionRect = sectionEl.getBoundingClientRect();
          // Distance from section top to container top
          const distance = Math.abs(sectionRect.top - containerTop);

          // Consider a section "active" if it's at or above the top of the container
          // with some tolerance (within 100px)
          if (sectionRect.top <= containerTop + 100 && distance < closestDistance) {
            closestDistance = distance;
            closestSection = key;
          }
        }
      });

      // If we're at the very top, default to "analysis"
      if (scrollContainer.scrollTop < 50) {
        closestSection = "analysis";
      }

      setActiveSection(closestSection);
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    // Initial check
    handleScroll();

    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [scrollRef]);

  // Scroll spy for EXPANDED modal
  useEffect(() => {
    if (!isExpanded) return;

    const scrollContainer = expandedScrollRef.current;
    if (!scrollContainer) return;

    const handleExpandedScroll = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      const containerTop = containerRect.top;

      let closestSection: SectionKey = "analysis";
      let closestDistance = Infinity;

      (Object.keys(expandedSectionRefs.current) as SectionKey[]).forEach((key) => {
        const sectionEl = expandedSectionRefs.current[key];
        if (sectionEl) {
          const sectionRect = sectionEl.getBoundingClientRect();
          const distance = Math.abs(sectionRect.top - containerTop);

          if (sectionRect.top <= containerTop + 100 && distance < closestDistance) {
            closestDistance = distance;
            closestSection = key;
          }
        }
      });

      if (scrollContainer.scrollTop < 50) {
        closestSection = "analysis";
      }

      setActiveSection(closestSection);
    };

    scrollContainer.addEventListener("scroll", handleExpandedScroll, { passive: true });
    // Initial check
    handleExpandedScroll();

    return () => scrollContainer.removeEventListener("scroll", handleExpandedScroll);
  }, [isExpanded]);

  // Handle escape key to close expanded mode
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isExpanded]);

  // Prevent body scroll when expanded
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  // Scroll to section when nav button clicked
  const scrollToSection = (key: SectionKey) => {
    const sectionEl = sectionRefs.current[key];
    const scrollContainer = scrollRef?.current;

    if (sectionEl && scrollContainer) {
      const containerTop = scrollContainer.getBoundingClientRect().top;
      const sectionTop = sectionEl.getBoundingClientRect().top;
      const offset = sectionTop - containerTop + scrollContainer.scrollTop;

      scrollContainer.scrollTo({
        top: offset,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 ${CORNER_STYLE === "rounded" ? "rounded-t-xl" : "rounded-t-lg"} rounded-b-none flex flex-col h-full`}>
      {/* Section Navigation - Scroll to anchors */}
      <div className="flex items-center justify-between px-5 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
        <div className="flex items-center">
          {sections.map((section) => {
            const isActive = activeSection === section.key;
            return (
              <button
                key={section.key}
                onClick={() => scrollToSection(section.key)}
                className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 rounded-t-md ${
                  isActive
                    ? "text-cyan-600 dark:text-cyan-400"
                    : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <span className={isActive ? "text-cyan-500" : ""}>{section.icon}</span>
                {section.label}
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-cyan-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
            title="Expand to fullscreen"
          >
            <Expand className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fullscreen Expanded Modal - Rendered via Portal to escape transform context */}
      {portalContainer && isExpanded && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className={`bg-white dark:bg-zinc-900 ${CORNER_STYLE === "rounded" ? "rounded-2xl" : "rounded-xl"} w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl border border-zinc-200 dark:border-zinc-700`}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-cyan-500" />
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Research Report</span>
                <span className="text-xs px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded">Fed Rate Cut December 2025</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  title="Minimize (Esc)"
                >
                  <Minimize2 className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsExpanded(false)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  title="Close (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Navigation */}
            <div className="flex items-center px-6 border-b border-zinc-200 dark:border-zinc-800 flex-shrink-0">
              {sections.map((section) => {
                const isActive = activeSection === section.key;
                return (
                  <button
                    key={section.key}
                    onClick={() => {
                      const sectionEl = expandedSectionRefs.current[section.key];
                      const scrollContainer = expandedScrollRef.current;
                      if (sectionEl && scrollContainer) {
                        const containerTop = scrollContainer.getBoundingClientRect().top;
                        const sectionTop = sectionEl.getBoundingClientRect().top;
                        const offset = sectionTop - containerTop + scrollContainer.scrollTop;
                        scrollContainer.scrollTo({ top: offset, behavior: "smooth" });
                      }
                    }}
                    className={`relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 rounded-t-md ${
                      isActive
                        ? "text-cyan-600 dark:text-cyan-400"
                        : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    }`}
                  >
                    <span className={isActive ? "text-cyan-500" : ""}>{section.icon}</span>
                    {section.label}
                    {isActive && (
                      <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-cyan-500 rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Modal Content */}
            <div ref={expandedScrollRef} className="flex-1 overflow-auto p-6 pb-[50vh]">
              {/* Section: Market Analysis */}
              <div ref={(el) => { expandedSectionRefs.current.analysis = el; }}>
                <MarketAnalysisContent />
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

              <div ref={(el) => { expandedSectionRefs.current["smart-money"] = el; }}>
                <SectionHeader icon={<Wallet className="w-4 h-4" />} title="Smart Money Signal" />
                <SmartMoneyContent />
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

              <div ref={(el) => { expandedSectionRefs.current.recommendations = el; }}>
                <SectionHeader icon={<Lightbulb className="w-4 h-4" />} title="Strategic Recommendations" />
                <RecommendationsContent />
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

              <div ref={(el) => { expandedSectionRefs.current.correlated = el; }}>
                <SectionHeader icon={<Link2 className="w-4 h-4" />} title="Correlated Events" />
                <CorrelatedEventsContent />
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

              <div ref={(el) => { expandedSectionRefs.current.statistics = el; }}>
                <SectionHeader icon={<PieChart className="w-4 h-4" />} title="Statistical Analysis" />
                <StatisticalAnalysisContent />
              </div>
            </div>
          </div>
        </div>,
        portalContainer
      )}

      {/* Continuous Scroll Content - All sections stacked */}
      {/* pb-[80vh] ensures last sections can scroll to top */}
      <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-hide p-5 pb-[80vh]">
        {/* Section: Market Analysis */}
        <div ref={(el) => { sectionRefs.current.analysis = el; }}>
          <MarketAnalysisContent />
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

        {/* Section: Smart Money */}
        <div ref={(el) => { sectionRefs.current["smart-money"] = el; }}>
          <SectionHeader icon={<Wallet className="w-4 h-4" />} title="Smart Money Signal" />
          <SmartMoneyContent />
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

        {/* Section: Recommendations */}
        <div ref={(el) => { sectionRefs.current.recommendations = el; }}>
          <SectionHeader icon={<Lightbulb className="w-4 h-4" />} title="Strategic Recommendations" />
          <RecommendationsContent />
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

        {/* Section: Correlated Events */}
        <div ref={(el) => { sectionRefs.current.correlated = el; }}>
          <SectionHeader icon={<Link2 className="w-4 h-4" />} title="Correlated Events" />
          <CorrelatedEventsContent />
        </div>

        {/* Divider */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 my-8" />

        {/* Section: Statistical Analysis */}
        <div ref={(el) => { sectionRefs.current.statistics = el; }}>
          <SectionHeader icon={<PieChart className="w-4 h-4" />} title="Statistical Analysis" />
          <StatisticalAnalysisContent />
        </div>
      </div>
    </div>
  );
}

// Section header component for consistency
function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-cyan-500">{icon}</span>
      <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
    </div>
  );
}

function MarketAnalysisContent() {
  return (
    <div className="flex gap-5">
      {/* Main Content */}
      <div className="flex-1 space-y-4">
        {/* Header */}
        <div>
          <div className="text-xs font-semibold">Research Report</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">
            Updated 2h ago · 23 sources
          </div>
        </div>

        {/* Executive Summary */}
        <div className="border-l-2 border-foreground/20 pl-3">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Executive Summary</div>
          <p className="text-sm text-foreground leading-relaxed">
            The Federal Reserve is widely expected to cut rates at the December 2025 FOMC meeting.
            Our analysis of <span className="underline decoration-cyan-500 cursor-pointer">23 Fed communications</span> reveals
            a clear dovish pivot, with 9 of 12 FOMC members signaling support for rate reduction.
            We assess a <span className="font-semibold">94% probability</span> of a 25bps cut, representing a
            7-point edge over current market pricing.
          </p>
        </div>

        {/* Main Analysis Sections */}
        <div className="space-y-5 text-sm leading-relaxed">
        {/* Fed Communications Analysis */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Federal Reserve Communications Analysis</div>
          <p className="text-muted-foreground mb-2">
            Key signals driving our <span className="font-medium text-foreground">94% confidence score</span> include
            Powell&apos;s <span className="underline decoration-cyan-500 cursor-pointer">November 15 speech</span> explicitly
            mentioning &quot;easing inflation concerns&quot; and &quot;room for policy adjustment.&quot; The November
            FOMC minutes revealed growing consensus around the need for &quot;recalibration&quot; of policy stance.
          </p>
          <p className="text-muted-foreground">
            Governor Waller&apos;s December 2 remarks at the Peterson Institute were particularly notable,
            stating the Fed is &quot;well-positioned to respond to economic conditions&quot; and emphasizing
            that &quot;the labor market is no longer a source of inflationary pressure.&quot; This represents
            a significant shift from the hawkish tone maintained through Q3 2025.
          </p>
        </div>

        {/* Inflation Data */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Inflation Trajectory</div>
          <p className="text-muted-foreground mb-2">
            Core PCE has trended below 2.5% for three consecutive months (<span className="underline decoration-cyan-500 cursor-pointer">BLS data</span>).
            The November reading of 2.3% YoY represents the lowest level since March 2021 and is now
            within striking distance of the Fed&apos;s 2% target. Shelter inflation, which had been
            the primary sticking point, has finally begun to moderate with the October reading showing
            the first sub-5% print in 18 months.
          </p>
          <p className="text-muted-foreground">
            Our proprietary inflation nowcast, which incorporates real-time rental data and supply chain
            metrics, projects Core PCE to reach 2.1% by Q1 2026—ahead of Fed projections and supportive
            of continued easing into the new year.
          </p>
        </div>

        {/* Labor Market */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Labor Market Assessment</div>
          <p className="text-muted-foreground">
            The labor market shows controlled cooling without recession triggers. November payrolls
            came in at +156K (vs +180K expected), continuing the gradual normalization trend. The
            unemployment rate held steady at 4.2%, while wage growth moderated to 3.8% YoY—down from
            the 4.5% peak in January. Job openings have declined to 8.7M from the 12M peak, bringing
            the vacancies-to-unemployed ratio back to pre-pandemic levels of 1.1x.
          </p>
        </div>

        {/* Market Pricing */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Cross-Market Analysis</div>
          <p className="text-muted-foreground">
            Cross-referencing with <span className="underline decoration-cyan-500 cursor-pointer">CME FedWatch</span> (89%),
            <span className="underline decoration-cyan-500 cursor-pointer"> Kalshi</span> (84%), and internal smart money
            tracking (82% YES), we identify a <span className="font-medium text-foreground">7-point mispricing gap</span> between
            current Polymarket pricing (87%) and our AI projection (94%). Fed funds futures are pricing
            in 22bps of cuts for December, consistent with near-certainty of a 25bp move.
          </p>
        </div>

        {/* Historical Context */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Historical Pattern Analysis</div>
          <p className="text-muted-foreground">
            Historical analysis of similar setups (dovish Fed communications + cooling PCE + stable employment) shows
            <span className="font-medium text-foreground"> 91% accuracy</span> in predicting rate cuts over the past
            8 FOMC cycles (<span className="underline decoration-cyan-500 cursor-pointer">methodology</span>). The current setup bears
            strong resemblance to December 2018 and July 2019 pivots, both of which resulted in extended
            easing cycles. Our machine learning model, trained on 40 years of FOMC decisions, assigns
            the highest conviction score (0.94) we&apos;ve seen since the model&apos;s deployment in 2023.
          </p>
        </div>

        {/* Risk Factors */}
        <div>
          <div className="text-xs font-semibold text-foreground mb-2">Risk Factors</div>
          <p className="text-muted-foreground">
            Primary risks to this view include: (1) an upside surprise in the December 11 CPI print,
            (2) hawkish dissents from regional Fed presidents Kashkari or Mester, or (3) geopolitical
            shock triggering flight-to-safety USD strength. We assess combined probability of these
            scenarios at approximately 6%, supporting our 94% base case.
          </p>
        </div>
        </div>

        {/* Key Data Points */}
        <div className="border-t border-border pt-4">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-3">
            Key Data Points
          </div>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Core PCE (Nov)</span>
              <span className="font-mono">2.3%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Unemployment</span>
              <span className="font-mono">4.2%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Fed Dot Plot</span>
              <span className="font-mono">4.25%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">CME FedWatch</span>
              <span className="font-mono">89%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">FOMC Sentiment</span>
              <span className="font-mono">9/12 dovish</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Smart Money</span>
              <span className="font-mono">82% YES</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Wage Growth</span>
              <span className="font-mono">3.8%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Job Openings</span>
              <span className="font-mono">8.7M</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Model Confidence</span>
              <span className="font-mono">0.94</span>
            </div>
          </div>
        </div>

        {/* Sources */}
        <div className="border-t border-border pt-3">
          <div className="text-[9px] text-muted-foreground uppercase tracking-wide mb-2">Sources & References</div>
          <div className="flex flex-wrap gap-2 text-[9px]">
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />Fed Minutes (Nov)
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />Powell Speech (Nov 15)
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />Waller Remarks (Dec 2)
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />BLS Employment
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />PCE Index
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />CME FedWatch
            </span>
            <span className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-0.5">
              <ExternalLink className="w-2.5 h-2.5" />JOLTS Report
            </span>
            <span className="text-muted-foreground">+16 more</span>
          </div>
        </div>
      </div>

      {/* Right Column - Effects + Modules */}
      <div className="w-[390px] flex-shrink-0 space-y-3">
        {/* Knock-On Effects Card - More Informative */}
        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 bg-gradient-to-br from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900`}>
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-cyan-500" />
              <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Domino Effects</span>
            </div>
            <span className={`text-[10px] px-2 py-0.5 bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 ${CORNER_STYLE === "rounded" ? "rounded-full" : "rounded"} font-medium`}>If YES resolves</span>
          </div>

          {/* Intro blurb */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3 leading-relaxed">
            A Fed rate cut triggers a cascade of interconnected market effects. Here&apos;s how the dominoes fall:
          </p>

          {/* Effect Chain - Compact border-left style with research buttons */}
          <div className="space-y-2.5">
            {/* Effect 1 */}
            <div className="border-l-2 border-cyan-400 pl-3 py-1">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Lending Rates Fall</div>
                <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors" title="Deep research">
                  <ExternalLink className="w-3 h-3 text-zinc-400" />
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5">
                Mortgage rates drop → Housing liquidity +15-20%
              </p>
            </div>

            {/* Effect 2 */}
            <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 py-1">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Dollar Weakens</div>
                <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors" title="Deep research">
                  <ExternalLink className="w-3 h-3 text-zinc-400" />
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5">
                USD declines → EM debt relief, commodities rise
              </p>
            </div>

            {/* Effect 3 */}
            <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 py-1">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Risk Assets Rally</div>
                <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors" title="Deep research">
                  <ExternalLink className="w-3 h-3 text-zinc-400" />
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5">
                Growth stocks & crypto outperform (+12% in 30 days)
              </p>
            </div>

            {/* Effect 4 */}
            <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 py-1">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Corporate Activity</div>
                <button className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors" title="Deep research">
                  <ExternalLink className="w-3 h-3 text-zinc-400" />
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mt-0.5">
                Lower borrowing costs → M&A activity increases Q1
              </p>
            </div>
          </div>

          {/* Sector Impact */}
          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-4">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">30-Day Sector Impact</div>
            <div className="grid grid-cols-4 gap-2">
              <div className={`text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} py-2 px-1`}>
                <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">+12%</div>
                <div className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">Tech</div>
              </div>
              <div className={`text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} py-2 px-1`}>
                <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">+8%</div>
                <div className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">REITs</div>
              </div>
              <div className={`text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} py-2 px-1`}>
                <div className="text-sm font-mono font-bold text-emerald-600 dark:text-emerald-400">+5%</div>
                <div className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">Utils</div>
              </div>
              <div className={`text-center bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} py-2 px-1`}>
                <div className="text-sm font-mono font-bold text-red-500 dark:text-red-400">-3%</div>
                <div className="text-[10px] text-zinc-600 dark:text-zinc-400 font-medium">USD</div>
              </div>
            </div>
          </div>
        </div>

        {/* Key Insight Card */}
        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 bg-gradient-to-br from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900`}>
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Key Insight</span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
            7-point gap between market (87%) and AI projection (94%) suggests potential mispricing.
            Smart money has been accumulating YES positions with +$4.2M in 7-day flow.
          </p>
        </div>

        {/* Recommendations Card */}
        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"} p-4 bg-gradient-to-br from-white to-zinc-50/50 dark:from-zinc-900 dark:to-zinc-900`}>
          <div className="flex items-center gap-2 mb-3">
            <Briefcase className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recommendations</span>
          </div>
          <div className="space-y-3">
            <div className="border-l-2 border-cyan-400 pl-3">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Hedge Funds</div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Position in rate-sensitive sectors ahead of announcement</p>
            </div>
            <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Corporate Treasury</div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Delay debt issuance for better rates post-cut</p>
            </div>
            <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Individual Investors</div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Consider REITs, utilities, growth tech exposure</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SmartMoneyContent() {
  return (
    <div className="space-y-4">
      {/* Sentiment Bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wide">Overall Sentiment</span>
          <span className="text-[10px] text-cyan-500 uppercase tracking-wide font-medium">Bullish</span>
        </div>
        <div className="h-2 bg-zinc-50 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-400/70 rounded-full" style={{ width: "82%" }} />
        </div>
        <div className="flex justify-between text-xs mt-1.5">
          <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-300">82% YES</span>
          <span className="text-zinc-500 font-mono tabular-nums">18% NO</span>
        </div>
      </div>

      {/* Narrative */}
      <div className="space-y-3 text-sm">
        <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
          <span className="text-zinc-900 dark:text-zinc-100 font-medium">What smart money is doing:</span> Our top 50
          tracked wallets have accumulated $4.2M in YES positions over the past 7 days. This represents
          a 340% increase in positioning compared to the 30-day average.
        </p>

        <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Notably, wallets with &gt;90% historical accuracy are showing 89% agreement on this
          outcome. The average position size has increased to $125K, suggesting high conviction.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-2.5`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] text-zinc-500 uppercase">Top Wallets</span>
          </div>
          <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">38 / 12</div>
        </div>

        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-2.5`}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] text-zinc-500 uppercase">24h Flow</span>
          </div>
          <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">+$2.3M</div>
        </div>

        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-2.5`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Wallet className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] text-zinc-500 uppercase">Avg Size</span>
          </div>
          <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">$125K</div>
        </div>

        <div className={`border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} p-2.5`}>
          <div className="flex items-center gap-1.5 mb-1">
            <BarChart3 className="w-3 h-3 text-zinc-400" />
            <span className="text-[9px] text-zinc-500 uppercase">Accuracy</span>
          </div>
          <div className="text-xs font-mono font-semibold text-zinc-900 dark:text-zinc-100">89%</div>
        </div>
      </div>

      {/* Correlation */}
      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Insider correlation score</span>
          <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">0.87</span>
        </div>
      </div>
    </div>
  );
}

function RecommendationsContent() {
  return (
    <div className="space-y-4">
      {/* Implications by Persona */}
      <div className="space-y-4 text-sm">
        {/* Hedge Funds */}
        <div className="border-l-2 border-cyan-400 pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Briefcase className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">For Hedge Funds</span>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
            If this outcome materializes, risk assets typically rally. Consider positioning in
            rate-sensitive sectors ahead of announcement. Monitor VIX and credit spreads for sentiment shifts.
          </p>
        </div>

        {/* Corporate Treasurers */}
        <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Building2 className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">For Corporate Treasurers</span>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
            A rate cut would lower borrowing costs. Consider timing of debt issuance and
            refinancing opportunities. A 0.25% reduction on large facilities yields significant savings.
          </p>
        </div>

        {/* Individual Investors */}
        <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3">
          <div className="flex items-center gap-2 mb-1.5">
            <User className="w-3.5 h-3.5 text-zinc-400" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">For Individual Investors</span>
          </div>
          <p className="text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Lower rates typically benefit variable-rate borrowers. Rate-sensitive sectors
            (REITs, utilities, growth tech) historically outperform in easing cycles.
          </p>
        </div>
      </div>

      {/* Timing Note */}
      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <div className="flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 text-zinc-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-zinc-500">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Key Date:</span> FOMC announcement
            scheduled for December 18, 2025 at 2:00 PM ET.
          </p>
        </div>
      </div>

      {/* Prediction Summary */}
      <div className="pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-1">
              Prediction
            </div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">YES — Rate Cut</div>
          </div>
          <div className="text-right">
            <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-1">
              Target
            </div>
            <div className="text-sm font-mono font-semibold">94¢</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CorrelatedEventsContent() {
  const correlatedEvents = [
    {
      title: "Fed Rate Cut January 2026",
      odds: 72,
      correlation: "high",
      description: "Subsequent cut likely if December cut materializes",
    },
    {
      title: "S&P 500 +5% by EOY",
      odds: 68,
      correlation: "high",
      description: "Historically correlated with Fed easing cycles",
    },
    {
      title: "BTC Above $150K by Feb 2026",
      odds: 45,
      correlation: "medium",
      description: "Risk assets rally on lower rates",
    },
    {
      title: "USD/EUR Below 1.05",
      odds: 61,
      correlation: "high",
      description: "Dollar typically weakens post-cut",
    },
    {
      title: "10Y Treasury Below 4%",
      odds: 78,
      correlation: "high",
      description: "Yield curve responds to Fed policy",
    },
    {
      title: "Housing Starts +10% Q1 2026",
      odds: 54,
      correlation: "medium",
      description: "Lower mortgage rates boost construction",
    },
  ];

  const getCorrelationColor = (level: string) => {
    switch (level) {
      case "high":
        return "text-cyan-500";
      case "medium":
        return "text-zinc-500";
      default:
        return "text-zinc-400";
    }
  };

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
        Events with statistical correlation to a December Fed rate cut. Odds shown are current market
        prices, adjusted for conditional probability.
      </p>

      {/* Events List */}
      <div className="grid grid-cols-2 gap-3">
        {correlatedEvents.map((event, index) => (
          <div
            key={index}
            className={`flex items-start justify-between p-3 border border-zinc-200 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-lg" : "rounded-md"} hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-150 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-600`}
          >
            <div className="flex-1 min-w-0 mr-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {event.title}
                </span>
                <span className={`text-[9px] uppercase tracking-wide ${getCorrelationColor(event.correlation)}`}>
                  {event.correlation}
                </span>
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                {event.description}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-lg font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                {event.odds}%
              </div>
              <div className="text-[9px] text-zinc-500">YES</div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="pt-3 border-t border-zinc-200 dark:border-zinc-700">
        <p className="text-[10px] text-zinc-400">
          Correlation analysis based on historical Fed policy cycles and cross-market data.
          Not investment advice.
        </p>
      </div>
    </div>
  );
}

function StatisticalAnalysisContent() {
  return (
    <div className="space-y-4">
      {/* Placeholder */}
      <div className={`flex items-center justify-center h-64 border border-dashed border-zinc-300 dark:border-zinc-700 ${CORNER_STYLE === "rounded" ? "rounded-xl" : "rounded-lg"}`}>
        <div className="text-center">
          <PieChart className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Statistical analysis coming soon</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Monte Carlo simulations, probability distributions, confidence intervals
          </p>
        </div>
      </div>
    </div>
  );
}
