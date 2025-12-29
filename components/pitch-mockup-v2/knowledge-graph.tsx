"use client";

import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Network, Sparkles } from "lucide-react";

// Hardcoded nodes for the knowledge graph
const nodes = [
  { id: "fed", label: "Fed Rate Cut", x: 400, y: 150, type: "primary", value: 87 },
  { id: "inflation", label: "CPI Data", x: 150, y: 100, type: "data", value: null },
  { id: "employment", label: "Jobs Report", x: 200, y: 250, type: "data", value: null },
  { id: "treasury", label: "Treasury Yields", x: 100, y: 180, type: "data", value: null },
  { id: "smart_money", label: "Smart Money", x: 650, y: 100, type: "signal", value: 82 },
  { id: "forecasters", label: "Super Forecasters", x: 620, y: 230, type: "signal", value: 81 },
  { id: "polymarket", label: "Polymarket", x: 300, y: 280, type: "market", value: 87 },
  { id: "kalshi", label: "Kalshi", x: 480, y: 300, type: "market", value: 84 },
  { id: "stocks", label: "S&P 500", x: 700, y: 180, type: "impact", value: null },
  { id: "housing", label: "Housing Market", x: 550, y: 50, type: "impact", value: null },
];

const edges = [
  { from: "inflation", to: "fed", animated: true },
  { from: "employment", to: "fed", animated: true },
  { from: "treasury", to: "fed", animated: true },
  { from: "fed", to: "smart_money", animated: false },
  { from: "fed", to: "forecasters", animated: false },
  { from: "polymarket", to: "fed", animated: true },
  { from: "kalshi", to: "fed", animated: true },
  { from: "fed", to: "stocks", animated: false },
  { from: "fed", to: "housing", animated: false },
  { from: "smart_money", to: "forecasters", animated: false },
];

export function KnowledgeGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    canvas.width = 800;
    canvas.height = 350;

    let animationFrame: number;
    let offset = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw edges
      edges.forEach((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from);
        const toNode = nodes.find((n) => n.id === edge.to);
        if (!fromNode || !toNode) return;

        ctx.beginPath();
        ctx.moveTo(fromNode.x, fromNode.y);
        ctx.lineTo(toNode.x, toNode.y);

        if (edge.animated) {
          // Animated dashed line
          ctx.strokeStyle = "rgba(139, 92, 246, 0.4)";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.lineDashOffset = -offset;
        } else {
          ctx.strokeStyle = "rgba(100, 100, 100, 0.3)";
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        }

        ctx.stroke();

        // Draw arrow
        if (edge.animated) {
          const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x);
          const arrowX = toNode.x - 30 * Math.cos(angle);
          const arrowY = toNode.y - 30 * Math.sin(angle);

          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - 10 * Math.cos(angle - Math.PI / 6),
            arrowY - 10 * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            arrowX - 10 * Math.cos(angle + Math.PI / 6),
            arrowY - 10 * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fillStyle = "rgba(139, 92, 246, 0.6)";
          ctx.fill();
        }
      });

      // Draw nodes
      nodes.forEach((node) => {
        // Node circle
        ctx.beginPath();
        const radius = node.type === "primary" ? 35 : 25;
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

        // Fill based on type
        let fillColor = "rgba(50, 50, 50, 0.8)";
        let strokeColor = "rgba(100, 100, 100, 0.5)";

        if (node.type === "primary") {
          fillColor = "rgba(139, 92, 246, 0.3)";
          strokeColor = "rgba(139, 92, 246, 0.8)";
        } else if (node.type === "signal") {
          fillColor = "rgba(16, 185, 129, 0.2)";
          strokeColor = "rgba(16, 185, 129, 0.6)";
        } else if (node.type === "market") {
          fillColor = "rgba(59, 130, 246, 0.2)";
          strokeColor = "rgba(59, 130, 246, 0.6)";
        } else if (node.type === "impact") {
          fillColor = "rgba(251, 191, 36, 0.2)";
          strokeColor = "rgba(251, 191, 36, 0.6)";
        }

        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();

        // Node label
        ctx.fillStyle = "#fff";
        ctx.font = node.type === "primary" ? "bold 11px Inter" : "10px Inter";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.label, node.x, node.y - (node.value ? 6 : 0));

        // Node value
        if (node.value) {
          ctx.fillStyle = node.type === "primary" ? "#a78bfa" : "#10b981";
          ctx.font = "bold 12px Inter";
          ctx.fillText(`${node.value}%`, node.x, node.y + 10);
        }
      });

      // Animate
      offset += 0.3;
      animationFrame = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <Card className="p-6 border-border/50 bg-gradient-to-br from-violet-500/5 to-background">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-violet-400" />
          <h2 className="text-xl font-semibold">Intelligence Network</h2>
        </div>
        <Badge variant="outline" className="bg-violet-500/10 text-violet-400 border-violet-500/30 gap-1">
          <Sparkles className="h-3 w-3" />
          Live Data Flows
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Real-time data connections powering our AI predictions. Watch insights flow across sources.
      </p>

      {/* Canvas for the graph */}
      <div className="relative rounded-xl bg-muted/20 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full"
          style={{ height: "350px" }}
        />

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex gap-4 bg-background/80 backdrop-blur rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-violet-500/50 border border-violet-500" />
            <span className="text-[10px] text-muted-foreground">Primary Event</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-muted border border-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground">Data Source</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-emerald-500/30 border border-emerald-500" />
            <span className="text-[10px] text-muted-foreground">Signal</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-blue-500/30 border border-blue-500" />
            <span className="text-[10px] text-muted-foreground">Market</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-amber-500/30 border border-amber-500" />
            <span className="text-[10px] text-muted-foreground">Impact</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
