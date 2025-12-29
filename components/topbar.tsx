"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { SearchBar } from "@/components/search-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Bell, ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { NotificationRow } from "@/types/database";
import { useTheme } from "next-themes";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [notificationCount, setNotificationCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState<NotificationRow[]>([]);
  const { theme } = useTheme();

  // Fetch notification count and recent notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        // Fetch unread count
        const countResponse = await fetch('/api/notifications/count');
        const countData = await countResponse.json();
        if (countData.success) {
          setNotificationCount(countData.count);
        }

        // Fetch recent notifications (limit 3 for dropdown)
        const notificationsResponse = await fetch('/api/notifications?limit=3&is_archived=false');
        const notificationsData = await notificationsResponse.json();
        if (notificationsData.success) {
          setRecentNotifications(notificationsData.data);
        }
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
      }
    };

    fetchNotifications();

    // Poll for new notifications every 5 minutes (reduced from 30s to save egress)
    const interval = setInterval(fetchNotifications, 300000);
    return () => clearInterval(interval);
  }, []);

  // Determine page name and whether to show back button based on route
  const getPageInfo = (): { name: string; showBack: boolean; backUrl?: string; backLabel?: string } => {
    if (pathname.startsWith('/events/') && pathname !== '/events') {
      return { name: 'Event Overview', showBack: true, backLabel: 'Back' };
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
    if (pathname === '/dashboard') {
      return { name: '', showBack: false };
    }
    if (pathname === '/') {
      return { name: '', showBack: false };
    }
    return { name: '', showBack: false };
  };

  const pageInfo = getPageInfo();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center px-6 lg:h-16 bg-transparent">
      {/* Left section - Search + Page Name or Back Button */}
      <div className="flex items-center gap-4">
        <SearchBar />
        {pageInfo.showBack ? (
          <div className="flex items-center gap-3">
            {pageInfo.backUrl ? (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="gap-2"
              >
                <Link prefetch={true} href={pageInfo.backUrl}>
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
            )}
          </div>
        ) : (
          pageInfo.name && (
            <h1 className="text-2xl font-semibold">{pageInfo.name}</h1>
          )
        )}
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2 ml-auto">
        <ThemeToggle variant="ghost" className={cn("rounded-full", theme === 'light' && "bg-white")} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("relative rounded-full", theme === 'light' && "bg-white")}>
              <Bell className="h-4 w-4" />
              {notificationCount > 0 && (
                <Badge className="absolute -right-1 flex items-center justify-center -top-1 h-4 w-4 p-0 text-[10px]">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </Badge>
              )}
              <span className="sr-only">Notifications</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[300px]">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {recentNotifications.length === 0 ? (
              <DropdownMenuItem className="flex cursor-default flex-col items-center py-4">
                <span className="text-sm text-muted-foreground">No new notifications</span>
              </DropdownMenuItem>
            ) : (
              recentNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                />
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer justify-center text-sm font-medium">
              <Link prefetch={true} href="/notifications">View all notifications</Link>
            </DropdownMenuItem>
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

function NotificationItem({ notification }: { notification: NotificationRow }) {
  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const ItemWrapper = notification.link
    ? ({ children }: { children: React.ReactNode }) => (
        <Link prefetch={true} href={notification.link!} className="w-full">
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => <>{children}</>;

  return (
    <ItemWrapper>
      <DropdownMenuItem className="flex cursor-pointer flex-col items-start py-2">
        <div className="flex w-full justify-between">
          <span className="font-medium">{notification.title}</span>
          <span className="text-xs text-muted-foreground">
            {notification.created_at ? formatRelativeTime(notification.created_at) : 'Unknown'}
          </span>
        </div>
        <span className="text-xs text-muted-foreground line-clamp-2">{notification.message}</span>
        {!notification.is_read && (
          <Badge variant="default" className="mt-1 bg-primary/20 text-primary text-[10px] h-4 px-1.5">
            New
          </Badge>
        )}
      </DropdownMenuItem>
    </ItemWrapper>
  );
}
