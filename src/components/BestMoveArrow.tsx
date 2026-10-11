import { useEffect, useState, type RefObject } from "react";

interface BestMoveArrowProps {
  boardArenaRef: RefObject<HTMLDivElement | null>;
  bestMoveSquares?: { from: number; to: number };
  isFlipped: boolean;
  boardScale: number;
}

/**
 * Draws an arrow from one square to another on top of the board -- used to
 * show "here's what the engine would have played instead" during analysis.
 * Measures the actual rendered squares (each already has a `square-{n}` DOM
 * id) rather than recomputing row/col/flip layout math itself, so it can't
 * drift out of sync with however the board is actually laid out.
 */
export function BestMoveArrow({ boardArenaRef, bestMoveSquares, isFlipped, boardScale }: BestMoveArrowProps) {
  const [coords, setCoords] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    if (!bestMoveSquares || typeof bestMoveSquares.from !== "number" || typeof bestMoveSquares.to !== "number" || !boardArenaRef.current) {
      setCoords(null);
      return;
    }

    const measure = () => {
      const container = boardArenaRef.current;
      if (!container) return;
      const fromEl = document.getElementById(`square-${bestMoveSquares.from}`);
      const toEl = document.getElementById(`square-${bestMoveSquares.to}`);
      if (!fromEl || !toEl) { setCoords(null); return; }

      const containerRect = container.getBoundingClientRect();
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      if (containerRect.width === 0 || containerRect.height === 0) return;

      // Percentages of the container, not raw pixels -- the SVG viewBox
      // below is 0-100 either way, so this stays correct across board
      // resizes/scale changes without needing separate pixel math per size.
      setCoords({
        x1: ((fromRect.left + fromRect.width / 2) - containerRect.left) / containerRect.width * 100,
        y1: ((fromRect.top + fromRect.height / 2) - containerRect.top) / containerRect.height * 100,
        x2: ((toRect.left + toRect.width / 2) - containerRect.left) / containerRect.width * 100,
        y2: ((toRect.top + toRect.height / 2) - containerRect.top) / containerRect.height * 100,
      });
    };

    // One tick so the DOM has settled after historyViewIndex/flip changes
    // (square positions don't move on those, but this keeps it safe if
    // that ever changes) before the first measurement.
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, [bestMoveSquares?.from, bestMoveSquares?.to, isFlipped, boardScale, boardArenaRef]);

  if (!coords) return null;

  // Shorten the line a bit so the arrowhead lands next to the destination
  // piece instead of burying itself underneath it.
  const dx = coords.x2 - coords.x1;
  const dy = coords.y2 - coords.y1;
  const len = Math.hypot(dx, dy) || 1;
  const shorten = 6;
  const endX = coords.x2 - (dx / len) * shorten;
  const endY = coords.y2 - (dy / len) * shorten;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-30"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <marker id="best-move-arrowhead" markerWidth="4" markerHeight="4" refX="1.4" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="#facc15" fillOpacity="0.9" />
        </marker>
      </defs>
      <line
        x1={coords.x1}
        y1={coords.y1}
        x2={endX}
        y2={endY}
        stroke="#facc15"
        strokeOpacity="0.8"
        strokeWidth="1.6"
        strokeLinecap="round"
        markerEnd="url(#best-move-arrowhead)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
