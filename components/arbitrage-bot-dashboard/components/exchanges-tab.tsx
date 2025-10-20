"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Check, Link2, Shield, X } from "lucide-react"
import type { Exchange } from "../types"
import { ExchangeCard } from "./exchange-card"
import { useState } from "react"

interface ExchangesTabProps {
  connectedExchanges: Exchange[]
  disconnectedExchanges: Exchange[]
  allExchanges: Exchange[]
  onConnectExchange: (exchangeId: string) => void
  onDisconnectExchange: (exchangeId: string) => void
}

export function ExchangesTab({
  connectedExchanges,
  disconnectedExchanges,
  allExchanges,
  onConnectExchange,
  onDisconnectExchange,
}: ExchangesTabProps) {
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [securityModalOpen, setSecurityModalOpen] = useState(false)
  const [selectedExchange, setSelectedExchange] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [apiSecret, setApiSecret] = useState("")
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false)
  const [apiEncryptionEnabled, setApiEncryptionEnabled] = useState(true)
  const [sessionTimeout, setSessionTimeout] = useState("30")

  const handleConnectExchange = () => {
    if (selectedExchange && apiKey && apiSecret) {
      // Add connection logic here
      console.log("Connecting to exchange:", selectedExchange)
      setConnectModalOpen(false)
      setSelectedExchange("")
      setApiKey("")
      setApiSecret("")
    }
  }

  const handleSaveSecuritySettings = () => {
    // Add save security settings logic here
    console.log("Saving security settings:", {
      twoFactorEnabled,
      apiEncryptionEnabled,
      sessionTimeout,
    })
    setSecurityModalOpen(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-2">
          <h3 className="text-lg font-medium">Exchange Connections</h3>
          <Badge>{connectedExchanges.length} Connected</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={connectModalOpen} onOpenChange={setConnectModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Link2 className="mr-1 h-4 w-4" /> Connect New Exchange
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Connect New Exchange</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="exchange">Exchange</Label>
                  <Select value={selectedExchange} onValueChange={setSelectedExchange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an exchange..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="binance">Binance</SelectItem>
                      <SelectItem value="coinbase">Coinbase Pro</SelectItem>
                      <SelectItem value="kraken">Kraken</SelectItem>
                      <SelectItem value="kucoin">KuCoin</SelectItem>
                      <SelectItem value="huobi">Huobi</SelectItem>
                      <SelectItem value="bybit">Bybit</SelectItem>
                      <SelectItem value="okx">OKX</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <Input
                    id="apiKey"
                    type="password"
                    placeholder="Enter API Key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="apiSecret">API Secret</Label>
                  <Input
                    id="apiSecret"
                    type="password"
                    placeholder="Enter API Secret"
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setConnectModalOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConnectExchange}
                    className="flex-1"
                    disabled={!selectedExchange || !apiKey || !apiSecret}
                  >
                    Connect
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={securityModalOpen} onOpenChange={setSecurityModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Shield className="mr-1 h-4 w-4" /> Security Settings
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Security Settings</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">Two-Factor Authentication</Label>
                    <div className="text-sm text-muted-foreground">Add extra security to your account</div>
                  </div>
                  <Switch checked={twoFactorEnabled} onCheckedChange={setTwoFactorEnabled} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-base">API Key Encryption</Label>
                    <div className="text-sm text-muted-foreground">Encrypt stored API keys</div>
                  </div>
                  <Switch checked={apiEncryptionEnabled} onCheckedChange={setApiEncryptionEnabled} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="sessionTimeout">Session Timeout</Label>
                  <Select value={sessionTimeout} onValueChange={setSessionTimeout}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 minutes</SelectItem>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                      <SelectItem value="240">4 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setSecurityModalOpen(false)} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={handleSaveSecuritySettings} className="flex-1">
                    Save Settings
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="connected" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="min-w-[400px] ">
            <TabsTrigger value="connected" className="flex items-center gap-1">
              <Check className="h-4 w-4" />
              Connected
              <Badge variant="secondary" className="ml-1">
                {connectedExchanges.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="disconnected" className="flex items-center gap-1">
              <X className="h-4 w-4" />
              Disconnected
              <Badge variant="secondary" className="ml-1">
                {disconnectedExchanges.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="all">All Exchanges</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="connected" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {connectedExchanges.length > 0 ? (
              connectedExchanges.map((exchange) => (
                <ExchangeCard
                  key={exchange.id}
                  exchange={exchange}
                  onConnect={onConnectExchange}
                  onDisconnect={onDisconnectExchange}
                />
              ))
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Link2 className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Connected Exchanges</h3>
                <p className="text-sm text-muted-foreground">Connect exchanges to start arbitrage trading</p>
                <Button className="mt-4" size="sm" onClick={() => setConnectModalOpen(true)}>
                  <Link2 className="mr-1 h-4 w-4" /> Connect Exchange
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="disconnected" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {disconnectedExchanges.length > 0 ? (
              disconnectedExchanges.map((exchange) => (
                <ExchangeCard
                  key={exchange.id}
                  exchange={exchange}
                  onConnect={onConnectExchange}
                  onDisconnect={onDisconnectExchange}
                />
              ))
            ) : (
              <div className="col-span-full flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Check className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="text-lg font-medium">All Exchanges Connected</h3>
                <p className="text-sm text-muted-foreground">Great job! All your exchanges are connected</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="all" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allExchanges.map((exchange) => (
              <ExchangeCard
                key={exchange.id}
                exchange={exchange}
                onConnect={onConnectExchange}
                onDisconnect={onDisconnectExchange}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
