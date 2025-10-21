"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Link, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Wallet, Building, Globe, Zap, Activity } from "lucide-react"
import type { Connection } from "../../types"
import { getRelativeTime } from "../../utils"
import { toast } from "sonner"
import { WalletConnectModal } from "@/components/wallet-connect-modal"
import { useWalletConnection } from "@/hooks/use-wallet-connection"
import { CONNECTION_TEMPLATES } from "../../constants"

interface ConnectionsTabProps {
  connections: Connection[]
  onConnectionsChange: (connections: Connection[]) => void
}

export const ConnectionsTab: React.FC<ConnectionsTabProps> = ({ connections, onConnectionsChange }) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const { isConnected, address, balance, disconnect, copyAddress } = useWalletConnection()
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)
  const [showTemplateSelector, setShowTemplateSelector] = useState(true)
  const [newConnection, setNewConnection] = useState({
    name: "",
    type: "exchange" as Connection["type"],
    apiKey: "",
    apiSecret: "",
    permissions: [] as string[],
  })
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = async (connectionId: string) => {
    setIsConnecting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))

      onConnectionsChange(
        connections.map((conn) =>
          conn.id === connectionId ? { ...conn, status: "connected", lastSync: new Date().toISOString() } : conn,
        ),
      )

      toast.success("Connection established successfully")
    } catch (error) {
      toast.error("Failed to establish connection")
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000))

      onConnectionsChange(
        connections.map((conn) => (conn.id === connectionId ? { ...conn, status: "disconnected" } : conn)),
      )

      toast.success("Connection disconnected successfully")
    } catch (error) {
      toast.error("Failed to disconnect")
    }
  }

  const handleRemoveConnection = async (connectionId: string) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))

      onConnectionsChange(connections.filter((conn) => conn.id !== connectionId))

      toast.success("Connection removed successfully")
    } catch (error) {
      toast.error("Failed to remove connection")
    }
  }

  const handleAddConnection = async () => {
    if (!newConnection.name || !newConnection.apiKey) {
      toast.error("Please fill in all required fields")
      return
    }

    setIsConnecting(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000))

      const connection: Connection = {
        id: Date.now().toString(),
        name: newConnection.name,
        type: newConnection.type,
        status: "connected",
        lastSync: new Date().toISOString(),
        permissions: newConnection.permissions,
        icon: "/placeholder.svg?height=32&width=32",
      }

      onConnectionsChange([...connections, connection])

      setNewConnection({
        name: "",
        type: "exchange",
        apiKey: "",
        apiSecret: "",
        permissions: [],
      })
      setIsAddDialogOpen(false)

      toast.success("Connection added successfully")
    } catch (error) {
      toast.error("Failed to add connection")
    } finally {
      setIsConnecting(false)
    }
  }

  const handlePermissionChange = (permission: string, checked: boolean) => {
    if (checked) {
      setNewConnection((prev) => ({
        ...prev,
        permissions: [...prev.permissions, permission],
      }))
    } else {
      setNewConnection((prev) => ({
        ...prev,
        permissions: prev.permissions.filter((p) => p !== permission),
      }))
    }
  }

  const getConnectionIcon = (type: Connection["type"]) => {
    switch (type) {
      case "exchange":
        return Building
      case "wallet":
        return Wallet
      case "service":
        return Globe
      default:
        return Link
    }
  }

  const getStatusColor = (status: Connection["status"]) => {
    switch (status) {
      case "connected":
        return "text-green-600"
      case "disconnected":
        return "text-gray-600"
      case "error":
        return "text-red-600"
      default:
        return "text-gray-600"
    }
  }

  const getStatusIcon = (status: Connection["status"]) => {
    switch (status) {
      case "connected":
        return CheckCircle
      case "disconnected":
        return XCircle
      case "error":
        return AlertTriangle
      default:
        return XCircle
    }
  }

  const availablePermissions = [
    { id: "read", label: "Read", description: "View account information and balances" },
    { id: "trade", label: "Trade", description: "Execute trades and manage orders" },
    { id: "withdraw", label: "Withdraw", description: "Withdraw funds from account" },
  ]

  const formatAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Connections</h2>
          <p className="text-muted-foreground">Manage your connected exchanges, wallets, and services</p>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Connection
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {showTemplateSelector ? "Choose a Connection Type" : `Configure ${selectedTemplate?.name}`}
              </DialogTitle>
              <DialogDescription>
                {showTemplateSelector
                  ? "Select from our pre-configured templates or create a custom connection"
                  : selectedTemplate?.description}
              </DialogDescription>
            </DialogHeader>

            {showTemplateSelector ? (
              <div className="space-y-4">
                {CONNECTION_TEMPLATES.map((category) => (
                  <div key={category.category} className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      {category.category}
                    </h3>
                    <div className="grid gap-2">
                      {category.templates.map((template) => (
                        <Button
                          key={template.name}
                          variant="outline"
                          className="h-auto justify-start p-4 text-left"
                          onClick={() => {
                            setSelectedTemplate(template)
                            setNewConnection({
                              name: template.name,
                              type: template.type,
                              apiKey: "",
                              apiSecret: "",
                              permissions: template.permissions,
                            })
                            setShowTemplateSelector(false)
                          }}
                        >
                          <div className="flex items-start gap-3 w-full">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                              <Zap className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="font-semibold">{template.name}</div>
                              <div className="text-sm text-muted-foreground">{template.description}</div>
                              {template.note && (
                                <div className="text-xs text-muted-foreground italic">{template.note}</div>
                              )}
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {selectedTemplate?.fields && selectedTemplate.fields.length > 0 ? (
                  selectedTemplate.fields.map((field: any) => (
                    <div key={field.name} className="space-y-2">
                      <Label htmlFor={field.name}>
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </Label>
                      <Input
                        id={field.name}
                        type={field.type}
                        value={(newConnection as any)[field.name] || ""}
                        onChange={(e) =>
                          setNewConnection((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        placeholder={field.placeholder}
                        required={field.required}
                      />
                    </div>
                  ))
                ) : (
                  <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                      {selectedTemplate?.note || "This connection will be configured through your browser extension or wallet app."}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  <Label>Permissions</Label>
                  {availablePermissions.map((permission) => (
                    <div key={permission.id} className="flex items-start space-x-3">
                      <Checkbox
                        id={permission.id}
                        checked={newConnection.permissions.includes(permission.id)}
                        onCheckedChange={(checked) => handlePermissionChange(permission.id, checked as boolean)}
                      />
                      <div className="space-y-1">
                        <Label htmlFor={permission.id} className="font-medium">
                          {permission.label}
                        </Label>
                        <p className="text-sm text-muted-foreground">{permission.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              {!showTemplateSelector && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowTemplateSelector(true)
                    setSelectedTemplate(null)
                  }}
                >
                  Back
                </Button>
              )}
              <Button variant="outline" onClick={() => {
                setIsAddDialogOpen(false)
                setShowTemplateSelector(true)
                setSelectedTemplate(null)
              }}>
                Cancel
              </Button>
              {!showTemplateSelector && (
                <Button onClick={handleAddConnection} disabled={isConnecting}>
                  {isConnecting ? "Connecting..." : "Add Connection"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Your API keys are encrypted and stored securely. We recommend using API keys with limited permissions for
          enhanced security.
        </AlertDescription>
      </Alert>

      {/* Polymarket Wallet Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Polymarket Wallet
          </CardTitle>
          <CardDescription>Connect your wallet to trade on Polymarket prediction markets</CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="font-medium">Wallet Connected</span>
                  </div>
                  <div className="text-sm text-muted-foreground font-mono">{formatAddress(address)}</div>
                  <div className="text-sm text-muted-foreground">Balance: {balance} ETH</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={copyAddress}>
                    Copy Address
                  </Button>
                  <Button variant="outline" size="sm" onClick={disconnect}>
                    Disconnect
                  </Button>
                </div>
              </div>
              <Alert>
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  Your wallet is connected and ready to trade on Polymarket. You can now access all trading features.
                </AlertDescription>
              </Alert>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-gray-600" />
                    <span className="font-medium">No Wallet Connected</span>
                  </div>
                  <p className="text-sm text-muted-foreground">Connect your wallet to start trading</p>
                </div>
                <Button onClick={() => setShowWalletModal(true)}>
                  <Wallet className="mr-2 h-4 w-4" />
                  Connect Wallet
                </Button>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  You need to connect a wallet to trade on Polymarket. We support MetaMask, WalletConnect, and Coinbase Wallet.
                </AlertDescription>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connections List with Data Feed Previews */}
      <div className="grid gap-4">
        {connections.map((connection) => {
          const IconComponent = getConnectionIcon(connection.type)
          const StatusIcon = getStatusIcon(connection.status)

          // Mock data feed preview based on connection type
          const getDataFeedPreview = (conn: Connection) => {
            if (conn.status !== "connected") return null

            switch (conn.name) {
              case "OpenAI API":
                return {
                  title: "Recent API Calls",
                  metrics: [
                    { label: "Requests (24h)", value: "1,247" },
                    { label: "Avg Response", value: "1.2s" },
                    { label: "Tokens Used", value: "43.2K" },
                  ]
                }
              case "Anthropic API":
                return {
                  title: "Claude API Activity",
                  metrics: [
                    { label: "Requests (24h)", value: "892" },
                    { label: "Avg Response", value: "0.9s" },
                    { label: "Tokens Used", value: "31.5K" },
                  ]
                }
              case "Google AI API":
                return {
                  title: "Gemini API Status",
                  metrics: [
                    { label: "Requests (24h)", value: "0" },
                    { label: "Quota Remaining", value: "100%" },
                  ]
                }
              case "Polymarket API":
                return {
                  title: "Market Data Feed",
                  metrics: [
                    { label: "Markets Tracked", value: "2,453" },
                    { label: "Last Update", value: "2s ago" },
                    { label: "API Health", value: "99.8%" },
                  ]
                }
              default:
                return null
            }
          }

          const dataFeed = getDataFeedPreview(connection)

          return (
            <Card key={connection.id}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center flex-wrap gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <IconComponent className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-medium">{connection.name}</h3>
                        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                          <StatusIcon className={`h-4 w-4 ${getStatusColor(connection.status)}`} />
                          <span className="capitalize">{connection.status}</span>
                          <span>•</span>
                          <span className="capitalize">{connection.type}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <div className="text-right text-sm">
                      <div className="text-muted-foreground">Last sync</div>
                      <div>{getRelativeTime(connection.lastSync)}</div>
                    </div>

                    <div className="flex space-x-1">
                      {connection.status === "connected" ? (
                        <Button variant="outline" size="sm" onClick={() => handleDisconnect(connection.id)}>
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnect(connection.id)}
                          disabled={isConnecting}
                        >
                          {isConnecting ? "Connecting..." : "Connect"}
                        </Button>
                      )}

                      <Button variant="ghost" size="sm" onClick={() => handleRemoveConnection(connection.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center space-x-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Permissions: </span>
                    <div className="flex space-x-1 mt-1">
                      {connection.permissions.map((permission) => (
                        <Badge key={permission} variant="secondary" className="text-xs">
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Data Feed Preview */}
                {dataFeed && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-muted-foreground">{dataFeed.title}</h4>
                      <Badge variant="outline" className="text-xs">
                        <Activity className="h-3 w-3 mr-1" />
                        Live
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      {dataFeed.metrics.map((metric, idx) => (
                        <div key={idx} className="text-center p-2 bg-muted/50 rounded-lg">
                          <div className="text-sm font-semibold">{metric.value}</div>
                          <div className="text-xs text-muted-foreground">{metric.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {connections.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Link className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No connections yet</h3>
            <p className="text-muted-foreground mb-4">Connect your exchanges, wallets, and services to get started</p>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Connection
            </Button>
          </CardContent>
        </Card>
      )}

      <WalletConnectModal open={showWalletModal} onOpenChange={setShowWalletModal} />
    </div>
  )
}
