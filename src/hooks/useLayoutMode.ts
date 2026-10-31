import { useCallback, useEffect, useState } from 'react';

// Modo de vista elegido por el usuario (se guarda por dispositivo).
export type LayoutMode = 'auto' | 'pc' | 'tablet' | 'mobile';
// Modo que se aplica realmente.
export type EffectiveLayout = 'pc' | 'tablet' | 'mobile';

const STORAGE_KEY = 'dcanp-layout-mode';
const EVENT = 'dcanp-layout-mode';

// Ancho de página que se fuerza en celulares y tablets para cada modo.
const VIEWPORT_WIDTH: Record<EffectiveLayout, string> = {
  pc: '1280',
  tablet: '820',
  mobile: 'device-width',
};

const readMode = (): LayoutMode => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'pc' || value === 'tablet' || value === 'mobile') return value;
  } catch {
    // Sin almacenamiento: modo automático.
  }
  return 'auto';
};

const byWidth = (width: number): EffectiveLayout => (width < 640 ? 'mobile' : width < 1024 ? 'tablet' : 'pc');

// Celulares y tablets (pantalla táctil sin mouse).
export const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

function applyViewport(mode: LayoutMode) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || !isTouchDevice()) return;
  const width = mode === 'auto' ? 'device-width' : VIEWPORT_WIDTH[mode];
  meta.setAttribute('content', width === 'device-width' ? 'width=device-width, initial-scale=1.0' : `width=${width}`);
}

export function useLayoutMode() {
  const [mode, setModeState] = useState<LayoutMode>(readMode);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    const onChange = () => setModeState(readMode());
    window.addEventListener('resize', onResize);
    window.addEventListener(EVENT, onChange);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener(EVENT, onChange);
    };
  }, []);

  useEffect(() => {
    applyViewport(mode);
  }, [mode]);

  // En computadora el diseño sigue al ancho real de la ventana (así la vista
  // previa de tablet/celular abre una ventana de ese tamaño y se ve igual que
  // en el dispositivo). En celulares y tablets se aplica el modo elegido.
  const effective: EffectiveLayout = mode !== 'auto' && isTouchDevice() ? mode : byWidth(width);

  useEffect(() => {
    document.documentElement.dataset.layout = effective;
  }, [effective]);

  const setMode = useCallback((next: LayoutMode) => {
    // En computadora, tablet y celular se muestran en una ventana de ese tamaño.
    if (!isTouchDevice() && (next === 'tablet' || next === 'mobile')) {
      const [w, h] = next === 'tablet' ? [820, 1100] : [400, 860];
      const preview = window.open(window.location.href, `dcanp-${next}`, `width=${w},height=${h}`);
      if (preview) return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Se aplica igual en esta sesión.
    }
    setModeState(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { mode, setMode, effective };
}
