"use client";

import type React from "react";
import { createPortal } from "react-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart,
  Bell,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Cog,
  Coins,
  Cpu,
  CreditCard,
  Database,
  FileText,
  Fish,
  Gauge,
  GitCompare,
  HelpCircle,
  Layers,
  LayoutDashboard,
  LineChart,
  LogOut,
  Map,
  Package,
  PieChart,
  Repeat,
  Search,
  Settings,
  Sparkles,
  Store,
  Target,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { prefetchForRoute } from "@/lib/prefetch";

type MenuItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  href?: string;
  hasSubmenu?: boolean;
  submenuItems?: Array<{
    id: string;
    label: string;
    icon: React.ElementType;
    href?: string;
  }>;
};

type MenuSection = {
  section: string;
  items: MenuItem[];
};

interface FloatingSubmenuProps {
  item: MenuItem;
  isVisible: boolean;
  position: { x: number; y: number };
  activeItem: string;
  setActiveItem: (id: string) => void;
}

function FloatingSubmenu({ item, isVisible, position, activeItem, setActiveItem }: FloatingSubmenuProps) {
  if (!isVisible || typeof window === "undefined") return null;

  return createPortal(
    <div
      className="fixed bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px] max-w-[250px] transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] z-[9999]"
      style={{
        left: position.x,
        top: position.y,
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? "visible" : "hidden",
      }}
    >
      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border bg-muted/50">{item.label}</div>
      <div className="py-1">
        {item.submenuItems?.map((subItem) => {
          const SubIcon = subItem.icon;
          const isSubActive = activeItem === subItem.id;
          return (
            <Button
              key={subItem.id}
              variant="ghost"
              className={cn("w-full justify-start px-3 py-2 h-auto rounded-none text-sm hover:bg-accent hover:text-accent-foreground", isSubActive && "bg-accent text-accent-foreground font-medium")}
              onClick={() => setActiveItem(subItem.id)}
              asChild={!!subItem.href}
            >
              {subItem.href ? (
                <Link prefetch={true} href={subItem.href} className="flex items-center w-full">
                  <SubIcon className="mr-3 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{subItem.label}</span>
                </Link>
              ) : (
                <div className="flex items-center w-full">
                  <SubIcon className="mr-3 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{subItem.label}</span>
                </div>
              )}
            </Button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}

type Props = {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
};

export function DashboardSidebar({ collapsed, setCollapsed }: Props) {
  const pathname = usePathname();
  const [activeItem, setActiveItem] = useState("");
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({ "Discovery Hub": true });
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [hoveredSubmenu, setHoveredSubmenu] = useState<{
    item: MenuItem;
    position: { x: number; y: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  // Remove background on selected items, only highlight text
  const selectedBg = '';
  const selectedHoverBg = '';

  // Set active item based on pathname
  useEffect(() => {
    if (pathname === "/") {
      setActiveItem("market-screener");
    } else if (pathname.startsWith("/dashboard")) {
      setActiveItem("dashboard");
    } else if (pathname.startsWith("/discovery/market-insights")) {
      setActiveItem("market-insights");
    } else if (pathname.startsWith("/events")) {
      setActiveItem("events");
    } else if (pathname.startsWith("/discovery/map")) {
      setActiveItem("market-map");
    } else if (pathname.startsWith("/discovery/leaderboard") || pathname.startsWith("/discovery/omega-leaderboard")) {
      setActiveItem("leaderboard");
    } else if (pathname.startsWith("/discovery/whales") || pathname.startsWith("/discovery/whale-activity")) {
      setActiveItem("whale-activity");
    } else if (pathname.startsWith("/insiders")) {
      setActiveItem("insiders");
    } else if (pathname.startsWith("/traders/explorer")) {
      setActiveItem("trader-explorer");
    } else if (pathname.startsWith("/traders/compare")) {
      setActiveItem("trader-comparison");
    } else if (pathname === "/strategy-builder") {
      setActiveItem("strategy-builder");
    } else if (pathname === "/strategies") {
      setActiveItem("strategy-dashboard");
    } else if (pathname.startsWith("/strategies/")) {
      // Extract strategy ID from /strategies/default-template, etc.
      const strategyId = pathname.split("/")[2];
      if (strategyId) {
        setActiveItem(strategyId);
      }
    } else if (pathname === "/intelligence-signals") {
      setActiveItem("intelligence-signals");
    } else if (pathname === "/demo/tsi-signals") {
      setActiveItem("demo-tsi-signals");
    } else if (pathname === "/demo/top-wallets") {
      setActiveItem("demo-top-wallets");
    } else if (pathname === "/demo/category-leaderboard") {
      setActiveItem("demo-category-leaderboard");
    } else if (pathname === "/admin/pipeline") {
      setActiveItem("admin-pipeline");
    } else if (pathname === "/my-strategies") {
      setActiveItem("my-strategies");
    } else if (pathname === "/strategy-library") {
      setActiveItem("strategy-library");
    } else if (pathname === "/my-positions") {
      setActiveItem("my-positions");
    } else if (pathname === "/my-performance") {
      setActiveItem("my-performance");
    } else if (pathname === "/strategies-marketplace") {
      setActiveItem("strategies-marketplace");
    } else if (pathname === "/settings") {
      setActiveItem("settings");
    } else if (pathname === "/notifications") {
      setActiveItem("notifications");
    } else if (pathname === "/subscription") {
      setActiveItem("subscription");
    } else if (pathname === "/help-center") {
      setActiveItem("help-center");
    } else if (pathname === "/invite-friends") {
      setActiveItem("invite-friends");
    } else {
      // Extract the main path without subpaths
      const mainPath = pathname.split("/")[1];
      if (mainPath) {
        setActiveItem(mainPath);
      }
    }
  }, [pathname]);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch all strategies for sidebar submenu
  useEffect(() => {
    async function fetchStrategies() {
      try {
        const response = await fetch('/api/strategies');
        if (response.ok) {
          const data = await response.json();
          // Filter out archived strategies - only show active ones in sidebar
          const activeStrategies = (data.strategies || []).filter((s: any) => !s.is_archived);
          setStrategies(activeStrategies);
        }
      } catch (error) {
        console.error('Error fetching strategies for sidebar:', error);
      }
    }
    fetchStrategies();
  }, []);

  // Handle window resize to auto-collapse on smaller screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setCollapsed(true);
      }
    };

    // Set initial state
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const toggleSubmenu = (id: string) => {
    setOpenSubmenus((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleSubmenuHover = (item: MenuItem, element: HTMLElement) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    const rect = element.getBoundingClientRect();
    const position = {
      x: rect.right + 8, // 8px gap from the sidebar
      y: rect.top,
    };

    setHoveredSubmenu({ item, position });
  };

  const handleSubmenuLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredSubmenu(null);
    }, 150); // Small delay to allow moving to submenu
  };

  // Prefetch data when hovering over nav links
  const handleLinkHover = useCallback((href: string) => {
    prefetchForRoute(href);
  }, []);

  // Dynamically generate submenu items from strategies
  const strategySubmenuItems = useMemo(() => {
    return strategies.map((strategy) => ({
      id: strategy.strategy_id,
      label: strategy.strategy_name,
      icon: strategy.is_predefined ? Sparkles : Layers,
      href: `/strategies/${strategy.strategy_id}`,
    }));
  }, [strategies]);

  const standaloneItems = useMemo<MenuItem[]>(() => [], []);

  const menuItems: MenuSection[] = useMemo(() => [
    {
      section: "Discovery Hub",
      items: [
        { id: "market-screener", label: "Market Screener", icon: Search, href: "/" },
        { id: "market-insights", label: "Market Insights", icon: Sparkles, href: "/discovery/market-insights" },
        { id: "events", label: "Events", icon: Calendar, href: "/events" },
        { id: "leaderboard", label: "Leaderboard", icon: Trophy, href: "/discovery/leaderboard" },
      ],
    },
    {
      section: "Automate Hub",
      items: [
        {
          id: "strategy-dashboard",
          label: "Strategy Dashboard",
          icon: Gauge,
          href: "/strategies",
          hasSubmenu: true,
          submenuItems: strategySubmenuItems, // Dynamically populated from database
        },
        { id: "strategy-builder", label: "Strategy Builder", icon: Workflow, href: "/strategy-builder" },
        { id: "intelligence-signals", label: "Intelligence Signals", icon: Zap, href: "/intelligence-signals" },
      ],
    },
    {
      section: "Admin",
      items: [
        { id: "admin-pipeline", label: "Pipeline Dashboard", icon: Database, href: "/admin/pipeline" },
      ],
    },
  ], [strategySubmenuItems]);

  const footerItems = [
    { id: "notifications", label: "Notifications", icon: Bell, href: "/notifications" },
    { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
    { id: "logout", label: "Logout", icon: LogOut },
  ];

  return (
    <>
      {!collapsed && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setCollapsed(true)} />}

      {/* Sidebar */}
      <aside className={cn("fixed flex h-full flex-col transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] z-40 bg-transparent", collapsed ? "w-[72px]" : " left-0 w-[280px]")}>
        {/* Collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-8 z-30 flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Header */}
        <div className="px-4 pt-6 pb-4">
          {mounted && (
            <div className="flex items-center px-2">
              <img
                src={theme === 'dark' ? '/brand/icon-dark.png' : '/brand/icon-light.png'}
                alt="CASCADIAN"
                className="h-9 w-9 min-w-9 object-contain"
              />
              <div
                className={cn(
                  "overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                  collapsed ? "w-0 opacity-0" : "w-48 opacity-100 ml-1"
                )}
              >
                <img
                  src={theme === 'dark' ? '/brand/logo-text-dark.png' : '/brand/logo-text-light.png'}
                  alt="CASCADIAN"
                  className="h-10 w-auto object-contain transition-transform duration-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Wrap the entire sidebar content in a TooltipProvider */}
        <TooltipProvider delayDuration={0}>
          {/* Menu sections */}
          <div className="flex-1 overflow-auto py-2">
            {/* Standalone menu items */}
            <div className="px-4 py-1 space-y-1">
              {standaloneItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeItem === item.id;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {item.href ? (
                        <Button variant="ghost" className={cn("w-full justify-start transition-all duration-500 px-4 ml-2", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")} asChild>
                          <Link prefetch={true} href={item.href} className="flex items-center">
                            <Icon className="h-4 w-4 min-w-4" />
                            <span className={cn(
                              "text-sm ml-2 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                              collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                            )}>{item.label}</span>
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="ghost" className={cn("w-full justify-start transition-all duration-500 px-4 ml-2", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setActiveItem(item.id)}>
                          <Icon className="h-4 w-4 min-w-4" />
                          <span className={cn(
                            "text-sm ml-2 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                          )}>{item.label}</span>
                        </Button>
                      )}
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right" className="font-normal">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>

            {/* Collapsible sections */}
            {menuItems.map((section) => {
              // Check if any item in this section is active (for auto-expanding)
              const hasActiveChild = section.items.some(item =>
                activeItem === item.id ||
                item.submenuItems?.some(subItem => activeItem === subItem.id)
              );

              // Get an icon for the section (use first item's icon as fallback)
              const SectionIcon = section.items[0]?.icon || Layers;

              return (
              <div key={section.section} className="px-4 py-1">
                <div className="space-y-1">
                  {/* Section header - always visible */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        className={cn("w-full justify-start text-muted-foreground hover:text-foreground relative transition-all duration-500 px-4 ml-2")}
                        onClick={() => !collapsed && toggleSubmenu(section.section)}
                      >
                        <SectionIcon className="h-4 w-4 min-w-4" />
                        <span className={cn(
                          "text-sm ml-2 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                          collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                        )}>{section.section}</span>
                        <ChevronDown className={cn(
                          "ml-auto h-4 w-4 transition-all duration-500 opacity-40",
                          collapsed ? "w-0 opacity-0" : "w-4",
                          (openSubmenus[section.section] || hasActiveChild) && "rotate-180"
                        )} />
                      </Button>
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right" className="font-normal">
                        {section.section}
                      </TooltipContent>
                    )}
                  </Tooltip>
                  {/* Section content - only when expanded */}
                  {!collapsed && (
                    <Collapsible open={openSubmenus[section.section] || hasActiveChild} className="space-y-1 relative">
                      <CollapsibleContent className="space-y-1">
                        {section.items.map((item, itemIndex) => {
                          const Icon = item.icon;
                          const isActive = activeItem === item.id;
                          const isLastItem = itemIndex === section.items.length - 1;

                    // Handle items with submenus
                    if (item.hasSubmenu && !collapsed) {
                      const hasActiveChild = item.submenuItems?.some((subItem) => activeItem === subItem.id);
                      const isParentDirectlyActive = activeItem === item.id;

                      return (
                        <div key={item.id} className="space-y-1 relative">
                          <div className="absolute left-6 top-0 w-4 h-6 border-l-2 border-b-2 border-border rounded-bl-lg"></div>
                          <Collapsible open={openSubmenus[item.id] || hasActiveChild} className="space-y-1">
                            <Button
                              variant="ghost"
                              className={cn("justify-start text-sm pl-4 ml-8 mr-8 max-w-[calc(100%-4rem)] relative z-10 transition-all duration-500", isParentDirectlyActive ? "text-foreground bg-card shadow-md border border-border/50" : "text-muted-foreground hover:text-foreground")}
                              onClick={() => {
                                // Auto-expand submenu when clicking parent
                                if (!openSubmenus[item.id]) {
                                  toggleSubmenu(item.id);
                                }
                              }}
                              asChild={!!item.href}
                            >
                              {item.href ? (
                                <Link prefetch={true} href={item.href} className="w-full">
                                  <span className="text-xs">{item.label}</span>
                                </Link>
                              ) : (
                                <div className="flex items-center w-full">
                                  <span className="text-xs">{item.label}</span>
                                </div>
                              )}
                            </Button>
                            <CollapsibleContent className="space-y-1">
                              {item.submenuItems?.map((subItem, subIndex) => {
                                const isSubActive = activeItem === subItem.id;
                                const isLastSubItem = subIndex === item.submenuItems!.length - 1;
                                return (
                                  <div key={subItem.id} className="relative">
                                    <div className="absolute left-6 top-0 w-4 h-6 border-l-2 border-b-2 border-border rounded-bl-lg"></div>
                                    <Button
                                      variant="ghost"
                                      className={cn("justify-start text-xs pl-4 ml-12 mr-10 max-w-[calc(100%-5rem)] relative z-10 transition-all duration-500", isSubActive ? "text-foreground bg-card shadow-md border border-border/50" : "text-muted-foreground hover:text-foreground")}
                                      onClick={() => setActiveItem(subItem.id)}
                                      asChild={!!subItem.href}
                                    >
                                      {subItem.href ? (
                                        <Link prefetch={true} href={subItem.href} className="w-full">
                                          <span>{subItem.label}</span>
                                        </Link>
                                      ) : (
                                        <span>{subItem.label}</span>
                                      )}
                                    </Button>
                                  </div>
                                );
                              })}
                            </CollapsibleContent>
                          </Collapsible>
                        </div>
                      );
                    }

                    // Handle items with submenus when collapsed - with floating submenu
                    if (collapsed && item.hasSubmenu) {
                      const isParentActive = item.submenuItems?.some((subItem) => activeItem === subItem.id) || activeItem === item.id;

                      return (
                        <div key={item.id} className="relative">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                className={cn("w-full justify-start px-2", isParentActive && `${selectedBg} text-foreground shadow-md ${selectedHoverBg}`)}
                                onClick={() => setActiveItem(item.id)}
                                onMouseEnter={(e) => handleSubmenuHover(item, e.currentTarget)}
                                onMouseLeave={handleSubmenuLeave}
                              >
                                <Icon className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="font-normal">
                              {item.label}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    }

                    // Regular menu items
                    return (
                      <div key={item.id} className="relative">
                        {/* Vertical connector line (only show if not the last item) */}
                        {!isLastItem && (
                          <div className="absolute left-6 top-0 w-0.5 h-full bg-border z-0"></div>
                        )}
                        {/* L-shaped connector */}
                        <div className="absolute left-6 top-0 w-4 h-6 border-l-2 border-b-2 border-border rounded-bl-lg z-0"></div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {item.href ? (
                              <Button variant="ghost" className={cn("justify-start text-sm pl-4 ml-8 mr-8 max-w-[calc(100%-4rem)] relative z-10 transition-all duration-500", isActive ? "text-foreground bg-card shadow-md border border-border/50" : "text-muted-foreground hover:text-foreground")} asChild>
                                <Link prefetch={true} href={item.href} className="w-full" onMouseEnter={() => item.href && handleLinkHover(item.href)}>
                                  <span className="text-xs">{item.label}</span>
                                </Link>
                              </Button>
                            ) : (
                              <Button variant="ghost" className={cn("justify-start text-sm pl-4 ml-8 mr-8 max-w-[calc(100%-4rem)] relative z-10 transition-all duration-500", isActive ? "text-foreground bg-card shadow-md border border-border/50" : "text-muted-foreground hover:text-foreground")} onClick={() => setActiveItem(item.id)}>
                                <span className="text-xs">{item.label}</span>
                              </Button>
                            )}
                          </TooltipTrigger>
                        </Tooltip>
                      </div>
                    );
                  })}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-auto p-4">
            <div className="space-y-2">
              {footerItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeItem === item.id;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {item.href ? (
                        <Button variant="ghost" className={cn("w-full justify-start transition-all duration-500 px-4 ml-2", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")} asChild>
                          <Link prefetch={true} href={item.href} className="flex items-center">
                            <Icon className="h-4 w-4 min-w-4" />
                            <span className={cn(
                              "text-sm ml-2 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                              collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                            )}>{item.label}</span>
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="ghost" className={cn("w-full justify-start transition-all duration-500 px-4 ml-2", isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")} onClick={() => setActiveItem(item.id)}>
                          <Icon className="h-4 w-4 min-w-4" />
                          <span className={cn(
                            "text-sm ml-2 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
                            collapsed ? "w-0 opacity-0" : "w-auto opacity-100"
                          )}>{item.label}</span>
                        </Button>
                      )}
                    </TooltipTrigger>
                    {collapsed && (
                      <TooltipContent side="right" className="font-normal">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>

            {/* <Separator className="my-2" /> */}

            {/* <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
              {!collapsed && (
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src="/abstract-geometric-shapes.png" />
                    <AvatarFallback>AZ</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">Ayaan Zafar</span>
                    <span className="text-xs text-muted-foreground">Pro Plan</span>
                  </div>
                </div>
              )}

              {collapsed && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Avatar className="h-8 w-8 cursor-pointer">
                      <AvatarImage src="/abstract-geometric-shapes.png" />
                      <AvatarFallback>AZ</AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-normal">
                    Ayaan Zafar (Pro Plan)
                  </TooltipContent>
                </Tooltip>
              )}
            </div> */}
          </div>
        </TooltipProvider>
      </aside>

      {/* Floating Submenu */}
      {hoveredSubmenu && (
        <div
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={handleSubmenuLeave}
        >
          <FloatingSubmenu item={hoveredSubmenu.item} isVisible={true} position={hoveredSubmenu.position} activeItem={activeItem} setActiveItem={setActiveItem} />
        </div>
      )}
    </>
  );
}
