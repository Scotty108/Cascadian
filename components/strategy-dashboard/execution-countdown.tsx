'use client';

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

interface ExecutionCountdownProps {
  nextExecutionAt: string | null;
  className?: string;
}

/**
 * ExecutionCountdown component displays real-time countdown to next strategy execution
 *
 * Updates every second to show:
 * - "Next execution in: Xm Ys" when execution is scheduled
 * - "No execution scheduled" when nextExecutionAt is null
 * - "Executing now..." when execution is overdue
 *
 * @param nextExecutionAt - ISO timestamp of next scheduled execution
 * @param className - Optional additional CSS classes
 */
export function ExecutionCountdown({
  nextExecutionAt,
  className,
}: ExecutionCountdownProps) {
  const [timeRemaining, setTimeRemaining] = useState<string>('');

  useEffect(() => {
    if (!nextExecutionAt) {
      setTimeRemaining('No execution scheduled');
      return;
    }

    const calculateTimeRemaining = () => {
      const now = new Date().getTime();
      const target = new Date(nextExecutionAt).getTime();
      const diff = target - now;

      if (diff <= 0) {
        return 'Executing now...';
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      if (minutes > 60) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
      }

      if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
      }

      return `${seconds}s`;
    };

    setTimeRemaining(calculateTimeRemaining());

    const interval = setInterval(() => {
      setTimeRemaining(calculateTimeRemaining());
    }, 1000);

    return () => clearInterval(interval);
  }, [nextExecutionAt]);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span className="font-medium">
          {nextExecutionAt ? (
            <>
              Next execution in: <span className="text-foreground">{timeRemaining}</span>
            </>
          ) : (
            <span className="text-foreground">{timeRemaining}</span>
          )}
        </span>
      </div>
    </div>
  );
}
