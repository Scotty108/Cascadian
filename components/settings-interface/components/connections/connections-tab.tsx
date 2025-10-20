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
import { Link, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Wallet, Building, Globe } from "lucide-react"
import type { Connection } from "../../types"
import { getRelativeTime } from "../../utils"
import { toast } from "sonner"

interface ConnectionsTabProps {
  connections: Connection[]
  onConnectionsChange: (connections: Connection[]) => void
}

export const ConnectionsTab: React.FC<ConnectionsTabProps> = ({ connections, onConnectionsChange }) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Connection</DialogTitle>
              <DialogDescription>Connect a new exchange, wallet, or service to your account</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="connection-name">Connection Name</Label>
                <Input
                  id="connection-name"
                  value={newConnection.name}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Binance Main Account"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="connection-type">Type</Label>
                <select
                  id="connection-type"
                  value={newConnection.type}
                  onChange={(e) =>
                    setNewConnection((prev) => ({ ...prev, type: e.target.value as Connection["type"] }))
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="exchange">Exchange</option>
                  <option value="wallet">Wallet</option>
                  <option value="service">Service</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  value={newConnection.apiKey}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder="Enter your API key"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="api-secret">API Secret</Label>
                <Input
                  id="api-secret"
                  type="password"
                  value={newConnection.apiSecret}
                  onChange={(e) => setNewConnection((prev) => ({ ...prev, apiSecret: e.target.value }))}
                  placeholder="Enter your API secret"
                />
              </div>

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

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddConnection} disabled={isConnecting}>
                {isConnecting ? "Connecting..." : "Add Connection"}
              </Button>
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

      {/* Connections List */}
      <div className="grid gap-4">
        {connections.map((connection) => {
          const IconComponent = getConnectionIcon(connection.type)
          const StatusIcon = getStatusIcon(connection.status)

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

      {/* Connection Summary */}
      {connections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Connection Summary</CardTitle>
            <CardDescription>Overview of your connected services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{connections.length}</div>
                <div className="text-sm text-muted-foreground">Total Connections</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {connections.filter((c) => c.status === "connected").length}
                </div>
                <div className="text-sm text-muted-foreground">Active</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {connections.filter((c) => c.type === "exchange").length}
                </div>
                <div className="text-sm text-muted-foreground">Exchanges</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {connections.filter((c) => c.type === "wallet").length}
                </div>
                <div className="text-sm text-muted-foreground">Wallets</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
