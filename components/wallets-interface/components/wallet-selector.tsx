"use client"

import { Button } from "@/components/ui/button"
import { WalletBadge } from "./shared/wallet-badge"
import { wallets } from "../data"

interface WalletSelectorProps {
  activeWallet: string
  onWalletChange: (walletId: string) => void
}

export function WalletSelector({ activeWallet, onWalletChange }: WalletSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {wallets.map((wallet) => (
        <Button
          key={wallet.id}
          variant={activeWallet === wallet.id ? "default" : "outline"}
          className="flex items-center gap-2"
          onClick={() => onWalletChange(wallet.id)}
        >
          <WalletBadge walletType={wallet.type} size="sm" />
          <span>{wallet.name}</span>
        </Button>
      ))}
    </div>
  )
}
