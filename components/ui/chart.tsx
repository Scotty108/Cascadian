import { cn } from "@/lib/utils";
import * as React from "react";
import * as RechartsPrimitive from "recharts";

// Utility to filter out non-DOM props
const filterDOMProps = (props: Record<string, any>) => {
  const domProps: Record<string, any> = {};
  const nonDOMProps = [
    "accessibilityLayer",
    "config",
    "allowEscapeViewBox",
    "animationDuration",
    "animationEasing",
    "contentStyle",
    "cursor",
    "cursorStyle",
    "filterNull",
    "isAnimationActive",
    "itemStyle",
    "labelStyle",
    "reverseDirection",
    "useTranslate3d",
    "wrapperStyle",
  ];

  for (const [key, value] of Object.entries(props)) {
    // Skip React-specific, Recharts-specific, or non-standard props
    if (
      !nonDOMProps.includes(key) &&
      !key.startsWith("data-") && // Allow data-* attributes
      !key.startsWith("aria-") && // Allow aria-* attributes
      typeof value !== "function" // Skip event handlers if not needed
    ) {
      domProps[key] = value;
    }
  }
  return domProps;
};

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    config?: Record<string, any>;
    children: React.ReactNode;
  }
>(({ className, config, children, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("w-full h-full", className)} {...filterDOMProps(props)}>
      {children}
    </div>
  );
});
ChartContainer.displayName = "ChartContainer";

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: "line" | "dot" | "dashed";
    nameKey?: string;
    labelKey?: string;
    active?: boolean;
    payload?: any[];
    label?: string;
  }
>(({ active, payload, label, hideLabel, hideIndicator, indicator = "dot", nameKey, labelKey, className, ...props }, ref) => {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div ref={ref} className={cn("rounded-lg border bg-background p-2 shadow-md", className)} {...filterDOMProps(props)}>
      {!hideLabel && label && <div className="mb-2 font-medium">{labelKey ? payload[0]?.payload?.[labelKey] : label}</div>}
      <div className="grid gap-2">
        {payload.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            {!hideIndicator && (
              <div
                className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", indicator === "dot" && "rounded-full", indicator === "dashed" && "border-2 border-dashed bg-transparent")}
                style={{
                  backgroundColor: indicator === "dashed" ? "transparent" : entry.color,
                  borderColor: indicator === "dashed" ? entry.color : undefined,
                }}
              />
            )}
            <div className="flex flex-1 justify-between leading-none">
              <div className="grid gap-1.5">
                <span className="text-muted-foreground">{nameKey ? entry.payload?.[nameKey] : entry.name}</span>
              </div>
              <span className="font-mono font-medium tabular-nums text-foreground">{entry.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
ChartTooltipContent.displayName = "ChartTooltipContent";

export { ChartContainer, ChartTooltip, ChartTooltipContent };
