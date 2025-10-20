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
  BarChart,
  Bot,
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
  Gauge,
  HelpCircle,
  Layers,
  LayoutDashboard,
  LineChart,
  LogOut,
  Package,
  PieChart,
  Repeat,
  Settings,
  Sparkles,
  Store,
  TrendingUp,
  UserPlus,
  Wallet,
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
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({
    "control-panel": false,
    "defi-center": false,
  });
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
      setActiveItem("dashboard");
    } else if (pathname === "/my-assets") {
      setActiveItem("my-assets");
    } else if (pathname === "/my-analytics") {
      setActiveItem("my-analytics");
    } else if (pathname === "/trading") {
      setActiveItem("trading");
    } else if (pathname === "/strategy-builder") {
      setActiveItem("strategy-builder");
    } else if (pathname === "/control-panel/overview") {
      setActiveItem("overview");
      setOpenSubmenus((prev) => ({ ...prev, "control-panel": true }));
    } else if (pathname === "/control-panel/bot-settings") {
      setActiveItem("bot-settings");
      setOpenSubmenus((prev) => ({ ...prev, "control-panel": true }));
    } else if (pathname === "/control-panel/execution-logs") {
      setActiveItem("execution-logs");
      setOpenSubmenus((prev) => ({ ...prev, "control-panel": true }));
    } else if (pathname === "/defi-center/yield-farming") {
      setActiveItem("yield-farming");
      setOpenSubmenus((prev) => ({ ...prev, "defi-center": true }));
    } else if (pathname === "/defi-center/staking-pools") {
      setActiveItem("staking-pools");
      setOpenSubmenus((prev) => ({ ...prev, "defi-center": true }));
    } else if (pathname === "/defi-center/liquidity-tracker") {
      setActiveItem("liquidity-tracker");
      setOpenSubmenus((prev) => ({ ...prev, "defi-center": true }));
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
      section: "Main",
      items: [
        { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/" },
        { id: "my-assets", label: "My Assets", icon: Coins, href: "/my-assets" },
        { id: "my-analytics", label: "My Analytics", icon: LineChart, href: "/my-analytics" },
      ],
    },
    {
      section: "Trading & Bots",
      items: [
        { id: "trading", label: "Trading", icon: BarChart, href: "/trading" },
        { id: "strategy-builder", label: "Strategy Builder", icon: Sparkles, href: "/strategy-builder" },
        {
          id: "control-panel",
          label: "Control Panel",
          icon: Gauge,
          hasSubmenu: true,
          submenuItems: [
            { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/control-panel/overview" },
            { id: "bot-settings", label: "Bot Settings", icon: Cog, href: "/control-panel/bot-settings" },
            { id: "execution-logs", label: "Execution Logs", icon: FileText, href: "/control-panel/execution-logs" },
          ],
        },
        { id: "ai-bot", label: "AI Bot", icon: Cpu, href: "/ai-bot" },
        { id: "signal-bot", label: "Signal Bot", icon: Zap, href: "/signal-bot" },
        { id: "dca-bot", label: "DCA Bot", icon: Repeat, href: "/dca-bot" },
        { id: "arbitrage-bot", label: "Arbitrage Bot", icon: Layers, href: "/arbitrage-bot" },
        { id: "pump-screener", label: "Pump Screener", icon: TrendingUp, href: "/pump-screener" },
      ],
    },
    {
      section: "DeFi & Portfolio",
      items: [
        {
          id: "defi-center",
          label: "DeFi Center",
          icon: CircleDollarSign,
          hasSubmenu: true,
          submenuItems: [
            { id: "yield-farming", label: "Yield Farming", icon: TrendingUp, href: "/defi-center/yield-farming" },
            { id: "staking-pools", label: "Staking Pools", icon: Database, href: "/defi-center/staking-pools" },
            {
              id: "liquidity-tracker",
              label: "Liquidity Tracker",
              icon: Activity,
              href: "/defi-center/liquidity-tracker",
            },
          ],
        },
        { id: "portfolio-tracker", label: "Portfolio Tracker", icon: PieChart, href: "/portfolio-tracker" },
        { id: "wallets", label: "Wallets", icon: Wallet, href: "/wallets" },
        { id: "defi-protocols", label: "DeFi Protocols", icon: Layers, href: "/defi-protocols" },
      ],
    },
    {
      section: "Marketplace",
      items: [
        { id: "strategies-marketplace", label: "Strategies Marketplace", icon: Store, href: "/strategies-marketplace" },
        { id: "bot-templates", label: "Bot Templates", icon: Package, href: "/bot-templates" },
      ],
    },
    {
      section: "Preferences",
      items: [
        { id: "invite-friends", label: "Invite Friends", icon: UserPlus, href: "/invite-friends" },
        { id: "subscription", label: "Subscription", icon: CreditCard, href: "/subscription" },
        { id: "help-center", label: "Help Center", icon: HelpCircle, href: "/help-center" },
      ],
    },
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
        <div className="flex h-16 items-center px-3 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-lg font-semibold tracking-tight">CASCADIAN</span>
                <span className="text-xs text-muted-foreground">AI Trading</span>
              </div>
            )}
          </div>
        </div>

        {/* Wrap the entire sidebar content in a TooltipProvider */}
        <TooltipProvider delayDuration={0}>
          {/* Menu sections */}
          <div className="flex-1 overflow-auto py-2">
            {menuItems.map((section) => (
              <div key={section.section} className="px-3 py-2">
                {!collapsed && <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">{section.section}</div>}
                <div className="space-y-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem === item.id;

                    // Handle items with submenus
                    if (item.hasSubmenu && !collapsed) {
                      const isParentActive = item.submenuItems?.some((subItem) => activeItem === subItem.id) || activeItem === item.id;

                      return (
                        <div key={item.id} className="space-y-1">
                          <Collapsible open={openSubmenus[item.id]} className="space-y-1">
                            <CollapsibleTrigger asChild>
                              <Button
                                variant={isParentActive ? "secondary" : "ghost"}
                                className="w-full justify-between"
                                onClick={(e) => {
                                  e.preventDefault();
                                  toggleSubmenu(item.id);
                                }}
                              >
                                <div className="flex items-center">
                                  <Icon className="mr-2 h-4 w-4" />
                                  <span>{item.label}</span>
                                </div>
                                <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", openSubmenus[item.id] ? "rotate-180" : "rotate-0")} />
                              </Button>
                            </CollapsibleTrigger>
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
          <div className="mt-auto border-t border-border p-3">
            <div className="space-y-1">
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

            <Separator className="my-2" />

            <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
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
            </div>
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
