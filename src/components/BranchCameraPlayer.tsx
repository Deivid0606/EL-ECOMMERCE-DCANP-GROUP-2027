import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, StopCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// This address is configured by the operator after deploying the secure,
// origin-locked Cloudflare Tunnel. Never let a camera record supply this URL.
const rawBase = String(import.meta.env.VITE_BRANCH_CAMERA_HLS_BASE_URL || '').trim();
const gatewayBase = (() => {
  try {
    const u = new URL(rawBase);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return '';
    return u.origin;
  } catch { return ''; }
})();
let hlsLibraryPromise: Promise<any> | null = null;
function getHlsLibrary(): Promise<any> {
  if (hlsLibraryPromise) return hlsLibraryPromise;
  hlsLibraryPromise = new Promise((resolve, reject) => {
    if ((window as any).Hls) { resolve((window as any).Hls); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => (window as any).Hls ? resolve((window as any).Hls) : reject(new Error('No se cargó el reproductor HLS.'));
    script.onerror = () => reject(new Error('No se pudo descargar el reproductor de video.'));
    document.head.appendChild(script);
  }).catch((err) => { hlsLibraryPromise = null; throw err; });
  return hlsLibraryPromise;
}

type Props = { streamId: string; name: string };
export const cameraGatewayReady = Boolean(gatewayBase);

export default function BranchCameraPlayer({ streamId, name }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!playing || !gatewayBase) return;
    let disposed = false;
    let player: any;
    let refreshTimer: number | undefined;
    let accessToken = '';
    setLoading(true);
    setError('');
    const setup = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Iniciá sesión nuevamente para ver la cámara.');
      accessToken = session.access_token;
      const Hls = await getHlsLibrary();
      if (disposed) return;
      if (!Hls?.isSupported?.()) {
        throw new Error('Este navegador no admite HLS autenticado. Probá Chrome o Edge actualizado.');
      }
      const video = videoRef.current;
      if (!video) return;
      const src = gatewayBase + '/' + encodeURIComponent(streamId) + '/index.m3u8';
      player = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        xhrSetup: (xhr: XMLHttpRequest, url: string) => {
          // Prevent sending a Supabase JWT to a redirected/third-party playlist.
          if (new URL(url, gatewayBase).origin === gatewayBase) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken);
          }
        },
      });
      player.on(Hls.Events.ERROR, (_event: any, data: any) => {
        if (data?.fatal) {
          setError('No se pudo reproducir el video. Verificá el túnel, la autorización y el servidor de la sucursal.');
          setLoading(false);
        }
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.play().catch(() => { /* User can use native Play control. */ });
      });
      player.attachMedia(video);
      player.loadSource(src);
      refreshTimer = window.setInterval(async () => {
        const result = await supabase.auth.getSession();
        if (!disposed) accessToken = result.data.session?.access_token || '';
      }, 10 * 60 * 1000);
    };
    void setup().catch((err) => { if (!disposed) { setError(String(err?.message || err)); setLoading(false); } });
    return () => {
      disposed = true;
      if (refreshTimer) window.clearInterval(refreshTimer);
      if (player) player.destroy();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
    };
  }, [streamId, playing]);
  if (!gatewayBase) return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-black/60 px-5 text-center text-white">
      <p className="font-bold">Transmisión no conectada</p>
      <p className="text-xs text-slate-400">Falta instalar el servidor local, el túnel HTTPS y configurar el dominio del gateway en Vercel.</p>
    </div>
  );
  return (
    <div className="relative aspect-video bg-black text-white">
      {playing ? (
        <>
          <video ref={videoRef} controls playsInline muted className="h-full w-full object-contain" aria-label={'Video en vivo '+name}/>
          {loading && <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 className="h-8 w-8 animate-spin text-white"/></div>}
          {error && <div className="absolute bottom-12 inset-x-2 rounded-lg bg-rose-950/90 p-2 text-xs text-white">{error}</div>}
          <button type="button" className="absolute right-2 top-2 rounded-lg bg-black/80 px-3 py-2 text-xs" onClick={()=>setPlaying(false)}>
            <StopCircle className="mr-1 inline h-4 w-4" /> Detener
          </button>
        </>
      ) : (
        <button type="button" onClick={()=>setPlaying(true)} className="flex h-full w-full flex-col items-center justify-center gap-2">
          <Play className="h-10 w-10 text-emerald-400" />
          <strong>Ver cámara en vivo</strong>
          <span className="text-xs text-slate-400">Acceso autenticado</span>
        </button>
      )}
    </div>
  );
}
