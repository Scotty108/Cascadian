"use client"

import Image from "next/image";
import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Search, Plus } from "lucide-react"
import { toast } from "@/hooks/use-toast"

interface AddAssetModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface AssetOption {
  id: string
  name: string
  symbol: string
  price: number
  change24h: number
  marketCap: number
  icon: string
}

const popularAssets: AssetOption[] = [
  {
    id: "bitcoin",
    name: "Bitcoin",
    symbol: "BTC",
    price: 42830.15,
    change24h: 2.34,
    marketCap: 850000000000,
    icon: "/placeholder.svg?height=32&width=32&text=BTC",
  },
  {
    id: "ethereum",
    name: "Ethereum",
    symbol: "ETH",
    price: 3890.42,
    change24h: 1.87,
    marketCap: 450000000000,
    icon: "/placeholder.svg?height=32&width=32&text=ETH",
  },
  {
    id: "solana",
    name: "Solana",
    symbol: "SOL",
    price: 106.32,
    change24h: 5.21,
    marketCap: 45000000000,
    icon: "/placeholder.svg?height=32&width=32&text=SOL",
  },
  {
    id: "cardano",
    name: "Cardano",
    symbol: "ADA",
    price: 0.58,
    change24h: -2.15,
    marketCap: 20000000000,
    icon: "/placeholder.svg?height=32&width=32&text=ADA",
  },
]

export function AddAssetModal({ open, onOpenChange }: AddAssetModalProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null)
  const [holdings, setHoldings] = useState("")
  const [averageCost, setAverageCost] = useState("")
  const [purchaseDate, setPurchaseDate] = useState("")
  const [chain, setChain] = useState("")

  const filteredAssets = popularAssets.filter(
    (asset) =>
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleAddAsset = () => {
    if (!selectedAsset || !holdings || !averageCost) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    // In a real app, you would add the asset to the portfolio
    toast({
      title: "Asset added",
      description: `${selectedAsset.name} has been added to your portfolio.`,
    })

    // Reset form
    setSelectedAsset(null)
    setHoldings("")
    setAverageCost("")
    setPurchaseDate("")
    setChain("")
    onOpenChange(false)
  }

  const formatMarketCap = (marketCap: number) => {
    if (marketCap >= 1e12) return `$${(marketCap / 1e12).toFixed(1)}T`
    if (marketCap >= 1e9) return `$${(marketCap / 1e9).toFixed(1)}B`
    if (marketCap >= 1e6) return `$${(marketCap / 1e6).toFixed(1)}M`
    return `$${marketCap.toLocaleString()}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Asset to Portfolio</DialogTitle>
          <DialogDescription>Add a new cryptocurrency asset to track in your portfolio.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Asset Search */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Asset</CardTitle>
              <CardDescription>Search and select the asset you want to add</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search for an asset..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="grid gap-2 max-h-60 overflow-y-auto">
                {filteredAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                      selectedAsset?.id === asset.id ? "border-primary bg-primary/5" : ""
                    }`}
                    onClick={() => setSelectedAsset(asset)}
                  >
                    <div className="flex items-center space-x-3">
                      <Image src={asset.icon || "/placeholder.svg"} alt={asset.name} className="w-8 h-8 rounded-full" width={32} height={32} />
                      <div>
                        <div className="font-medium">{asset.name}</div>
                        <div className="text-sm text-muted-foreground">{asset.symbol}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">${asset.price.toLocaleString()}</div>
                      <div className={`text-sm ${asset.change24h >= 0 ? "text-green-500" : "text-red-500"}`}>
                        {asset.change24h >= 0 ? "+" : ""}
                        {asset.change24h.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Asset Details Form */}
          {selectedAsset && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Asset Details</CardTitle>
                <CardDescription>Enter your holdings and purchase information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-3 p-3 bg-muted/50 rounded-lg">
                  <Image
                    src={selectedAsset.icon || "/placeholder.svg"}
                    alt={selectedAsset.name}
                    className="w-10 h-10 rounded-full"
                    width={40}
                    height={40}
                  />
                  <div>
                    <div className="font-medium">
                      {selectedAsset.name} ({selectedAsset.symbol})
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Current Price: ${selectedAsset.price.toLocaleString()} • Market Cap:{" "}
                      {formatMarketCap(selectedAsset.marketCap)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="holdings">Holdings *</Label>
                    <Input
                      id="holdings"
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={holdings}
                      onChange={(e) => setHoldings(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Amount of {selectedAsset.symbol} you own</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="averageCost">Average Cost (USD) *</Label>
                    <Input
                      id="averageCost"
                      type="number"
                      step="any"
                      placeholder="0.00"
                      value={averageCost}
                      onChange={(e) => setAverageCost(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Average price paid per {selectedAsset.symbol}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="purchaseDate">Purchase Date</Label>
                    <Input
                      id="purchaseDate"
                      type="date"
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="chain">Blockchain</Label>
                    <Select value={chain} onValueChange={setChain}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select chain" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ethereum">Ethereum</SelectItem>
                        <SelectItem value="bitcoin">Bitcoin</SelectItem>
                        <SelectItem value="solana">Solana</SelectItem>
                        <SelectItem value="polygon">Polygon</SelectItem>
                        <SelectItem value="bsc">BNB Chain</SelectItem>
                        <SelectItem value="avalanche">Avalanche</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {holdings && averageCost && (
                  <div className="p-3 bg-muted/50 rounded-lg">
                    <div className="text-sm font-medium mb-2">Summary</div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Total Cost:</span>
                        <span className="ml-2 font-medium">
                          ${(Number.parseFloat(holdings) * Number.parseFloat(averageCost)).toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Current Value:</span>
                        <span className="ml-2 font-medium">
                          ${(Number.parseFloat(holdings) * selectedAsset.price).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddAsset} disabled={!selectedAsset || !holdings || !averageCost}>
            <Plus className="mr-2 h-4 w-4" />
            Add Asset
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
