"use client"

import { PortfolioSummary } from "./components/portfolio-summary"
import { WalletSelector } from "./components/wallet-selector"
import { WalletActions } from "./components/wallet-actions"
import { WalletDetails } from "./components/wallet-details/wallet-details"
import { ConnectWalletDialog } from "./components/dialogs/connect-wallet-dialog"
import { AddressBookDialog } from "./components/dialogs/address-book-dialog"
import { BackupRecoveryDialog } from "./components/dialogs/backup-recovery-dialog"
import { SecuritySettingsDialog } from "./components/dialogs/security-settings-dialog"
import { useWallet } from "./hooks/use-wallet"

export function WalletsInterface() {
  const {
    activeWallet,
    activeTab,
    activeNetwork,
    currentWallet,
    filteredAssets,
    filteredTransactions,
    showConnectWallet,
    showAddressBook,
    showBackup,
    showSecurity,
    setActiveWallet,
    setActiveTab,
    setActiveNetwork,
    setShowConnectWallet,
    setShowAddressBook,
    setShowBackup,
    setShowSecurity,
  } = useWallet()

  const handleViewAllTransactions = () => {
    setActiveTab("transactions")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallets</h1>
        <p className="text-muted-foreground">Manage your crypto wallets and assets across multiple chains</p>
      </div>

      <PortfolioSummary />

      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <WalletSelector activeWallet={activeWallet} onWalletChange={setActiveWallet} />
        <WalletActions
          onConnectWallet={() => setShowConnectWallet(true)}
          onAddressBook={() => setShowAddressBook(true)}
          onBackup={() => setShowBackup(true)}
          onSecurity={() => setShowSecurity(true)}
        />
      </div>

      {currentWallet && (
        <WalletDetails
          wallet={currentWallet}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          filteredAssets={filteredAssets}
          filteredTransactions={filteredTransactions}
          activeNetwork={activeNetwork}
          onNetworkChange={setActiveNetwork}
          onViewAllTransactions={handleViewAllTransactions}
        />
      )}

      <ConnectWalletDialog open={showConnectWallet} onOpenChange={setShowConnectWallet} />

      <AddressBookDialog open={showAddressBook} onOpenChange={setShowAddressBook} />

      <BackupRecoveryDialog open={showBackup} onOpenChange={setShowBackup} />

      <SecuritySettingsDialog open={showSecurity} onOpenChange={setShowSecurity} />
    </div>
  )
}
