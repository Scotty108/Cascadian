"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Bell } from "lucide-react";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 lg:h-16 lg:px-6">
      {/* Left section - Platform Status */}
      <div className="flex items-center gap-4">
        <StatusIndicator label="Polymarket API" status="connected" />
        <StatusIndicator label="Last Sync" status="2m ago" />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
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
