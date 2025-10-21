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
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
      className="fixed bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px] max-w-[250px] transition-all duration-200 z-[9999]"
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
                <Link href={subItem.href} className="flex items-center w-full">
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
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({});
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [hoveredSubmenu, setHoveredSubmenu] = useState<{
    item: MenuItem;
    position: { x: number; y: number };
  } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set active item based on pathname
  useEffect(() => {
    if (pathname === "/") {
      setActiveItem("market-screener");
    } else if (pathname.startsWith("/dashboard")) {
      setActiveItem("dashboard");
    } else if (pathname.startsWith("/events")) {
      setActiveItem("events");
    } else if (pathname.startsWith("/discovery/screener")) {
      setActiveItem("market-screener");
    } else if (pathname.startsWith("/discovery/map")) {
      setActiveItem("market-map");
    } else if (pathname.startsWith("/discovery/leaderboard")) {
      setActiveItem("pnl-leaderboard");
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

  const menuItems: MenuSection[] = [
    {
      section: "Analytics",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
      ],
    },
    {
      section: "Discovery Hub",
      items: [
        { id: "market-screener", label: "Market Screener", icon: Search, href: "/" },
        { id: "events", label: "Events", icon: Calendar, href: "/events" },
        { id: "market-map", label: "Market Map", icon: Map, href: "/discovery/map" },
        { id: "pnl-leaderboard", label: "PnL Leaderboard", icon: TrendingUp, href: "/discovery/leaderboard" },
        { id: "whale-activity", label: "Whale Activity", icon: Fish, href: "/discovery/whale-activity" },
        { id: "insiders", label: "Insiders", icon: AlertTriangle, href: "/insiders" },
      ],
    },
    // {
    //   section: "Traders Hub",
    //   items: [
    //     { id: "trader-explorer", label: "Trader Explorer", icon: Users, href: "/traders/explorer" },
    //     { id: "trader-comparison", label: "Trader Comparison", icon: GitCompare, href: "/traders/compare" },
    //   ],
    // },
    {
      section: "Automate Hub",
      items: [
        {
          id: "strategy-dashboard",
          label: "Strategy Dashboard",
          icon: Gauge,
          href: "/strategies",
          hasSubmenu: true,
          submenuItems: [
            { id: "default-template", label: "Default Template", icon: Sparkles, href: "/strategies/default-template" },
          ],
        },
        { id: "strategy-builder", label: "Strategy Builder", icon: Workflow, href: "/strategy-builder" },
        { id: "intelligence-signals", label: "Intelligence Signals", icon: Zap, href: "/intelligence-signals" },
        // { id: "my-strategies", label: "My Strategies", icon: Layers, href: "/my-strategies" },
        // { id: "strategy-library", label: "Strategy Library", icon: BookOpen, href: "/strategy-library" },
      ],
    },
    // {
    //   section: "My Account",
    //   items: [
    //     { id: "my-positions", label: "My Positions", icon: Wallet, href: "/my-positions" },
    //     { id: "my-performance", label: "My Performance", icon: BarChart, href: "/my-performance" },
    //   ],
    // },
    // {
    //   section: "Marketplace",
    //   items: [
    //     { id: "strategies-marketplace", label: "Strategies Marketplace", icon: Store, href: "/strategies-marketplace" },
    //   ],
    // },
    // {
    //   section: "Preferences",
    //   items: [
    //     { id: "invite-friends", label: "Invite Friends", icon: UserPlus, href: "/invite-friends" },
    //     { id: "subscription", label: "Subscription", icon: CreditCard, href: "/subscription" },
    //     { id: "help-center", label: "Help Center", icon: HelpCircle, href: "/help-center" },
    //   ],
    // },
  ];

  const footerItems = [
    { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
    { id: "logout", label: "Logout", icon: LogOut },
  ];

  return (
    <>
      {!collapsed && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setCollapsed(true)} />}

      {/* Sidebar */}
      <aside className={cn("fixed flex h-full flex-col border-r border-border bg-card transition-all duration-300 ease-in-out z-40", collapsed ? "w-[72px]" : " left-0 w-[240px]")}>
        {/* Collapse toggle button */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-6 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Header */}
        <div className="flex h-16 items-center px-6 py-6">
          <div className="flex items-center gap-2">
            {!collapsed && mounted && (
              <img
                src={theme === 'dark' ? '/CASCADIAN_dark.png' : '/CASCADIAN_light.png'}
                alt="CASCADIAN"
                className="h-6 w-auto object-contain px-2"
              />
            )}
            {collapsed && (
              <div className="flex h-8 w-8 items-center justify-center rounded-md">
                <TrendingUp className="h-5 w-5 text-black dark:text-white" />
              </div>
            )}
          </div>
        </div>

        {/* Wrap the entire sidebar content in a TooltipProvider */}
        <TooltipProvider delayDuration={0}>
          {/* Menu sections */}
          <div className="flex-1 overflow-auto py-2">
            {menuItems.map((section) => (
              <div key={section.section} className="px-4 py-3">
                {!collapsed && <div className="mb-3 px-3 text-xs font-medium text-muted-foreground">{section.section}</div>}
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem === item.id;

                    // Handle items with submenus
                    if (item.hasSubmenu && !collapsed) {
                      const isParentActive = item.submenuItems?.some((subItem) => activeItem === subItem.id) || activeItem === item.id;

                      return (
                        <div key={item.id} className="space-y-1">
                          <Collapsible open={openSubmenus[item.id] || isParentActive} className="space-y-1">
                            <Button
                              variant={isParentActive ? "secondary" : "ghost"}
                              className="w-full justify-start"
                              onClick={() => {
                                // Auto-expand submenu when clicking parent
                                if (!openSubmenus[item.id]) {
                                  toggleSubmenu(item.id);
                                }
                              }}
                              asChild={!!item.href}
                            >
                              {item.href ? (
                                <Link href={item.href}>
                                  <Icon className="mr-2 h-4 w-4" />
                                  <span>{item.label}</span>
                                </Link>
                              ) : (
                                <div className="flex items-center">
                                  <Icon className="mr-2 h-4 w-4" />
                                  <span>{item.label}</span>
                                </div>
                              )}
                            </Button>
                            <CollapsibleContent className="pl-6 space-y-1">
                              {item.submenuItems?.map((subItem) => {
                                const SubIcon = subItem.icon;
                                const isSubActive = activeItem === subItem.id;
                                return (
                                  <Button
                                    key={subItem.id}
                                    variant={isSubActive ? "secondary" : "ghost"}
                                    className="w-full justify-start"
                                    onClick={() => setActiveItem(subItem.id)}
                                    asChild={!!subItem.href}
                                  >
                                    {subItem.href ? (
                                      <Link href={subItem.href}>
                                        <SubIcon className="mr-2 h-4 w-4" />
                                        <span>{subItem.label}</span>
                                      </Link>
                                    ) : (
                                      <>
                                        <SubIcon className="mr-2 h-4 w-4" />
                                        <span>{subItem.label}</span>
                                      </>
                                    )}
                                  </Button>
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
                                variant={isParentActive ? "secondary" : "ghost"}
                                className="w-full justify-start px-2"
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

                    // Regular menu items (existing code remains the same)
                    return (
                      <Tooltip key={item.id}>
                        <TooltipTrigger asChild>
                          {item.href ? (
                            <Button variant={isActive ? "secondary" : "ghost"} className={cn("w-full justify-start", collapsed ? "px-2 justify-center" : "px-4")} asChild>
                              <Link href={item.href}>
                                <Icon className={cn("h-4 w-4", collapsed ? "mr-0" : "mr-2")} />
                                {!collapsed && <span>{item.label}</span>}
                              </Link>
                            </Button>
                          ) : (
                            <Button variant={isActive ? "secondary" : "ghost"} className={cn("w-full justify-start", collapsed ? "px-2" : "px-2")} onClick={() => setActiveItem(item.id)}>
                              <Icon className={cn("h-4 w-4", collapsed ? "mr-0" : "mr-2")} />
                              {!collapsed && <span>{item.label}</span>}
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
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-auto border-t border-border p-4">
            <div className="space-y-2">
              {footerItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {item.href ? (
                        <Button variant="ghost" className={cn("w-full justify-start", collapsed ? "px-2" : "px-2")} asChild>
                          <Link href={item.href}>
                            <Icon className={cn("h-4 w-4", collapsed ? "mr-0" : "mr-2")} />
                            {!collapsed && <span>{item.label}</span>}
                          </Link>
                        </Button>
                      ) : (
                        <Button variant="ghost" className={cn("w-full justify-start", collapsed ? "px-2" : "px-2")} onClick={() => setActiveItem(item.id)}>
                          <Icon className={cn("h-4 w-4", collapsed ? "mr-0" : "mr-2")} />
                          {!collapsed && <span>{item.label}</span>}
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
