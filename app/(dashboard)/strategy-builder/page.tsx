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
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Button } from "@/components/ui/button"
import { Play, Code2, Sparkles, Download, Upload, Menu, X, ArrowLeft, Workflow } from "lucide-react"
// Universal nodes (kept from original)
import JavaScriptNode from "@/components/nodes/javascript-node"
import StartNode from "@/components/nodes/start-node"
import EndNode from "@/components/nodes/end-node"
import ConditionalNode from "@/components/nodes/conditional-node"
import HttpRequestNode from "@/components/nodes/http-request-node"

import { NodePalette } from "@/components/node-palette"
import { NodeConfigPanel } from "@/components/node-config-panel"
import { CodeExportDialog } from "@/components/code-export-dialog"
import { ExecutionPanel } from "@/components/execution-panel"
import { StrategyLibrary } from "@/components/strategy-library"

const STORAGE_KEY = "ai-agent-builder-workflow"

const nodeTypes = {
  javascript: JavaScriptNode as any,
  start: StartNode as any,
  end: EndNode as any,
  conditional: ConditionalNode as any,
  httpRequest: HttpRequestNode as any,
  // TODO: Add new CASCADIAN prediction market nodes here
  // getMarketData, findMarkets, findSpecialist, etc.
}

const initialNodes: Node[] = [
  {
    id: "1",
    type: "start",
    position: { x: 50, y: 250 },
    data: {},
  },
  {
    id: "2",
    type: "httpRequest",
    position: { x: 350, y: 250 },
    data: {
      url: "https://api.polymarket.com/markets",
      method: "GET",
    },
  },
  {
    id: "3",
    type: "conditional",
    position: { x: 750, y: 250 },
    data: {
      condition: "input1.sii > 60",
    },
  },
  {
    id: "4",
    type: "javascript",
    position: { x: 1150, y: 50 },
    data: { code: "// High SII market found\nreturn { action: 'BUY', market: input1 }" },
  },
  {
    id: "5",
    type: "javascript",
    position: { x: 1150, y: 450 },
    data: { code: "// Low SII - skip\nreturn { action: 'SKIP' }" },
  },
  {
    id: "6",
    type: "end",
    position: { x: 1550, y: 250 },
    data: {},
  },
]

const initialEdges: Edge[] = [
  { id: "e1-2", source: "1", target: "2" },
  { id: "e2-3", source: "2", target: "3" },
  { id: "e3-4", source: "3", target: "4", sourceHandle: "true", label: "✓ HIGH SII", style: { stroke: "#22c55e" } },
  { id: "e3-5", source: "3", target: "5", sourceHandle: "false", label: "✗ LOW SII", style: { stroke: "#ef4444" } },
  { id: "e4-6", source: "4", target: "6" },
  { id: "e5-6", source: "5", target: "6" },
]

const getDefaultNodeData = (type: string) => {
  switch (type) {
    case "javascript":
      return { code: "// Access inputs as input1, input2, etc.\nreturn input1" }
    case "start":
      return {}
    case "end":
      return {}
    case "conditional":
      return { condition: "input1 > 0" }
    case "httpRequest":
      return { url: "https://api.polymarket.com/markets", method: "GET" }
    // TODO: Add default data for new CASCADIAN nodes
    default:
      return {}
  }
}

