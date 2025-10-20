"use client"

import { useState } from "react"
import { Plus, MoreHorizontal, QrCode, Zap, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"

interface WalletActionsProps {
  onConnectWallet: () => void
  onAddressBook: () => void
  onBackup: () => void
  onSecurity: () => void
}

export function WalletActions({ onConnectWallet, onAddressBook, onBackup, onSecurity }: WalletActionsProps) {
  const [showQrCode, setShowQrCode] = useState(false)
  const [showSpeedUp, setShowSpeedUp] = useState(false)
  const [showRemoveWallet, setShowRemoveWallet] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [gasPrice, setGasPrice] = useState("")
  const { toast } = useToast()

  const walletAddress = "0x742d35Cc6634C0532925a3b8D4C9db96590b5c8e" // Mock wallet address

  const handleShowQrCode = () => {
    setShowQrCode(true)
  }

  const handleSpeedUpTransaction = () => {
    setShowSpeedUp(true)
  }

  const handleRefreshBalance = async () => {
    setIsRefreshing(true)
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsRefreshing(false)
    toast({
      title: "Balance Refreshed",
      description: "Your wallet balance has been updated successfully.",
    })
  }

  const handleRemoveWallet = () => {
    setShowRemoveWallet(true)
  }

  const confirmRemoveWallet = () => {
    toast({
      title: "Wallet Removed",
      description: "The wallet has been removed from your account.",
      variant: "destructive",
    })
    setShowRemoveWallet(false)
  }

  const handleSpeedUpSubmit = () => {
    if (!gasPrice) return

    toast({
      title: "Transaction Sped Up",
      description: `Transaction has been resubmitted with ${gasPrice} Gwei gas price.`,
    })
    setShowSpeedUp(false)
    setGasPrice("")
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="flex items-center gap-2 bg-transparent" onClick={onConnectWallet}>
          <Plus className="h-4 w-4" />
          <span>Connect Wallet</span>
        </Button>

        <Button variant="outline" size="sm" onClick={onAddressBook}>
          Address Book
        </Button>

        <Button variant="outline" size="sm" onClick={onBackup}>
          Backup & Recovery
        </Button>

        <Button variant="outline" size="sm" onClick={onSecurity}>
          Security Settings
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Wallet Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleShowQrCode}>
              <QrCode className="mr-2 h-4 w-4" />
              <span>Show QR Code</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSpeedUpTransaction}>
              <Zap className="mr-2 h-4 w-4" />
              <span>Speed Up Transaction</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRefreshBalance} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Refreshing..." : "Refresh Balance"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={handleRemoveWallet}>
              <Trash2 className="mr-2 h-4 w-4" />
              <span>Remove Wallet</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* QR Code Modal */}
      <Dialog open={showQrCode} onOpenChange={setShowQrCode}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Wallet QR Code</DialogTitle>
            <DialogDescription>Scan this QR code to share your wallet address</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center space-y-4">
            <div className="w-48 h-48 bg-white border-2 border-gray-200 rounded-lg flex items-center justify-center">
              <div className="text-center">
                <QrCode className="h-24 w-24 mx-auto mb-2 text-gray-400" />
                <p className="text-sm text-gray-500">QR Code</p>
              </div>
            </div>
            <div className="w-full">
              <Label htmlFor="address">Wallet Address</Label>
              <Input
                id="address"
                value={walletAddress}
                readOnly
                className="mt-1"
                onClick={(e) => e.currentTarget.select()}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(walletAddress)
                toast({
                  title: "Address Copied",
                  description: "Wallet address has been copied to clipboard.",
                })
              }}
              className="w-full"
            >
              Copy Address
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Speed Up Transaction Modal */}
      <Dialog open={showSpeedUp} onOpenChange={setShowSpeedUp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Speed Up Transaction</DialogTitle>
            <DialogDescription>Increase the gas price to speed up your pending transaction</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="gasPrice">New Gas Price (Gwei)</Label>
              <Input
                id="gasPrice"
                type="number"
                placeholder="Enter gas price"
                value={gasPrice}
                onChange={(e) => setGasPrice(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm text-yellow-800">
                <strong>Note:</strong> You&apos;ll need to pay additional gas fees to speed up the transaction.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowSpeedUp(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSpeedUpSubmit} disabled={!gasPrice} className="flex-1">
                Speed Up
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remove Wallet Confirmation */}
      <AlertDialog open={showRemoveWallet} onOpenChange={setShowRemoveWallet}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Wallet</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this wallet? This action cannot be undone. Make sure you have backed up
              your wallet before proceeding.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveWallet}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Wallet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
