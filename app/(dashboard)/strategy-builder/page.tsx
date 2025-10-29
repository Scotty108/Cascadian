"use client"

import type React from "react"

import { useState, useCallback, useRef, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Play, Download, Upload, Menu, X, ArrowLeft, Workflow, Save, Trash2, Loader2, Sparkles, LayoutGrid, Settings, Activity } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

// Strategy-specific nodes
import {
  DataSourceNode,
  FilterNode,
  LogicNode,
  AggregationNode,
  SignalNode,
  ActionNode,
  WatchlistNode,
  EnhancedFilterNode,
  OrchestratorNode,
} from "@/components/strategy-nodes"

import { NodePalette } from "@/components/node-palette"
import { NodeConfigPanel } from "@/components/node-config-panel"
import { ResultsPreview } from "@/components/strategy-builder/results-preview"
import { StrategyLibrary } from "@/components/strategy-library"
import { ConversationalChat } from "@/components/workflow-editor/ConversationalChat"
import StrategySettingsDialog, { type StrategySettings } from "@/components/strategy-builder/strategy-settings-dialog"
import DeploymentConfigDialog, { type DeploymentConfig } from "@/components/strategy-builder/deployment-config-dialog"
import type { StrategyResult, StrategyDefinition } from "@/lib/strategy-builder/types"
import { calculateAutoLayout } from "@/lib/workflow/layout/dagre-layout"

const STORAGE_KEY = "strategy-builder-workflow"

const nodeTypes = {
  DATA_SOURCE: DataSourceNode as any,
  WALLET_FILTER: FilterNode as any,
  MARKET_FILTER: FilterNode as any,
  ENHANCED_FILTER: EnhancedFilterNode as any,
  LOGIC: LogicNode as any,
  AGGREGATION: AggregationNode as any,
  SIGNAL: SignalNode as any,
  ACTION: ActionNode as any,
  "add-to-watchlist": WatchlistNode as any,
  ORCHESTRATOR: OrchestratorNode as any,
}

const getDefaultNodeData = (type: string) => {
  switch (type) {
    case "DATA_SOURCE":
      return {
        config: {
          source: "WALLETS",
          mode: "BATCH",
          prefilters: {
            table: "wallet_metrics_complete",
            limit: 1000,
          },
        },
      }
    case "WALLET_FILTER":
      return {
        config: {
          filter_type: "WALLET_FILTER",
          categories: [],
          conditions: [],
          sorting: {
            primary: "omega DESC",
            secondary: "win_rate_30d DESC",
            tertiary: "pnl_30d DESC",
          },
          limit: 50,
        },
      }
    case "MARKET_FILTER":
      return {
        config: {
          filter_type: "MARKET_FILTER",
          categories: [],
          conditions: [],
          sorting: {
            primary: "volume_24h DESC",
            secondary: "liquidity DESC",
          },
          limit: 100,
        },
      }
    case "ENHANCED_FILTER":
      return {
        config: {
          conditions: [
            {
              id: `condition-${Date.now()}`,
              field: "",
              operator: "EQUALS",
              value: "",
              fieldType: "string",
            },
          ],
          logic: "AND",
          version: 2,
        },
      }
    case "LOGIC":
      return {
        config: {
          operator: "AND",
          inputs: [],
        },
      }
    case "AGGREGATION":
      return {
        config: {
          function: "COUNT",
        },
      }
    case "SIGNAL":
      return {
        config: {
          signalType: "ENTRY",
          condition: "",
          direction: "YES",
          strength: "MODERATE",
        },
      }
    case "ACTION":
      return {
        config: {
          action: "ADD_TO_WATCHLIST",
        },
      }
    case "add-to-watchlist":
      return {
        config: {
          reason: "smart-flow",
          category: "",
          autoMonitor: true,
        },
      }
    case "ORCHESTRATOR":
      return {
        config: {
          version: 1,
          mode: "approval",
          portfolio_size_usd: 10000,
          risk_tolerance: 5,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.375,
            max_per_position: 0.05,
            min_bet: 5,
            max_bet: 500,
            portfolio_heat_limit: 0.50,
            risk_reward_threshold: 2.0,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
            volatility_adjustment: {
              enabled: false,
            },
          },
        },
      }
    default:
      return {}
  }
}

