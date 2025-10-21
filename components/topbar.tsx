"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Bell, ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();

  // Determine page name and whether to show back button based on route
  const getPageInfo = () => {
    if (pathname.startsWith('/events/') && pathname !== '/events') {
      return { name: 'Event Overview', showBack: true, backLabel: 'Back to Events', backUrl: '/events' };
    }
    if (pathname === '/events') {
      return { name: 'Events', showBack: false };
    }
    if (pathname.startsWith('/analysis/market/')) {
      return { name: 'Market Detail', showBack: true };
    }
    if (pathname.startsWith('/analysis/wallet/')) {
      return { name: 'Wallet Detail', showBack: true };
    }
    if (pathname === '/analysis/market-screener') {
      return { name: 'Market Screener', showBack: false };
    }
    if (pathname === '/analysis/market-map') {
      return { name: 'Market Map', showBack: false };
    }
    if (pathname === '/analysis') {
      return { name: 'Analysis', showBack: false };
    }
    if (pathname === '/strategy-builder') {
      return { name: 'Strategy Builder', showBack: false };
    }
    if (pathname === '/intelligence-signals') {
      return { name: 'Intelligence Signals', showBack: false };
    }
    if (pathname === '/execution') {
      return { name: 'Execution', showBack: false };
    }
    if (pathname === '/') {
      return { name: 'Dashboard', showBack: false };
    }
    return { name: '', showBack: false };
  };

  const pageInfo = getPageInfo();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center border-b bg-background px-4 lg:h-16 lg:px-6">
      {/* Left section - Back Button */}
      <div className="flex items-center gap-3 w-1/4">
        {pageInfo.showBack && (
          pageInfo.backUrl ? (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="gap-2"
            >
              <Link href={pageInfo.backUrl}>
                <ArrowLeft className="h-4 w-4" />
                {pageInfo.backLabel || 'Back'}
              </Link>
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )
        )}
      </div>

      {/* Center section - Page Name */}
      <div className="flex-1 flex justify-center">
        {pageInfo.name && (
          <h1 className="text-lg font-semibold">{pageInfo.name}</h1>
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 w-1/4 justify-end">
        <ThemeToggle variant="ghost" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              <Badge className="absolute -right-1 flex items-center justify-center -top-1 h-4 w-4 p-0 text-[10px]">3</Badge>
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[300px]">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <NotificationItem title="High SII Signal" message="Trump 2024 market showing SII +75" time="2 min ago" />
            <NotificationItem title="Whale Activity" message="Large buy detected on BTC $100k market" time="15 min ago" />
            <NotificationItem title="Strategy Update" message="Your momentum strategy gained +5.2%" time="1 hour ago" />
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer justify-center text-sm font-medium">View all notifications</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function StatusIndicator({ label, status }: { label: string; status: string }) {
  const isConnected = status === "connected";
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <div className={cn("h-2 w-2 rounded-full", isConnected ? "bg-emerald-500" : "bg-muted-foreground")} />
      <div className="text-sm font-medium">{label}</div>
      <div className="text-sm text-muted-foreground">{isConnected ? "•" : ""} {status}</div>
    </div>
  );
}

function NotificationItem({ title, message, time }: { title: string; message: string; time: string }) {
  return (
    <DropdownMenuItem className="flex cursor-default flex-col items-start py-2">
      <div className="flex w-full justify-between">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{time}</span>
      </div>
      <span className="text-xs">{message}</span>
    </DropdownMenuItem>
  );
}
