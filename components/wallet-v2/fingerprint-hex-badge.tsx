"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import type { FingerprintChartProps } from "./types";
import { METRIC_COLORS_ARRAY } from "./types";

// Generate hexagon segment path for a given index (0-5) and fill percentage
function getHexSegmentPath(
  index: number,
  fillPercent: number,
  centerX: number,
  centerY: number,
  outerRadius: number,
  innerRadius: number
): string {
  const angleStep = (Math.PI * 2) / 6;
  const startAngle = angleStep * index - Math.PI / 2;
  const endAngle = startAngle + angleStep;

  // Calculate actual radius based on fill percentage
  const fillRadius = innerRadius + (outerRadius - innerRadius) * (fillPercent / 100);

  // Calculate points
  const innerStart = {
    x: centerX + Math.cos(startAngle) * innerRadius,
    y: centerY + Math.sin(startAngle) * innerRadius,
  };
  const innerEnd = {
    x: centerX + Math.cos(endAngle) * innerRadius,
    y: centerY + Math.sin(endAngle) * innerRadius,
  };
  const outerStart = {
    x: centerX + Math.cos(startAngle) * fillRadius,
    y: centerY + Math.sin(startAngle) * fillRadius,
  };
  const outerEnd = {
    x: centerX + Math.cos(endAngle) * fillRadius,
    y: centerY + Math.sin(endAngle) * fillRadius,
  };

  return `
    M ${innerStart.x} ${innerStart.y}
    L ${outerStart.x} ${outerStart.y}
    L ${outerEnd.x} ${outerEnd.y}
    L ${innerEnd.x} ${innerEnd.y}
    Z
  `;
}

// Generate hexagon outline path
function getHexOutlinePath(
  centerX: number,
  centerY: number,
  radius: number
): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    points.push(`${x},${y}`);
  }
  return `M ${points.join(" L ")} Z`;
}

export function FingerprintHexBadge({
  metrics,
  size = 400,
  animated = true,
}: FingerprintChartProps) {
  const viewBoxSize = 200;
  const center = viewBoxSize / 2;
  const outerRadius = 85;
  const innerRadius = 25;

  const segments = useMemo(() => {
    return metrics.map((metric, index) => ({
      path: getHexSegmentPath(
        index,
        metric.normalized,
        center,
        center,
        outerRadius,
        innerRadius
      ),
      color: METRIC_COLORS_ARRAY[index],
      metric,
      index,
    }));
  }, [metrics, center]);

  // Calculate label positions
  const labelPositions = useMemo(() => {
    return metrics.map((metric, index) => {
      const angleStep = (Math.PI * 2) / 6;
      const angle = angleStep * index - Math.PI / 2 + angleStep / 2;
      const labelRadius = outerRadius + 15;
      return {
        x: center + Math.cos(angle) * labelRadius,
        y: center + Math.sin(angle) * labelRadius,
        metric,
        angle,
      };
    });
  }, [metrics, center]);

  return (
    <motion.div
      initial={animated ? { opacity: 0, scale: 0.9 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex items-center justify-center"
      style={{ height: size }}
    >
      <svg
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        width={size * 0.9}
        height={size * 0.9}
        className="overflow-visible"
      >
        {/* Background hexagon grid lines */}
        {[0.25, 0.5, 0.75, 1].map((level, i) => {
          const r = innerRadius + (outerRadius - innerRadius) * level;
          return (
            <path
              key={i}
              d={getHexOutlinePath(center, center, r)}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
              className="text-slate-500 dark:text-slate-400"
            />
          );
        })}

        {/* Radial lines from center to each vertex */}
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const angle = (Math.PI * 2 * i) / 6 - Math.PI / 2;
          const x1 = center + Math.cos(angle) * innerRadius;
          const y1 = center + Math.sin(angle) * innerRadius;
          const x2 = center + Math.cos(angle) * outerRadius;
          const y2 = center + Math.sin(angle) * outerRadius;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeWidth={1}
              className="text-slate-500 dark:text-slate-400"
            />
          );
        })}

        {/* Filled segments */}
        {segments.map((segment, i) => (
          <motion.path
            key={segment.metric.key}
            d={segment.path}
            fill={segment.color}
            fillOpacity={0.7}
            stroke={segment.color}
            strokeWidth={1}
            initial={animated ? { opacity: 0, scale: 0.8 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              duration: 0.5,
              delay: animated ? i * 0.1 : 0,
              ease: "easeOut",
            }}
            style={{ transformOrigin: `${center}px ${center}px` }}
          >
            <title>
              {segment.metric.name}: {segment.metric.displayValue}
            </title>
          </motion.path>
        ))}

        {/* Center circle with overall score */}
        <circle
          cx={center}
          cy={center}
          r={innerRadius - 2}
          className="fill-white dark:fill-slate-900"
          stroke="currentColor"
          strokeOpacity={0.2}
          strokeWidth={1}
        />

        {/* Labels around the hexagon */}
        {labelPositions.map((pos, i) => {
          // Determine text anchor based on position
          let textAnchor: "start" | "middle" | "end" = "middle";
          if (pos.angle > -Math.PI / 4 && pos.angle < Math.PI / 4) {
            textAnchor = "middle"; // top
          } else if (pos.angle >= Math.PI / 4 && pos.angle < (3 * Math.PI) / 4) {
            textAnchor = "start"; // right
          } else if (pos.angle >= (3 * Math.PI) / 4 || pos.angle < (-3 * Math.PI) / 4) {
            textAnchor = "middle"; // bottom
          } else {
            textAnchor = "end"; // left
          }

          return (
            <g key={pos.metric.key}>
              <text
                x={pos.x}
                y={pos.y - 6}
                textAnchor={textAnchor}
                className="fill-slate-600 dark:fill-slate-300 text-[8px] font-medium"
              >
                {pos.metric.name}
              </text>
              <text
                x={pos.x}
                y={pos.y + 6}
                textAnchor={textAnchor}
                className="fill-slate-900 dark:fill-white text-[9px] font-bold"
              >
                {pos.metric.displayValue}
              </text>
            </g>
          );
        })}
      </svg>
    </motion.div>
  );
}
