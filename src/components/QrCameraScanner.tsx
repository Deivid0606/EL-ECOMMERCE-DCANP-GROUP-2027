import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

/**
 * 📷 Escáner de QR con la cámara, dentro de la app. Funciona en Android, iPhone
 * y computadora: usa el lector del navegador si existe (BarcodeDetector) y si no
 * jsQR. Plan B: sacar una foto del QR o escribir el número a mano.
 */

/** Del texto del QR saca el número de pedido (los QR traen un link con ?id=…). */
export const orderIdFromQr = (text: string) => {
  const raw = String(text || '').trim();
  const m = raw.match(/[?&]id=([^&#\s]+)/);
  return decodeURIComponent(m ? m[1] : raw).trim().replace(/\s+/g, '');
};

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export default function QrCameraScanner({
  onResult,
  paused = false,
  hint,
}: {
  onResult: (orderId: string) => void;
  /** Mientras procesa un pedido, no lee otro. */
  paused?: boolean;
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const lastRef = useRef<{ value: string; at: number }>({ value: '', at: 0 });
  const pausedRef = useRef(paused);
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState('');
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  pausedRef.current = paused;

  const emit = useCallback(
    (text: string) => {
      const id = orderIdFromQr(text);
      if (!id) return;
      const now = Date.now();
      // El mismo QR frente a la cámara no se lee dos veces seguidas.
      if (lastRef.current.value === id && now - lastRef.current.at < 4000) return;
      lastRef.current = { value: id, at: now };
      try {
        navigator.vibrate?.(120);
      } catch {
        /* sin vibración */
      }
      onResult(id);
    },
    [onResult],
  );

  const decodeFrom = useCallback(async (source: HTMLVideoElement | HTMLImageElement, w: number, h: number) => {
    if (detectorRef.current) {
      try {
        const codes = await detectorRef.current.detect(source);
        if (codes[0]?.rawValue) return codes[0].rawValue;
      } catch {
        /* sigue con jsQR */
      }
    }
    const canvas = canvasRef.current || (canvasRef.current = document.createElement('canvas'));
    // Se achica para leer más rápido en celulares lentos.
    const scale = Math.min(1, 800 / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorch(false);
  }, []);

  const start = useCallback(async () => {
    setMessage('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setMessage('Este navegador no permite usar la cámara acá. Usá «📸 Sacar foto del QR» o escribí el número.');
      return;
    }
    setState('starting');
    try {
      const BD = (window as any).BarcodeDetector;
      if (BD && !detectorRef.current) {
        try {
          const formats: string[] = (await BD.getSupportedFormats?.()) || ['qr_code'];
          if (formats.includes('qr_code')) detectorRef.current = new BD({ formats: ['qr_code'] });
        } catch {
          detectorRef.current = null;
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps: any = track?.getCapabilities?.() || {};
      setTorchSupported(Boolean(caps.torch));
      const video = videoRef.current!;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
      setState('live');
    } catch (e: any) {
      stop();
      setState('error');
      const name = String(e?.name || '');
      setMessage(
        name === 'NotAllowedError'
          ? 'No diste permiso para la cámara. Activalo en la configuración del navegador (🔒 junto a la dirección › Cámara › Permitir) o usá «📸 Sacar foto del QR».'
          : name === 'NotFoundError'
            ? 'No se encontró una cámara. Usá «📸 Sacar foto del QR» o escribí el número.'
            : 'No se pudo abrir la cámara. Probá «📸 Sacar foto del QR» o escribí el número.',
      );
    }
  }, [stop]);

  // Lectura continua mientras la cámara está prendida.
  useEffect(() => {
    if (state !== 'live') return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (!alive) return;
      const v = videoRef.current;
      if (!busy && !pausedRef.current && v && v.readyState >= 2 && v.videoWidth) {
        busy = true;
        try {
          const text = await decodeFrom(v, v.videoWidth, v.videoHeight);
          if (text && alive) emit(text);
        } finally {
          busy = false;
        }
      }
      if (alive) window.setTimeout(tick, 180);
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [state, decodeFrom, emit]);

  useEffect(() => () => stop(), [stop]);

  const toggleTorch = async () => {
    const track: any = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch(!torch);
    } catch {
      setTorchSupported(false);
    }
  };

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const text = await decodeFrom(img, img.naturalWidth, img.naturalHeight);
      if (text) emit(text);
      else setMessage('No se encontró un QR en la foto. Sacala de cerca, con buena luz y el QR entero.');
    } catch {
      setMessage('No se pudo leer la foto.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="relative aspect-square overflow-hidden rounded-3xl border border-cyan-500/30 bg-black shadow-2xl">
        <video ref={videoRef} className={`h-full w-full object-cover ${state === 'live' ? '' : 'hidden'}`} playsInline muted />
        {state === 'live' ? (
          <>
            <div className="pointer-events-none absolute inset-[14%] rounded-3xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <div className="pointer-events-none absolute inset-x-[16%] top-1/2 h-0.5 animate-pulse bg-cyan-400/90 shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
            <div className="absolute inset-x-0 bottom-3 text-center text-xs font-bold text-white drop-shadow">
              {paused ? '⏳ Procesando…' : hint || 'Apuntá al QR de la guía'}
            </div>
            <div className="absolute right-3 top-3 flex gap-2">
              {torchSupported && (
                <button type="button" className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white" onClick={() => void toggleTorch()}>
                  {torch ? '🔦 Apagar luz' : '🔦 Luz'}
                </button>
              )}
              <button
                type="button"
                className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-bold text-white"
                onClick={() => {
                  stop();
                  setState('idle');
                }}
              >
                ✕ Cerrar cámara
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-5xl">📷</div>
            <button
              type="button"
              className="rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-3 text-base font-black text-white shadow-lg disabled:opacity-60"
              disabled={state === 'starting'}
              onClick={() => void start()}
            >
              {state === 'starting' ? 'Abriendo cámara…' : 'Abrir cámara y escanear'}
            </button>
            <div className="text-[11px] text-slate-400">La primera vez el celular te pide permiso para usar la cámara: tocá «Permitir».</div>
          </div>
        )}
      </div>

      {message && <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">{message}</div>}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-900/70 px-3 py-2.5 text-sm font-bold text-slate-200">
          📸 Sacar foto del QR
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void fromPhoto(e.target.files?.[0])} />
        </label>
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) {
              lastRef.current = { value: '', at: 0 };
              emit(manual);
              setManual('');
            }
          }}
        >
          <input className="app-input min-w-0 !py-2" placeholder="o escribí el N° de pedido" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button type="submit" className="nav-btn active !px-3">
            OK
          </button>
        </form>
      </div>
    </div>
  );
}