export default function StrategyBuilderPage() {
  const searchParams = useSearchParams()
  const editStrategyId = searchParams.get("edit")
  const { toast } = useToast()

  // View state
  const [viewMode, setViewMode] = useState<"library" | "builder">(editStrategyId ? "builder" : "library")
  const [currentStrategyId, setCurrentStrategyId] = useState<string | null>(editStrategyId)
  const [currentStrategyName, setCurrentStrategyName] = useState<string>("Untitled Strategy")
  const [loadingStrategy, setLoadingStrategy] = useState(false)

  // Builder state
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [showExecution, setShowExecution] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const nodeIdCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)

  // Execution state
  const [executionResult, setExecutionResult] = useState<StrategyResult | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)

  // Strategy settings state
  const [strategySettings, setStrategySettings] = useState<StrategySettings>({
    strategy_name: "Untitled Strategy",
    trading_mode: "paper",
    paper_bankroll_usd: 10000,
  })
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showDeploymentDialog, setShowDeploymentDialog] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)

  // Deployment status tracking
  const [isDeployed, setIsDeployed] = useState(false)
  const [deploymentStatus, setDeploymentStatus] = useState<"running" | "paused" | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [lastDeployedNodeGraph, setLastDeployedNodeGraph] = useState<any>(null)

  useEffect(() => {
    const maxId = Math.max(...nodes.map((n) => Number.parseInt(n.id) || 0), 0)
    nodeIdCounter.current = maxId + 1
  }, [nodes])

  // Auto-save functionality - debounced to avoid excessive saves
  useEffect(() => {
    if (!currentStrategyId || nodes.length === 0) return

    const autoSaveTimer = setTimeout(async () => {
      try {
        const nodeGraph = {
          nodes: nodes.map((node) => ({
            id: node.id,
            type: node.type as any,
            config: node.data.config || {},
          })),
          edges: edges.map((edge) => ({
            from: edge.source,
            to: edge.target,
          })),
        }

        await fetch(`/api/strategies/${currentStrategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: strategySettings.strategy_name,
            node_graph: nodeGraph,
            trading_mode: strategySettings.trading_mode,
            paper_bankroll_usd: strategySettings.paper_bankroll_usd,
          }),
        })

        // Check if changes differ from last deployment
        if (lastDeployedNodeGraph) {
          const currentGraph = JSON.stringify(nodeGraph)
          const deployedGraph = JSON.stringify(lastDeployedNodeGraph)
          setHasUnsavedChanges(currentGraph !== deployedGraph)
        }
      } catch (error) {
        console.error('Auto-save failed:', error)
      }
    }, 2000) // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(autoSaveTimer)
  }, [nodes, edges, currentStrategyId, strategySettings, lastDeployedNodeGraph])

  // Load strategy if editing
  useEffect(() => {
    if (editStrategyId) {
      loadStrategy(editStrategyId)
    }
  }, [editStrategyId])

  const loadStrategy = async (strategyId: string) => {
    setLoadingStrategy(true)
    try {
      const response = await fetch(`/api/strategies/${strategyId}`, {
        signal: AbortSignal.timeout(10000) // 10 second timeout
      })
      if (!response.ok) {
        throw new Error("Failed to load strategy")
      }

      const data = await response.json()
      const strategy = data.strategy as StrategyDefinition

      setCurrentStrategyName(strategy.strategyName)
      setCurrentStrategyId(strategy.strategyId)

      // Load strategy settings including trading mode
      setStrategySettings({
        strategy_name: strategy.strategyName,
        trading_mode: (strategy as any).trading_mode || "paper",
        paper_bankroll_usd: (strategy as any).paper_bankroll_usd || 10000,
      })

      // Check deployment status
      const deployedStatus = (strategy as any).is_active ? "running" : "paused"
      setIsDeployed((strategy as any).execution_mode === "SCHEDULED")
      setDeploymentStatus(deployedStatus)

      // Store deployed node graph for change tracking
      setLastDeployedNodeGraph(strategy.nodeGraph)
      setHasUnsavedChanges(false)

      // Convert backend node format to React Flow format
      const reactFlowNodes = strategy.nodeGraph.nodes.map((node, index) => ({
        id: node.id,
        type: node.type,
        position: { x: 100 + index * 250, y: 100 + (index % 3) * 150 },
        data: { config: (node as any).config },
      }))

      const reactFlowEdges = strategy.nodeGraph.edges.map((edge, index) => ({
        id: `e${index}`,
        source: edge.from,
        target: edge.to,
      }))

      setNodes(reactFlowNodes)
      setEdges(reactFlowEdges)
    } catch (error: any) {
      console.error("Error loading strategy:", error)
      toast({
        title: "Database connection issue",
        description: "Could not load strategy. Starting with a blank canvas.",
        variant: "destructive",
      })
      // Allow user to continue with blank canvas
      setViewMode("builder")
    } finally {
      setLoadingStrategy(false)
    }
  }

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange: OnEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const onConnect: OnConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
    setShowExecution(false)
    setShowAIChat(false)
    setIsPaletteOpen(false)
  }, [])

  const onAddNode = useCallback(
    (type: string) => {
      if (!reactFlowInstance) return

      const newNode: Node = {
        id: `${type.toLowerCase()}_${Date.now()}_${nodeIdCounter.current++}`,
        type,
        position: reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
        data: getDefaultNodeData(type),
      }

      setNodes((nds) => [...nds, newNode])
      setIsPaletteOpen(false)
    },
    [reactFlowInstance],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      if (!reactFlowWrapper.current || !reactFlowInstance) return

      const type = event.dataTransfer.getData("application/reactflow")
      if (!type) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })

      const newNode: Node = {
        id: `${type.toLowerCase()}_${Date.now()}_${nodeIdCounter.current++}`,
        type,
        position,
        data: getDefaultNodeData(type),
      }

      setNodes((nds) => [...nds, newNode])
    },
    [reactFlowInstance],
  )

  const onUpdateNode = useCallback((nodeId: string, data: any) => {
    setNodes((nds) => nds.map((node) => (node.id === nodeId ? { ...node, data } : node)))
    setSelectedNode((node) => (node?.id === nodeId ? { ...node, data } : node))
  }, [])

  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setSelectedNode(null)
  }, [])

  const handleExportWorkflow = useCallback(() => {
    const workflow = { nodes, edges, name: currentStrategyName, id: currentStrategyId }
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${currentStrategyName.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [nodes, edges, currentStrategyName, currentStrategyId])

  const handleImportWorkflow = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string
          const workflow = JSON.parse(content)

          if (workflow.nodes && workflow.edges) {
            setNodes(workflow.nodes)
            setEdges(workflow.edges)
            setCurrentStrategyName(workflow.name || "Imported Strategy")
            setCurrentStrategyId(workflow.id || null)

            const maxId = Math.max(
              ...workflow.nodes.map((n: Node) => {
                const parts = n.id.split("_")
                return Number.parseInt(parts[parts.length - 1]) || 0
              }),
              0,
            )
            nodeIdCounter.current = maxId + 1

            toast({
              title: "Strategy imported",
              description: "Workflow loaded successfully",
            })
          } else {
            throw new Error("Invalid workflow format")
          }
        } catch (error) {
          console.error("Failed to import workflow:", error)
          toast({
            title: "Import failed",
            description: "Please check the file format",
            variant: "destructive",
          })
        }
      }
      reader.readAsText(file)

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [],
  )

  const handleOpenDeployDialog = useCallback(async () => {
    if (nodes.length === 0) {
      toast({
        title: "No nodes",
        description: "Add nodes to your strategy before deploying",
        variant: "destructive",
      })
      return
    }

    // Save strategy first if it doesn't exist
    if (!currentStrategyId) {
      await handleSaveWorkflow()
    }

    // Open deployment dialog
    setShowDeploymentDialog(true)
  }, [nodes, currentStrategyId])

  const handleDeploy = useCallback(async (deployConfig: DeploymentConfig) => {
    setIsDeploying(true)

    try {
      // Convert React Flow format to backend format
      const nodeGraph = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type as any,
          config: node.data.config || {},
        })),
        edges: edges.map((edge) => ({
          from: edge.source,
          to: edge.target,
        })),
      }

      // Map frequency to cron expression
      const frequencyToCron: Record<string, string> = {
        '1min': '* * * * *',
        '5min': '*/5 * * * *',
        '15min': '*/15 * * * *',
        '30min': '*/30 * * * *',
        '1hour': '0 * * * *',
      }

      const deploymentType = isDeployed ? 'redeploy' : 'initial'
      let strategyId = currentStrategyId

      // Update or create strategy with deployment config
      if (currentStrategyId) {
        // Update existing strategy
        const response = await fetch(`/api/strategies/${currentStrategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: strategySettings.strategy_name,
            node_graph: nodeGraph,
            execution_mode: "SCHEDULED",
            schedule_cron: frequencyToCron[deployConfig.execution_frequency],
            is_active: deployConfig.auto_start,
            trading_mode: deployConfig.trading_mode,
            paper_bankroll_usd: deployConfig.paper_bankroll_usd,
          }),
        })

        if (!response.ok) throw new Error("Failed to update strategy")
      } else {
        // Create new strategy
        const response = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: strategySettings.strategy_name,
            strategy_type: "CUSTOM",
            node_graph: nodeGraph,
            is_predefined: false,
            execution_mode: "SCHEDULED",
            schedule_cron: frequencyToCron[deployConfig.execution_frequency],
            is_active: deployConfig.auto_start,
            trading_mode: deployConfig.trading_mode,
            paper_bankroll_usd: deployConfig.paper_bankroll_usd,
          }),
        })

        if (!response.ok) throw new Error("Failed to create strategy")

        const data = await response.json()
        strategyId = data.strategy_id
        setCurrentStrategyId(strategyId)
      }

      // Create deployment record
      await fetch(`/api/strategies/${strategyId}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deployment_type: deploymentType,
          node_graph: nodeGraph,
          trading_mode: deployConfig.trading_mode,
          paper_bankroll_usd: deployConfig.paper_bankroll_usd,
          execution_mode: "SCHEDULED",
          schedule_cron: frequencyToCron[deployConfig.execution_frequency],
          changes_summary: hasUnsavedChanges ? "Updated workflow configuration" : "Initial deployment",
        }),
      })

      // Start the strategy if auto_start is enabled
      if (deployConfig.auto_start && strategyId) {
        await fetch(`/api/strategies/${strategyId}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      }

      // Check if strategy has ORCHESTRATOR with copy trading enabled
      const orchestratorNode = nodes.find(n => n.type === 'ORCHESTRATOR');
      const config = orchestratorNode?.data?.config as any;
      if (config?.copy_trading?.enabled && strategyId) {
        try {
          await fetch('/api/trading/activate-monitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              strategy_id: strategyId,
              config: config.copy_trading
            })
          });
          console.log('[Deploy] Copy trading monitor activated');
        } catch (monitorError) {
          console.error('[Deploy] Failed to activate copy trading monitor:', monitorError);
          // Non-fatal error - dont fail the deployment
        }
      }


      // Update deployment state
      setIsDeployed(true)
      setDeploymentStatus(deployConfig.auto_start ? "running" : "paused")
      setLastDeployedNodeGraph(nodeGraph)
      setHasUnsavedChanges(false)
      setShowDeploymentDialog(false)

      toast({
        title: isDeployed ? "Strategy redeployed!" : "Strategy deployed!",
        description: `${strategySettings.strategy_name} is now ${deployConfig.auto_start ? 'running' : 'paused'} in ${deployConfig.trading_mode} mode`,
      })
    } catch (error: any) {
      console.error("Deployment error:", error)
      toast({
        title: "Deployment failed",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setIsDeploying(false)
    }
  }, [nodes, edges, currentStrategyId, strategySettings, isDeployed, hasUnsavedChanges, toast])

  // Keep the old test run functionality for quick testing
  const handleTestRun = useCallback(async () => {
    if (nodes.length === 0) {
      toast({
        title: "No nodes",
        description: "Add nodes to your strategy before executing",
        variant: "destructive",
      })
      return
    }

    setIsExecuting(true)
    setShowExecution(true)
    setShowAIChat(false)
    setSelectedNode(null)
    setExecutionResult(null)

    try {
      // Convert React Flow format to backend format
      const nodeGraph = {
        nodes: nodes.map((node) => ({
          id: node.id,
          type: node.type as any,
          config: node.data.config || {},
        })),
        edges: edges.map((edge) => ({
          from: edge.source,
          to: edge.target,
        })),
      }

      // Create temporary strategy or use existing one
      let strategyId = currentStrategyId

      if (!strategyId) {
        // Save strategy first
        const saveResponse = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: currentStrategyName,
            strategy_type: "CUSTOM",
            node_graph: nodeGraph,
            is_predefined: false,
            execution_mode: "MANUAL",
            is_active: true,
          }),
        })

        if (!saveResponse.ok) {
          throw new Error("Failed to save strategy")
        }

        const saveData = await saveResponse.json()
        strategyId = saveData.strategy_id
        setCurrentStrategyId(strategyId)
      }

      // Execute strategy
      const response = await fetch("/api/strategies/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: strategyId,
        }),
      })

      if (!response.ok) {
        throw new Error("Strategy execution failed")
      }

      const data = await response.json()

      // Convert to StrategyResult format
      const result: StrategyResult = {
        executionId: data.execution_id,
        strategyId: data.strategy_id,
        results: data.detailed_results || {},
        aggregations: data.results.aggregations,
        signalsGenerated: [],
        actionsExecuted: [],
        totalExecutionTimeMs: data.execution_time_ms,
        nodesEvaluated: data.nodes_evaluated,
        dataPointsProcessed: data.data_points_processed,
        status: data.status,
      }

      setExecutionResult(result)

      toast({
        title: "Execution complete",
        description: `Processed ${result.dataPointsProcessed.toLocaleString()} data points in ${result.totalExecutionTimeMs}ms`,
      })
    } catch (error: any) {
      console.error("Execution error:", error)
      toast({
        title: "Execution failed",
        description: error.message,
        variant: "destructive",
      })

      setExecutionResult({
        executionId: crypto.randomUUID(),
        strategyId: currentStrategyId || "",
        results: {},
        totalExecutionTimeMs: 0,
        nodesEvaluated: 0,
        dataPointsProcessed: 0,
        status: "FAILED",
        errorMessage: error.message,
      })
    } finally {
      setIsExecuting(false)
    }
  }, [nodes, edges, currentStrategyId, currentStrategyName])

  const handleCreateNewStrategy = useCallback(() => {
    setCurrentStrategyId(null)
    setCurrentStrategyName("Untitled Strategy")
    setNodes([])
    setEdges([])
    setViewMode("builder")
    setExecutionResult(null)
    setShowExecution(false)
    setShowAIChat(false)
    setSelectedNode(null)
  }, [])

  const handleEditStrategy = useCallback((strategyId: string) => {
    setCurrentStrategyId(strategyId)
    setViewMode("builder")
    loadStrategy(strategyId)
  }, [])

  const handleBackToLibrary = useCallback(() => {
    setViewMode("library")
    setCurrentStrategyId(null)
    setSelectedNode(null)
    setShowExecution(false)
    setShowAIChat(false)
    setExecutionResult(null)
    window.history.replaceState({}, "", "/strategy-builder")
  }, [])

  const handleSaveWorkflow = useCallback(async () => {
    // Save to localStorage as backup
    const workflow = { nodes, edges, name: currentStrategyName, id: currentStrategyId }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflow))

    // Convert to backend format
    const nodeGraph = {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type as any,
        config: node.data.config || {},
      })),
      edges: edges.map((edge) => ({
        from: edge.source,
        to: edge.target,
      })),
    }

    try {
      if (currentStrategyId) {
        // Update existing strategy
        const response = await fetch(`/api/strategies/${currentStrategyId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: strategySettings.strategy_name,
            node_graph: nodeGraph,
            trading_mode: strategySettings.trading_mode,
            paper_bankroll_usd: strategySettings.paper_bankroll_usd,
          }),
        })

        if (!response.ok) throw new Error("Failed to update strategy")

        toast({
          title: "Strategy saved",
          description: "Your changes have been saved",
        })
      } else {
        // Create new strategy
        const response = await fetch("/api/strategies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strategy_name: strategySettings.strategy_name,
            strategy_type: "CUSTOM",
            node_graph: nodeGraph,
            is_predefined: false,
            execution_mode: "MANUAL",
            is_active: true,
            trading_mode: strategySettings.trading_mode,
            paper_bankroll_usd: strategySettings.paper_bankroll_usd,
          }),
        })

        if (!response.ok) throw new Error("Failed to create strategy")

        const data = await response.json()
        setCurrentStrategyId(data.strategy_id)

        toast({
          title: "Strategy created",
          description: "Your strategy has been saved",
        })
      }
    } catch (error: any) {
      console.error("Save error:", error)
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }, [nodes, edges, strategySettings, currentStrategyId])

  const handleSettingsSave = useCallback((newSettings: StrategySettings) => {
    setStrategySettings(newSettings)
    setCurrentStrategyName(newSettings.strategy_name)
    toast({
      title: "Settings updated",
      description: "Strategy settings have been updated. Don't forget to save your strategy.",
    })
  }, [toast])

  const handleClearCanvas = useCallback(() => {
    if (confirm("Clear the entire canvas? This will remove all nodes and edges.")) {
      setNodes([])
      setEdges([])
      setSelectedNode(null)
      setCurrentStrategyName("Untitled Strategy")
      setExecutionResult(null)
      setShowExecution(false)
      setShowAIChat(false)
    }
  }, [])

  const handleAutoLayout = useCallback(() => {
    if (nodes.length === 0) {
      toast({
        title: "No nodes to layout",
        description: "Add nodes to your strategy before using auto-layout",
        variant: "destructive",
      })
      return
    }

    try {
      // Convert ReactFlow nodes/edges to layout format
      const layoutNodes = nodes.map(node => ({
        id: node.id,
        width: node.width || 200,
        height: node.height || 100,
      }))

      const layoutEdges = edges.map(edge => ({
        source: edge.source,
        target: edge.target,
      }))

      // Calculate new positions
      const positions = calculateAutoLayout(layoutNodes, layoutEdges, {
        direction: 'LR', // Left-to-right layout
        rankSeparation: 150,
        nodeSeparation: 80,
      })

      // Update node positions
      setNodes(nodes => nodes.map(node => ({
        ...node,
        position: positions[node.id] || node.position
      })))

      toast({
        title: "Layout applied",
        description: "Nodes have been automatically arranged",
      })
    } catch (error: any) {
      console.error("Auto-layout error:", error)
      toast({
        title: "Layout failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }, [nodes, edges, toast])

  // Show library view
  if (viewMode === "library") {
    return <StrategyLibrary onCreateNew={handleCreateNewStrategy} onEditStrategy={handleEditStrategy} />
  }

  // Show loading state
  if (loadingStrategy) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b] h-[calc(100vh-120px)] flex flex-col overflow-hidden">
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA] mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">Loading strategy...</p>
          </div>
        </div>
      </Card>
    )
  }

  // Show builder view
  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b] h-[calc(100vh-120px)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border/50 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleBackToLibrary}
                aria-label="Back to library"
                className="h-8 w-8 rounded-lg transition hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted border border-border">
                <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Strategy Builder</span>
              </div>
              {isDeployed && (
                <Badge variant="outline" className={deploymentStatus === "running" ? "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400" : "border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400"}>
                  <Activity className="h-3 w-3 mr-1" />
                  {deploymentStatus === "running" ? "Running" : "Paused"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportWorkflow}
              className="hidden"
              aria-label="Import workflow"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAutoLayout}
              className="gap-2"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden md:inline">Layout</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSettingsDialog(true)}
              className="gap-2"
            >
              <Settings className="h-4 w-4" />
              <span className="hidden md:inline">Settings</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveWorkflow}
              className="gap-2"
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAIChat(!showAIChat)
                setSelectedNode(null)
                setShowExecution(false)
              }}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden md:inline">AI</span>
            </Button>
            <Button
              size="sm"
              onClick={handleOpenDeployDialog}
              disabled={isDeploying}
              className={`gap-2 rounded-full shadow-lg transition disabled:opacity-50 ${
                isDeployed && !hasUnsavedChanges
                  ? deploymentStatus === "running"
                    ? "bg-green-600 text-white shadow-green-600/30 hover:bg-green-600/90"
                    : "bg-orange-500 text-white shadow-orange-500/30 hover:bg-orange-500/90"
                  : "bg-[#00E0AA] text-slate-950 shadow-[#00E0AA]/30 hover:bg-[#00E0AA]/90"
              }`}
            >
              {isDeploying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isDeployed ? "Redeploying..." : "Deploying..."}
                </>
              ) : isDeployed && !hasUnsavedChanges ? (
                <>
                  <Play className="h-4 w-4" />
                  {deploymentStatus === "running" ? "Running" : "Paused"}
                </>
              ) : isDeployed && hasUnsavedChanges ? (
                <>
                  <Play className="h-4 w-4" />
                  Redeploy
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Deploy
                </>
              )}
            </Button>
            </div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">{currentStrategyName}</h1>
          <p className="text-sm text-muted-foreground">
            Build and execute wallet screening strategies
          </p>
        </div>

        {/* Main Content */}
        <div className="relative flex flex-1 overflow-hidden min-h-0">
          {/* Mobile overlay */}
          <div
            className={`${isPaletteOpen ? "fixed inset-0 z-40 bg-black/50 md:hidden" : "hidden"}`}
            onClick={() => setIsPaletteOpen(false)}
            aria-hidden="true"
          />

          {/* AI Chat - Far Left (when toggled) */}
          {showAIChat && (
            <div className="shrink-0 w-[400px] h-full border-r border-border/40 bg-card flex flex-col overflow-hidden">
              <ConversationalChat
                nodes={nodes}
                edges={edges}
                onNodesChange={setNodes}
                onEdgesChange={setEdges}
                onCollapse={() => setShowAIChat(false)}
              />
            </div>
          )}

          {/* Node Palette - Left (after AI if shown) */}
          <div
            className={`${
              isPaletteOpen ? "fixed left-0 top-[120px] z-50 h-[calc(100vh-120px)]" : "hidden"
            } md:block md:relative md:top-0 md:z-auto md:h-auto shrink-0`}
          >
            <NodePalette onAddNode={onAddNode} onClose={() => setIsPaletteOpen(false)} />
          </div>

          {/* React Flow Canvas - Middle (flex-1 takes remaining space) */}
          <div className="flex-1 min-w-0" ref={reactFlowWrapper}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onInit={setReactFlowInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              minZoom={0.5}
              maxZoom={2}
              defaultViewport={{ x: 0, y: 0, zoom: 1 }}
              proOptions={{ hideAttribution: true }}
              className="bg-background"
            >
              <Background className="bg-background" gap={16} size={1} />
              <Controls
                className="rounded-2xl border border-border/60 shadow-lg [&_button]:!bg-card [&_button]:!border-b [&_button]:!border-border/60 [&_button]:!text-foreground [&_button:hover]:!bg-accent"
                showInteractive={false}
              />
              <MiniMap
                pannable
                zoomable
                className="rounded-2xl border border-border/60 shadow-lg"
                style={{
                  backgroundColor: 'hsl(var(--card))',
                }}
                maskColor="rgba(0, 0, 0, 0.6)"
                nodeColor={(node) => {
                  switch (node.type) {
                    case 'DATA_SOURCE':
                      return 'rgb(59, 130, 246)' // blue-500
                    case 'FILTER':
                      return 'rgb(168, 85, 247)' // purple-500
                    case 'LOGIC':
                      return 'rgb(34, 197, 94)' // green-500
                    case 'AGGREGATION':
                      return 'rgb(249, 115, 22)' // orange-500
                    case 'SIGNAL':
                      return 'rgb(20, 184, 166)' // teal-500
                    case 'ACTION':
                      return 'rgb(236, 72, 153)' // pink-500
                    default:
                      return 'rgb(148, 163, 184)' // slate-400
                  }
                }}
              />
            </ReactFlow>
          </div>

          {/* Node Config Panel - Right Side (when node selected) */}
          {selectedNode && !showExecution && (
            <NodeConfigPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onUpdate={onUpdateNode}
              onDelete={handleDeleteNode}
            />
          )}

          {/* Execution Results - Right Side (when running) */}
          {showExecution && (
            <div className="shrink-0 w-[400px] border-l border-border/40 bg-background overflow-auto">
              <div className="p-4">
                <ResultsPreview result={executionResult} loading={isExecuting} />
              </div>
            </div>
          )}
        </div>

      {/* Strategy Settings Dialog */}
      <StrategySettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
        settings={strategySettings}
        onSave={handleSettingsSave}
        hasOpenPositions={false} // TODO: Fetch actual open positions count from paper_trades
      />

      {/* Deployment Configuration Dialog */}
      <DeploymentConfigDialog
        open={showDeploymentDialog}
        onOpenChange={setShowDeploymentDialog}
        strategyName={strategySettings.strategy_name}
        onDeploy={handleDeploy}
        isDeploying={isDeploying}
      />
    </Card>
  )
}
