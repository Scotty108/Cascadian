"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Upload, ExternalLink } from "lucide-react"
import { toast } from "@/hooks/use-toast"

interface AddNftModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const popularCollections = [
  { name: "Bored Ape Yacht Club", floorPrice: 125.25, chain: "Ethereum" },
  { name: "CryptoPunks", floorPrice: 180.75, chain: "Ethereum" },
  { name: "Azuki", floorPrice: 30.1, chain: "Ethereum" },
  { name: "Pudgy Penguins", floorPrice: 15.5, chain: "Ethereum" },
  { name: "Doodles", floorPrice: 8.2, chain: "Ethereum" },
]

export function AddNftModal({ open, onOpenChange }: AddNftModalProps) {
  const [method, setMethod] = useState<"manual" | "import">("manual")
  const [collectionName, setCollectionName] = useState("")
  const [tokenId, setTokenId] = useState("")
  const [chain, setChain] = useState("")
  const [purchasePrice, setPurchasePrice] = useState("")
  const [currentValue, setCurrentValue] = useState("")
  const [contractAddress, setContractAddress] = useState("")
  const [walletAddress, setWalletAddress] = useState("")

  const handleAddNft = () => {
    if (method === "manual") {
      if (!collectionName || !tokenId || !chain) {
        toast({
          title: "Missing information",
          description: "Please fill in all required fields.",
          variant: "destructive",
        })
        return
      }
    } else {
      if (!walletAddress) {
        toast({
          title: "Missing wallet address",
          description: "Please enter a wallet address to import NFTs.",
          variant: "destructive",
        })
        return
      }
    }

    // In a real app, you would add the NFT to the portfolio
    toast({
      title: "NFT added",
      description:
        method === "manual"
          ? `${collectionName} #${tokenId} has been added to your portfolio.`
          : "NFTs have been imported from your wallet.",
    })

    // Reset form
    setCollectionName("")
    setTokenId("")
    setChain("")
    setPurchasePrice("")
    setCurrentValue("")
    setContractAddress("")
    setWalletAddress("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add NFT to Portfolio</DialogTitle>
          <DialogDescription>Add NFTs to your portfolio manually or import from your wallet.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Method Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Add Method</CardTitle>
              <CardDescription>Choose how you want to add NFTs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div
                  className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                    method === "manual" ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => setMethod("manual")}
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <Plus className="h-5 w-5" />
                    <span className="font-medium">Manual Entry</span>
                  </div>
                  <div className="text-sm text-muted-foreground">Add individual NFTs manually</div>
                </div>
                <div
                  className={`p-4 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                    method === "import" ? "border-primary bg-primary/5" : ""
                  }`}
                  onClick={() => setMethod("import")}
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <Upload className="h-5 w-5" />
                    <span className="font-medium">Import from Wallet</span>
                  </div>
                  <div className="text-sm text-muted-foreground">Automatically detect NFTs in your wallet</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {method === "manual" ? (
            <>
              {/* Popular Collections */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Popular Collections</CardTitle>
                  <CardDescription>Quick select from popular NFT collections</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 max-h-40 overflow-y-auto">
                    {popularCollections.map((collection, index) => (
                      <div
                        key={index}
                        className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50 ${
                          collectionName === collection.name ? "border-primary bg-primary/5" : ""
                        }`}
                        onClick={() => {
                          setCollectionName(collection.name)
                          setChain(collection.chain.toLowerCase())
                          setCurrentValue(collection.floorPrice.toString())
                        }}
                      >
                        <div>
                          <div className="font-medium">{collection.name}</div>
                          <div className="text-sm text-muted-foreground">{collection.chain}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">Floor: {collection.floorPrice} ETH</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Manual NFT Details */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">NFT Details</CardTitle>
                  <CardDescription>Enter the details of your NFT</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="collectionName">Collection Name *</Label>
                      <Input
                        id="collectionName"
                        placeholder="e.g., Bored Ape Yacht Club"
                        value={collectionName}
                        onChange={(e) => setCollectionName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tokenId">Token ID *</Label>
                      <Input
                        id="tokenId"
                        placeholder="e.g., 1234"
                        value={tokenId}
                        onChange={(e) => setTokenId(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="chain">Blockchain *</Label>
                      <Select value={chain} onValueChange={setChain}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select chain" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ethereum">Ethereum</SelectItem>
                          <SelectItem value="polygon">Polygon</SelectItem>
                          <SelectItem value="solana">Solana</SelectItem>
                          <SelectItem value="bsc">BNB Chain</SelectItem>
                          <SelectItem value="avalanche">Avalanche</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contractAddress">Contract Address</Label>
                      <Input
                        id="contractAddress"
                        placeholder="0x..."
                        value={contractAddress}
                        onChange={(e) => setContractAddress(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="purchasePrice">Purchase Price (ETH)</Label>
                      <Input
                        id="purchasePrice"
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={purchasePrice}
                        onChange={(e) => setPurchasePrice(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currentValue">Current Value (ETH)</Label>
                      <Input
                        id="currentValue"
                        type="number"
                        step="any"
                        placeholder="0.00"
                        value={currentValue}
                        onChange={(e) => setCurrentValue(e.target.value)}
                      />
                    </div>
                  </div>

                  {purchasePrice && currentValue && (
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-sm font-medium mb-2">P&L Summary</div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Total Cost:</span>
                          <span className="ml-2 font-medium">{purchasePrice} ETH</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Current Value:</span>
                          <span className="ml-2 font-medium">{currentValue} ETH</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-muted-foreground">P&L:</span>
                          <span
                            className={`ml-2 font-medium ${
                              Number.parseFloat(currentValue) >= Number.parseFloat(purchasePrice)
                                ? "text-green-500"
                                : "text-red-500"
                            }`}
                          >
                            {(Number.parseFloat(currentValue) - Number.parseFloat(purchasePrice)).toFixed(4)} ETH (
                            {(
                              ((Number.parseFloat(currentValue) - Number.parseFloat(purchasePrice)) /
                                Number.parseFloat(purchasePrice)) *
                              100
                            ).toFixed(2)}
                            %)
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            /* Wallet Import */
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Import from Wallet</CardTitle>
                <CardDescription>Enter your wallet address to automatically detect NFTs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="walletAddress">Wallet Address *</Label>
                  <Input
                    id="walletAddress"
                    placeholder="0x... or ENS name"
                    value={walletAddress}
                    onChange={(e) => setWalletAddress(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll scan this address across multiple blockchains to find your NFTs
                  </p>
                </div>

                <div className="p-4 border rounded-lg bg-muted/50">
                  <div className="flex items-center space-x-2 mb-2">
                    <ExternalLink className="h-4 w-4" />
                    <span className="font-medium">Supported Networks</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Ethereum</Badge>
                    <Badge variant="outline">Polygon</Badge>
                    <Badge variant="outline">Solana</Badge>
                    <Badge variant="outline">BNB Chain</Badge>
                    <Badge variant="outline">Avalanche</Badge>
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  <strong>Note:</strong> This will import all NFTs found in the specified wallet. You can remove
                  unwanted items after import.
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddNft}>
            <Plus className="mr-2 h-4 w-4" />
            {method === "manual" ? "Add NFT" : "Import NFTs"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
