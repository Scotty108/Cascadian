"use client";

import { SearchBar } from "@/components/search-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WalletConnectModal } from "@/components/wallet-connect-modal";
import { useWalletConnection } from "@/hooks/use-wallet-connection";
import { cn } from "@/lib/utils";
import { Bell, ChevronDown, Copy, ExternalLink, LogOut, Settings, User, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function Topbar() {
  const [showWalletModal, setShowWalletModal] = useState(false);
  const { isConnected, address, balance, disconnect, copyAddress } = useWalletConnection();

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 lg:h-16 lg:px-6">
      {/* Left section */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:block">
          <SearchBar />
        </div>
      </div>

      {/* Center section - Market Ticker */}
      <div className="hidden items-center gap-4 2xl:flex">
        <MarketTicker symbol="BTC/USD" price="68,245.32" change="+2.4%" isPositive={true} />
        <MarketTicker symbol="ETH/USD" price="3,892.17" change="-0.8%" isPositive={false} />
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        <ThemeToggle variant="ghost" className="hidden sm:flex" />

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
            <NotificationItem title="Bot Action" message="BTC signal triggered at $65,000" time="2 min ago" />
            <NotificationItem title="Trade Alert" message="ETH trade completed: +2.3%" time="15 min ago" />
            <NotificationItem title="System Notice" message="New AI model update available" time="1 hour ago" />
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer justify-center text-sm font-medium">View all notifications</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Wallet Connection */}
        {isConnected ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm" className="gap-2">
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline-flex">{formatAddress(address)}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[280px]">
              <DropdownMenuLabel>Wallet Connected</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-2 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Address</span>
                  <Button variant="ghost" size="sm" onClick={copyAddress} className="h-6 px-2">
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <div className="font-mono text-sm">{formatAddress(address)}</div>
              </div>
              <div className="px-2 py-2">
                <div className="text-sm text-muted-foreground">Balance</div>
                <div className="font-semibold">{balance} ETH</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <ExternalLink className="mr-2 h-4 w-4" />
                <span>View on Explorer</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer text-red-600" onClick={disconnect}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>Disconnect</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="default" size="sm" className="hidden sm:flex" onClick={() => setShowWalletModal(true)}>
            <Wallet className="mr-2 h-4 w-4" />
            <span className="hidden lg:block"> Connect Wallet</span>
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src="/abstract-geometric-shapes.png" />
                <AvatarFallback>AZ</AvatarFallback>
              </Avatar>
              <span className="hidden md:inline-flex">Ayaan Zafar</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              <Link href="/signin">Signin</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              <Link href="/signup">Sign Up</Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Logout</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="sm:hidden" />
            <div className="px-2 py-1.5 sm:hidden">
              <ThemeToggle className="w-full" />
            </div>
            {!isConnected && (
              <>
                <DropdownMenuSeparator className="sm:hidden" />
                <div className="px-2 py-1.5 sm:hidden">
                  <Button variant="default" size="sm" className="w-full" onClick={() => setShowWalletModal(true)}>
                    <Wallet className="mr-2 h-4 w-4" />
                    Connect Wallet
                  </Button>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <WalletConnectModal open={showWalletModal} onOpenChange={setShowWalletModal} />
    </header>
  );
}

function MarketTicker({ symbol, price, change, isPositive }: { symbol: string; price: string; change: string; isPositive: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <div className="font-medium">{symbol}</div>
      <div className="text-sm">${price}</div>
      <div className={cn("text-xs", isPositive ? "text-emerald-500" : "text-rose-500")}>{change}</div>
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