export default function StrategyBuilderPage() {
  const searchParams = useSearchParams()
  const editStrategyId = searchParams.get("edit")

  // View state
  const [viewMode, setViewMode] = useState<"library" | "builder">(editStrategyId ? "builder" : "library")
  const [currentStrategyId, setCurrentStrategyId] = useState<string | null>(editStrategyId)
  const [currentStrategyName, setCurrentStrategyName] = useState<string>("Untitled Strategy")

  // Builder state
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [showCodeExport, setShowCodeExport] = useState(false)
  const [showExecution, setShowExecution] = useState(false)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const nodeIdCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPaletteOpen, setIsPaletteOpen] = useState(false)

  useEffect(() => {
    const maxId = Math.max(...nodes.map((n) => Number.parseInt(n.id) || 0), 0)
    nodeIdCounter.current = maxId + 1
  }, [nodes])

  // Load strategy name if editing
  useEffect(() => {
    if (editStrategyId) {
      const strategyNames: Record<string, string> = {
        "default-template": "Default Template"
      }
      setCurrentStrategyName(strategyNames[editStrategyId] || "Untitled Strategy")
    }
  }, [editStrategyId])

  const onNodesChange: OnNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), [])

  const onEdgesChange: OnEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const onConnect: OnConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node)
    setShowExecution(false)
    setIsPaletteOpen(false)
  }, [])

  const onAddNode = useCallback(
    (type: string) => {
      if (!reactFlowInstance) return

      const newNode: Node = {
        id: `${Date.now()}-${nodeIdCounter.current++}`,
        type,
        position: reactFlowInstance.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
        data: getDefaultNodeData(type),
      }

      setNodes((nds) => [...nds, newNode])
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
        id: `${Date.now()}-${nodeIdCounter.current++}`,
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

  const handleNodeStatusChange = useCallback((nodeId: string, status: "idle" | "running" | "completed" | "error") => {
    setNodes((nds) => nds.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, status } } : node)))
  }, [])

  const handleNodeOutputChange = useCallback((nodeId: string, output: any) => {
    setNodes((nds) => nds.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, output } } : node)))
  }, [])

  const handleExportWorkflow = useCallback(() => {
    const workflow = { nodes, edges }
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `trading-strategy-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [nodes, edges])

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

            const maxId = Math.max(
              ...workflow.nodes.map((n: Node) => {
                const parts = n.id.split("-")
                return Number.parseInt(parts[parts.length - 1]) || 0
              }),
              0,
            )
            nodeIdCounter.current = maxId + 1
          } else {
            alert("Invalid workflow file format")
          }
        } catch (error) {
          console.error("Failed to import workflow:", error)
          alert("Failed to import workflow. Please check the file format.")
        }
      }
      reader.readAsText(file)

      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [nodes],
  )

  const handleRun = useCallback(() => {
    setShowExecution(true)
    // Trigger execution after panel opens
    setTimeout(() => {
      const executeButton = document.querySelector("[data-execute-workflow]") as HTMLButtonElement
      if (executeButton) {
        executeButton.click()
      }
    }, 100)
  }, [])

  const handleCreateNewStrategy = useCallback(() => {
    setCurrentStrategyId(null)
    setCurrentStrategyName("Untitled Strategy")
    setNodes(initialNodes)
    setEdges(initialEdges)
    setViewMode("builder")
  }, [])

  const handleEditStrategy = useCallback((strategyId: string) => {
    setCurrentStrategyId(strategyId)
    // In a real app, you would load the strategy data here
    // For now, we'll use the default nodes
    const strategyNames: Record<string, string> = {
      "default-template": "Default Template"
    }
    setCurrentStrategyName(strategyNames[strategyId] || "Untitled Strategy")
    setNodes(initialNodes)
    setEdges(initialEdges)
    setViewMode("builder")
  }, [])

  const handleBackToLibrary = useCallback(() => {
    setViewMode("library")
    setCurrentStrategyId(null)
    setSelectedNode(null)
    setShowCodeExport(false)
    setShowExecution(false)
    // Clear the edit query parameter
    window.history.replaceState({}, "", "/strategy-builder")
  }, [])

  // Show library view
  if (viewMode === "library") {
    return (
      <div className="-m-4 md:-m-6 h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)]">
        <StrategyLibrary
          onCreateNew={handleCreateNewStrategy}
          onEditStrategy={handleEditStrategy}
        />
      </div>
    )
  }

  // Show builder view
  return (
    <div className="-m-4 md:-m-6 flex h-[calc(100vh-64px)] w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] flex-col bg-background">
      {/* Header with Modern Design */}
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
              <p className="text-xs text-muted-foreground md:text-sm">Visual workflow designer for AI trading strategies</p>
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
              onClick={() => setShowCodeExport(true)}
              className="gap-2 rounded-xl border-border/60 transition hover:border-[#00E0AA]/50 hover:bg-[#00E0AA]/5"
            >
              <Code2 className="h-4 w-4" />
              Export Code
            </Button>
            <Button
              size="sm"
              onClick={handleRun}
              className="gap-2 rounded-full bg-[#00E0AA] px-5 text-slate-950 shadow-lg shadow-[#00E0AA]/30 transition hover:bg-[#00E0AA]/90"
            >
              <Play className="h-4 w-4" />
              Run Strategy
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative flex flex-1 overflow-hidden min-h-0">
        <div
          className={`${isPaletteOpen ? "fixed inset-0 z-40 bg-black/50 md:hidden" : "hidden"}`}
          onClick={() => setIsPaletteOpen(false)}
          aria-hidden="true"
        />
        <div
          className={`${
            isPaletteOpen ? "fixed left-0 top-[120px] z-50 h-[calc(100vh-120px)]" : "hidden"
          } ${selectedNode ? "md:block" : "md:block"} md:relative md:top-0 md:z-auto md:h-auto`}
        >
          <NodePalette onAddNode={onAddNode} onClose={() => setIsPaletteOpen(false)} />
        </div>

        {/* React Flow Canvas */}
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
            className="bg-background"
          >
            <Background className="bg-background" gap={16} size={1} />
            <Controls className="rounded-2xl border border-border/60 bg-card shadow-lg" />
            <MiniMap
              pannable
              zoomable
              className="rounded-2xl border border-border/60 bg-card shadow-lg"
              maskColor="rgb(0, 0, 0, 0.6)"
              nodeColor={(node) => {
                switch (node.type) {
                  case "javascript":
                    return "oklch(0.65 0.25 265)"
                  case "start":
                    return "#00E0AA"
                  case "end":
                    return "oklch(0.50 0.25 300)"
                  case "conditional":
                    return "oklch(0.60 0.25 320)"
                  case "httpRequest":
                    return "oklch(0.65 0.25 265)"
                  // TODO: Add colors for new CASCADIAN nodes
                  default:
                    return "oklch(0.65 0.25 265)"
                }
              }}
            />
          </ReactFlow>
        </div>

        {selectedNode && !showExecution && (
          <NodeConfigPanel node={selectedNode} onClose={() => setSelectedNode(null)} onUpdate={onUpdateNode} />
        )}

        {showExecution && (
          <ExecutionPanel
            nodes={nodes}
            edges={edges}
            onClose={() => setShowExecution(false)}
            onNodeStatusChange={handleNodeStatusChange}
            onNodeOutputChange={handleNodeOutputChange}
          />
        )}
      </div>

      <CodeExportDialog open={showCodeExport} onOpenChange={setShowCodeExport} nodes={nodes} edges={edges} />
    </div>
  )
}
