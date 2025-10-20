"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { WalletBadge } from "../shared/wallet-badge"
import { walletTypes } from "../../data"

interface ConnectWalletDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectWalletDialog({ open, onOpenChange }: ConnectWalletDialogProps) {
  const handleConnect = (walletId: string) => {
    // Handle wallet connection logic here
    console.log("Connecting to wallet:", walletId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect Wallet</DialogTitle>
          <DialogDescription>Choose a wallet provider to connect to your account</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {walletTypes.map((wallet) => (
            <Button
              key={wallet.id}
              variant="outline"
              className="flex items-center justify-start gap-3 h-14"
              onClick={() => handleConnect(wallet.id)}
            >
              <WalletBadge walletType={wallet.id} size="lg" />
              <span className="font-medium">{wallet.name}</span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
