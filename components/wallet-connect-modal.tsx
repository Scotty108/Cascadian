"use client"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useWalletConnection } from "@/hooks/use-wallet-connection"
import { AlertCircle, Loader2 } from "lucide-react"
import Image from "next/image"

interface WalletConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const walletProviders = [
  {
    id: "metamask",
    name: "MetaMask",
    icon: "/placeholder.svg?height=40&width=40",
    description: "Connect using browser wallet",
  },
  {
    id: "walletconnect",
    name: "WalletConnect",
    icon: "/placeholder.svg?height=40&width=40",
    description: "Connect using WalletConnect",
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    icon: "/placeholder.svg?height=40&width=40",
    description: "Connect using Coinbase Wallet",
  },
  {
    id: "phantom",
    name: "Phantom",
    icon: "/placeholder.svg?height=40&width=40",
    description: "Connect using Phantom wallet",
  },
]

export function WalletConnectModal({ open, onOpenChange }: WalletConnectModalProps) {
  const { connect, isConnecting, error, clearError } = useWalletConnection()

  const handleConnect = async (walletId: string) => {
    clearError()
    const success = await connect(walletId)
    if (success) {
      onOpenChange(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!isConnecting) {
      onOpenChange(newOpen)
      if (!newOpen) {
        clearError()
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Connect Wallet</DialogTitle>
          <DialogDescription>Choose a wallet provider to connect to your account and start trading</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-3 py-4">
          {walletProviders.map((wallet) => (
            <Button
              key={wallet.id}
              variant="outline"
              className="flex h-16 items-center justify-start gap-4 p-4"
              onClick={() => handleConnect(wallet.id)}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <Image
                  src={wallet.icon || "/placeholder.svg"}
                  alt={wallet.name}
                  width={32}
                  height={32}
                  className="rounded-md"
                />
              )}
              <div className="flex flex-col items-start">
                <span className="font-medium">{wallet.name}</span>
                <span className="text-xs text-muted-foreground">{wallet.description}</span>
              </div>
            </Button>
          ))}
        </div>

        <div className="text-center text-xs text-muted-foreground">
          By connecting a wallet, you agree to our Terms of Service and Privacy Policy
        </div>
      </DialogContent>
    </Dialog>
  )
}
