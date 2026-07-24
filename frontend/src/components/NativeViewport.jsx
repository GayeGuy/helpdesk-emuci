import { useEffect, useRef, useState } from 'react';

// Vue contrôleur pour un agent NATIF : reçoit des images JPEG (bus 'frame') et
// renvoie les événements souris/clavier (messages 'control') avec des coordonnées
// normalisées (0..1) — l'agent les remappe sur la résolution réelle du poste.
const SPECIAL = {
  Enter: 'ENTER', Backspace: 'BACK', Tab: 'TAB', Escape: 'ESC', Delete: 'DEL',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Home: 'HOME', End: 'END', PageUp: 'PGUP', PageDown: 'PGDN',
};

export default function NativeViewport({ bus, sessionId, send }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(new Image());
  const lastMove = useRef(0);
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);

  useEffect(() => {
    const img = imgRef.current;
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      if (c.width !== img.width || c.height !== img.height) {
        c.width = img.width;
        c.height = img.height;
      }
      c.getContext('2d').drawImage(img, 0, 0);
      frameCount.current++;
    };
    bus.on('frame', ({ data }) => {
      img.src = `data:image/jpeg;base64,${data}`;
    });
    const t = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => {
      bus.off('frame');
      clearInterval(t);
    };
  }, []);

  const ctrl = (event) => send({ type: 'control', sessionId, event });

  const norm = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const btn = (e) => (e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left');

  const onMove = (e) => {
    const now = Date.now();
    if (now - lastMove.current < 55) return;
    lastMove.current = now;
    ctrl({ kind: 'move', ...norm(e) });
  };
  const onDown = (e) => {
    canvasRef.current.focus();
    ctrl({ kind: 'down', ...norm(e), button: btn(e) });
  };
  const onUp = (e) => ctrl({ kind: 'up', ...norm(e), button: btn(e) });
  const onWheel = (e) => {
    e.preventDefault();
    ctrl({ kind: 'scroll', dy: e.deltaY });
  };
  const onKeyDown = (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return; // combos hors périmètre prototype
    if (SPECIAL[e.key]) {
      e.preventDefault();
      ctrl({ kind: 'key', key: SPECIAL[e.key] });
    } else if (e.key.length === 1) {
      e.preventDefault();
      ctrl({ kind: 'type', text: e.key });
    }
  };

  return (
    <div className="native-view">
      <div className="native-badge">🖱️ Contrôle actif · {fps} img/s</div>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
