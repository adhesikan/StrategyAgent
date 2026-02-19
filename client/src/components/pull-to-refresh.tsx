import { useState, useRef, useCallback, ReactNode } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  className?: string;
  threshold?: number;
  disabled?: boolean;
}

export function PullToRefresh({
  children,
  onRefresh,
  className,
  threshold = 80,
  disabled = false,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const isMobile = typeof window !== "undefined" && "ontouchstart" in window;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing) return;
      const container = containerRef.current;
      if (!container || container.scrollTop > 0) return;
      
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    },
    [disabled, isRefreshing]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || disabled || isRefreshing) return;
      const container = containerRef.current;
      if (!container || container.scrollTop > 0) {
        isPulling.current = false;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;
      
      if (diff > 0) {
        e.preventDefault();
        const resistance = 0.4;
        setPullDistance(Math.min(diff * resistance, threshold * 1.5));
      }
    },
    [disabled, isRefreshing, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || disabled) return;
    isPulling.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(threshold);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh, disabled]);

  const handleTouchCancel = useCallback(() => {
    isPulling.current = false;
    setPullDistance(0);
  }, []);

  const progress = Math.min(pullDistance / threshold, 1);
  const isReady = progress >= 1;

  if (!isMobile) {
    return <div className={cn("flex-1 overflow-auto flex flex-col", className)}><div className="flex flex-col flex-1">{children}</div></div>;
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex-1 overflow-auto relative flex flex-col", className)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      <div
        className={cn(
          "absolute left-0 right-0 flex items-center justify-center transition-opacity z-10",
          pullDistance > 10 || isRefreshing ? "opacity-100" : "opacity-0"
        )}
        style={{
          top: Math.max(pullDistance - 40, 8),
          height: 32,
        }}
      >
        <div
          className={cn(
            "flex items-center justify-center rounded-full bg-background border shadow-sm",
            "h-8 w-8 transition-transform",
            isReady && !isRefreshing && "scale-110"
          )}
        >
          {isRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <ArrowDown
              className={cn(
                "h-4 w-4 transition-transform text-muted-foreground",
                isReady && "text-primary rotate-180"
              )}
              style={{
                transform: isReady ? "rotate(180deg)" : `rotate(${progress * 180}deg)`,
              }}
            />
          )}
        </div>
      </div>
      <div
        className="flex flex-col flex-1"
        style={{
          transform: `translateY(${pullDistance}px)`,
          transition: isPulling.current ? "none" : "transform 0.2s ease-out",
          minHeight: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
