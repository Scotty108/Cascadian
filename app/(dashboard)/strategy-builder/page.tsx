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
import { Play, Download, Upload, Menu, X, ArrowLeft, Workflow, Save, Trash2, Loader2, Sparkles } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

// Strategy-specific nodes
import {
  DataSourceNode,
  FilterNode,
  LogicNode,
  AggregationNode,
  SignalNode,
  ActionNode,
} from "@/components/strategy-nodes"

import { NodePalette } from "@/components/node-palette"
import { NodeConfigPanel } from "@/components/node-config-panel"
import { ResultsPreview } from "@/components/strategy-builder/results-preview"
import { StrategyLibrary } from "@/components/strategy-library"
import { ConversationalChat } from "@/components/workflow-editor/ConversationalChat"
import type { StrategyResult, StrategyDefinition } from "@/lib/strategy-builder/types"

const STORAGE_KEY = "strategy-builder-workflow"

const nodeTypes = {
  DATA_SOURCE: DataSourceNode as any,
  FILTER: FilterNode as any,
  LOGIC: LogicNode as any,
  AGGREGATION: AggregationNode as any,
  SIGNAL: SignalNode as any,
  ACTION: ActionNode as any,
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
    case "FILTER":
      return {
        config: {
          field: "omega_ratio",
          operator: "GREATER_THAN",
          value: 1.5,
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

  useEffect(() => {
    const maxId = Math.max(...nodes.map((n) => Number.parseInt(n.id) || 0), 0)
    nodeIdCounter.current = maxId + 1
  }, [nodes])

  // Load strategy if editing
  useEffect(() => {
    if (editStrategyId) {
      loadStrategy(editStrategyId)
    }
  }, [editStrategyId])

  const loadStrategy = async (strategyId: string) => {
    setLoadingStrategy(true)
    try {
      const response = await fetch(`/api/strategies/${strategyId}`)
      if (!response.ok) {
        throw new Error("Failed to load strategy")
      }

      const data = await response.json()
      const strategy = data.strategy as StrategyDefinition

      setCurrentStrategyName(strategy.strategyName)
      setCurrentStrategyId(strategy.strategyId)

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
        title: "Error loading strategy",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setLoadingStrategy(false)
    }
  }

  const onNodesChange: OnNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [])

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

  const handleExecuteStrategy = useCallback(async () => {
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
            strategy_name: currentStrategyName,
            node_graph: nodeGraph,
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
            strategy_name: currentStrategyName,
            strategy_type: "CUSTOM",
            node_graph: nodeGraph,
            is_predefined: false,
            execution_mode: "MANUAL",
            is_active: true,
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
  }, [nodes, edges, currentStrategyName, currentStrategyId])

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

  // Show library view
  if (viewMode === "library") {
    return (
      <div className="-m-4 md:-m-6 h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)]">
        <StrategyLibrary onCreateNew={handleCreateNewStrategy} onEditStrategy={handleEditStrategy} />
      </div>
    )
  }

  // Show loading state
  if (loadingStrategy) {
    return (
      <div className="-m-4 md:-m-6 flex h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA] mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading strategy...</p>
        </div>
      </div>
    )
  }

  // Show builder view
  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] flex-col bg-background">
      {/* Header */}
      <header className="relative shrink-0 overflow-hidden border-b border-border/40 bg-gradient-to-br from-background via-background to-background/95 px-4 py-4 shadow-sm md:px-6 md:py-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "radial-gradient(circle at 15% 30%, rgba(0,224,170,0.12), transparent 45%), radial-gradient(circle at 90% 25%, rgba(0,224,170,0.08), transparent 40%)",
          }}
          aria-hidden="true"
        />

        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackToLibrary}
              aria-label="Back to library"
              className="rounded-xl transition hover:bg-[#00E0AA]/10 hover:text-[#00E0AA]"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl transition hover:bg-[#00E0AA]/10 hover:text-[#00E0AA] md:hidden"
              onClick={() => setIsPaletteOpen(!isPaletteOpen)}
              aria-label="Toggle node palette"
            >
              {isPaletteOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00E0AA]/10 text-[#00E0AA] shadow-lg shadow-[#00E0AA]/20">
              <Workflow className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">{currentStrategyName}</h1>
              <p className="text-xs text-muted-foreground md:text-sm">Build and execute wallet screening strategies</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-3">
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
              onClick={handleClearCanvas}
              className="gap-2 rounded-xl border-border/60 transition hover:border-red-500/50 hover:bg-red-500/5 hover:text-red-500"
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveWorkflow}
              className="gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5"
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5"
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportWorkflow}
              className="gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAIChat(!showAIChat)
                setSelectedNode(null)
                setShowExecution(false)
              }}
              className="gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5"
            >
              <Sparkles className="h-4 w-4" />
              AI Assistant
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteStrategy}
              disabled={isExecuting}
              className="gap-2 rounded-full bg-[#00E0AA] px-5 text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90 disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {currentStrategyId ? 'Deploying...' : 'Executing...'}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {currentStrategyId ? 'Deploy Strategy' : 'Run Strategy'}
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

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
          <ConversationalChat
            nodes={nodes}
            edges={edges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onCollapse={() => setShowAIChat(false)}
          />
        )}

        {/* Node Palette - Left */}
        <div
          className={`${
            isPaletteOpen ? "fixed left-0 top-[120px] z-50 h-[calc(100vh-120px)]" : "hidden"
          } md:block md:relative md:top-0 md:z-auto md:h-auto shrink-0`}
        >
          <NodePalette onAddNode={onAddNode} onClose={() => setIsPaletteOpen(false)} />
        </div>

        {/* React Flow Canvas - Middle */}
        <div className="flex-1" ref={reactFlowWrapper}>
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
            className="bg-background antialiased"
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
    </div>
  )
}
