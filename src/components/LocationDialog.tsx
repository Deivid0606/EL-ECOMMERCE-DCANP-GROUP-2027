import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type LocationChoice =
  | { action: 'cancel' }
  | { action: 'keep' }
  | { action: 'clear' }
  | { action: 'set'; text: string };

type Request = {
  title: string;
  current: { lat: number; lng: number } | null;
  confirmLabel: string;
  resolve: (choice: LocationChoice) => void;
};

let openRequest: ((req: Request) => void) | null = null;

/**
 * Pide la ubicación del cliente: muestra la que ya está cargada y permite
 * mantenerla, cambiarla o borrarla.
 */
export function askCustomerLocation(opts: {
  title?: string;
  current: { lat: number; lng: number } | null;
  confirmLabel?: string;
}): Promise<LocationChoice> {
  return new Promise((resolve) => {
    const req: Request = {
      title: opts.title || '📍 Ubicación del cliente',
      current: opts.current,
      confirmLabel: opts.confirmLabel || 'Generar link',
      resolve,
    };
    if (openRequest) openRequest(req);
    else {
      // Sin el diálogo montado: aviso simple del navegador.
      const answer = window.prompt('Ubicación del cliente (link de Google Maps, "lat, lng" o dirección). Vacío = sin cambios:', '');
      if (answer === null) resolve({ action: 'cancel' });
      else if (!answer.trim()) resolve({ action: 'keep' });
      else resolve({ action: 'set', text: answer });
    }
  });
}

export default function LocationDialogHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    openRequest = (r) => {
      setText('');
      setEditing(!r.current);
      setReq(r);
    };
    return () => {
      openRequest = null;
    };
  }, []);

  const finish = (choice: LocationChoice) => {
    req?.resolve(choice);
    setReq(null);
  };

  const pasteFromClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (value) setText(value);
    } catch {
      // Sin permiso para leer el portapapeles: se pega a mano.
    }
  };

  const cur = req?.current;
  const mapsLink = cur ? `https://www.google.com/maps?q=${cur.lat},${cur.lng}` : '';

  return (
    <Dialog open={Boolean(req)} onOpenChange={(open) => !open && finish({ action: 'cancel' })}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{req?.title}</DialogTitle>
          <DialogDescription>
            Sirve para mostrar la llegada estimada y el punto del cliente en el mapa.
          </DialogDescription>
        </DialogHeader>

        {cur && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <div className="font-bold text-emerald-300">✅ Ubicación cargada</div>
            <a href={mapsLink} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-sky-300 underline">
              {cur.lat.toFixed(5)}, {cur.lng.toFixed(5)} · ver en Google Maps
            </a>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="nav-btn" onClick={() => setEditing(true)}>
                ✏️ Cambiar ubicación
              </button>
              <button
                type="button"
                className="nav-btn !border-red-500/40 !text-red-300"
                onClick={() => {
                  if (window.confirm('¿Borrar la ubicación del cliente?')) finish({ action: 'clear' });
                }}
              >
                🗑️ Borrar ubicación
              </button>
            </div>
          </div>
        )}

        {editing && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              {cur ? 'Nueva ubicación' : 'Ubicación (opcional)'}: link de Google Maps (también el de "Compartir"), la ubicación que te mandó por
              WhatsApp, "latitud, longitud" o la dirección.
            </label>
            <textarea
              className="w-full rounded-xl border border-border bg-background p-2 text-sm"
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="https://maps.app.goo.gl/…  o  -25.3092, -57.6325"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="nav-btn" onClick={() => void pasteFromClipboard()}>
                📋 Pegar
              </button>
              {text && (
                <button type="button" className="nav-btn" onClick={() => setText('')}>
                  ✖️ Limpiar
                </button>
              )}
            </div>
          </div>
        )}

        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" className="nav-btn" onClick={() => finish({ action: 'cancel' })}>
            Cancelar
          </button>
          <button
            type="button"
            className="nav-btn active"
            onClick={() => finish(text.trim() ? { action: 'set', text: text.trim() } : { action: 'keep' })}
          >
            {req?.confirmLabel}
            {!text.trim() && !cur ? ' sin ubicación' : ''}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
