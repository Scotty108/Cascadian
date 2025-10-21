interface SparklineProps {
  data: number[];
  height?: number;
  className?: string;
  color?: string;
  fillOpacity?: number;
  strokeWidth?: number;
}

export function Sparkline({
  data,
  height = 30,
  className = '',
  color = 'currentColor',
  fillOpacity = 0.1,
  strokeWidth = 2,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return null;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = ((max - value) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  // Create a closed path for the filled area
  const fillPath = `
    M 0,100
    L ${points}
    L 100,100
    Z
  `;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ height: `${height}px`, width: '100%' }}
      className={className}
    >
      {/* Filled area under the line */}
      <path
        d={fillPath}
        fill={color}
        fillOpacity={fillOpacity}
      />
      {/* Line on top */}
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
