import { useCallback, useEffect, useRef } from 'react';

const GRID = 100; // 100×100 cells

interface Props {
  fogData:      string;              // 10000-char '0'/'1' string
  isDMMode:     boolean;
  paintMode:    boolean;
  brushMode:    'reveal' | 'hide';
  brushSize:    number;              // grid-cell radius
  onFogChange:  (data: string) => void;
}

export default function FogCanvas({ fogData, isDMMode, paintMode, brushMode, brushSize, onFogChange }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const isPainting = useRef(false);
  const localFog   = useRef<string>(fogData); // accumulates in-progress brush strokes
  // Updated synchronously on every render — always current, never stale in async callbacks.
  // This prevents the ResizeObserver from drawing old fog when the map image changes.
  const fogDataRef = useRef<string>(fogData);
  fogDataRef.current = fogData;

  // ── Draw ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cw = W / GRID;
    const ch = H / GRID;

    ctx.clearRect(0, 0, W, H);

    const fogOpacity = isDMMode ? 0.6 : 1.0;
    ctx.fillStyle = `rgba(0,0,0,${fogOpacity})`;

    // While actively painting, use localFog (has unsaved strokes).
    // Otherwise always read from fogDataRef so async callbacks (ResizeObserver)
    // never render stale fog after a map switch.
    const data = isPainting.current ? localFog.current : fogDataRef.current;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const idx = row * GRID + col;
        if ((data[idx] ?? '1') === '0') {
          ctx.fillRect(col * cw, row * ch, cw + 0.5, ch + 0.5); // +0.5 to prevent gaps
        }
      }
    }
  }, [isDMMode]);

  // Re-draw whenever fogData or mode changes; also sync localFog so new strokes
  // start from the current server state rather than a stale snapshot.
  useEffect(() => { localFog.current = fogData; draw(); }, [fogData, isDMMode, draw]);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const ro = new ResizeObserver(() => {
      canvas.width  = parent.clientWidth;
      canvas.height = parent.clientHeight;
      draw();
    });
    ro.observe(parent);
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
    draw();
    return () => ro.disconnect();
  }, [draw]);

  // ── Paint helpers ─────────────────────────────────────────────────────────
  const paintAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();

    const px = clientX - rect.left;
    const py = clientY - rect.top;

    const col = Math.floor((px / rect.width)  * GRID);
    const row = Math.floor((py / rect.height) * GRID);

    const newBit = brushMode === 'reveal' ? '1' : '0';
    const arr = localFog.current.split('');

    for (let dr = -brushSize; dr <= brushSize; dr++) {
      for (let dc = -brushSize; dc <= brushSize; dc++) {
        if (dr * dr + dc * dc > brushSize * brushSize) continue; // circular brush
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
        arr[r * GRID + c] = newBit;
      }
    }

    localFog.current = arr.join('');
    draw();
  }, [brushMode, brushSize, draw]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!paintMode) return;
    e.preventDefault();
    e.stopPropagation();
    isPainting.current = true;
    paintAt(e.clientX, e.clientY);
  }, [paintMode, paintAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPainting.current || !paintMode) return;
    e.preventDefault();
    e.stopPropagation();
    paintAt(e.clientX, e.clientY);
  }, [paintMode, paintAt]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isPainting.current) return;
    isPainting.current = false;
    onFogChange(localFog.current);
  }, [onFogChange]);

  const handleMouseLeave = useCallback(() => {
    if (isPainting.current) {
      isPainting.current = false;
      onFogChange(localFog.current);
    }
  }, [onFogChange]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      'absolute',
        top:           0,
        left:          0,
        width:         '100%',
        height:        '100%',
        pointerEvents: paintMode ? 'auto' : 'none',
        cursor:        paintMode ? (brushMode === 'reveal' ? 'cell' : 'crosshair') : 'inherit',
        zIndex:        4,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}
