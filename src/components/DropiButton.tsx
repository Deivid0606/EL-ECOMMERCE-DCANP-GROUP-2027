import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import fillSource from '@/lib/dropiFill.bookmarklet.js?raw';

export type DropiOrder = {
  customer: string;
  phone: string;
  department?: string;
  city?: string;
  address?: string;
  email?: string;
  product: string;
  qty: number;
  total: number;
  notes?: string;
};

const DROPI_SEARCH_URL = 'https://app.dropi.com.py/dashboard/search?search_type=semantic';
const ID_KEY = 'dcanp_dropi_ids';
const nf = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(Number(n) || 0));
const prodKey = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const readIds = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(ID_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
const saveId = (product: string, id: string) => {
  try {
    const all = readIds();
    if (id) all[prodKey(product)] = id;
    else delete all[prodKey(product)];
    localStorage.setItem(ID_KEY, JSON.stringify(all));
  } catch {
    /* sin storage */
  }
};

/** Teléfono para Dropi: sin +595 y sin el 0 inicial (ej. 981123456). */
export const dropiPhone = (p: string) => String(p || '').replace(/\D/g, '').replace(/^595/, '').replace(/^0+/, '');

export const splitName = (full: string) => {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], lastName: parts[1] };
  const half = Math.ceil(parts.length / 2);
  return { firstName: parts.slice(0, half).join(' '), lastName: parts.slice(half).join(' ') };
};

export const buildDropiPayload = (o: DropiOrder, dropiId: string) => {
  const qty = Math.max(1, Math.round(Number(o.qty) || 1));
  const total = Math.round(Number(o.total) || 0);
  return {
    ...splitName(o.customer),
    phone: dropiPhone(o.phone),
    department: o.department || '',
    city: o.city || '',
    address: o.address || '',
    email: o.email || '',
    qty,
    unitPrice: Math.round(total / qty),
    total,
    product: o.product,
    dropiId: dropiId.trim(),
    dropiSearch: (dropiId.trim() || o.product || '').trim(),
    notes: o.notes || '',
  };
};

function BookmarkletLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // React no permite href "javascript:" en JSX: se pone a mano.
    ref.current?.setAttribute('href', `javascript:${encodeURIComponent(fillSource)}`);
  }, []);
  return (
    <a
      ref={ref}
      onClick={(e) => {
        e.preventDefault();
        toast.info('Arrastrá este botón a tu barra de favoritos de Chrome (no lo toques acá).');
      }}
      className="inline-flex cursor-grab items-center gap-1 rounded-xl bg-orange-500 px-3 py-2 text-sm font-black text-white shadow-lg"
      title="Arrastralo a la barra de favoritos"
    >
      🟠 Llenar Dropi
    </a>
  );
}

/** Botón "🟠 Cargar a Dropi": copia el pedido y abre Dropi; el favorito "Llenar Dropi" completa el formulario. */
export default function DropiButton({ order, className }: { order: DropiOrder; className?: string }) {
  const [open, setOpen] = useState(false);
  const [dropiId, setDropiId] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const start = () => {
    setDropiId(readIds()[prodKey(order.product)] || '');
    setOpen(true);
  };

  const payload = buildDropiPayload(order, dropiId);

  const go = async () => {
    saveId(order.product, dropiId.trim());
    const text = `DCANP_DROPI:${JSON.stringify(payload)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('Copiá estos datos (Ctrl+C):', text);
    }
    window.open(DROPI_SEARCH_URL, '_blank', 'noopener');
    toast.success('📋 Pedido copiado. En Dropi tocá el favorito 🟠 Llenar Dropi: busca el producto, abre el formulario y lo completa.', { duration: 9000 });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className={className || 'rounded-xl bg-orange-500/90 px-3 py-2 text-xs font-black text-white transition hover:bg-orange-500'}
        onClick={(e) => {
          e.stopPropagation();
          start();
        }}
        title="Cargar este pedido en Dropi"
      >
        🟠 Cargar a Dropi
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3" onClick={() => setOpen(false)}>
            <div
              className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-background p-4 text-sm text-foreground shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-lg font-black">🟠 Cargar a Dropi</h4>
                <button type="button" className="nav-btn !px-2 !py-1 text-xs" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="space-y-1 rounded-xl bg-secondary/40 p-3 text-xs">
                <div>
                  👤 <b>{payload.firstName}</b> {payload.lastName} · 📞 {payload.phone || '—'}
                </div>
                <div>
                  📍 {payload.department || '—'} · {payload.city || '—'}
                </div>
                {payload.address && <div>🏠 {payload.address}</div>}
                <div>
                  📦 {order.product} × {payload.qty} · Gs {nf(payload.unitPrice)} c/u (total Gs {nf(payload.total)})
                </div>
              </div>

              <label className="app-label">Nombre del producto en Dropi (o su ID)</label>
              <input
                className="app-input"
                placeholder="Ej. Rodillera Termica Para El Dolor"
                value={dropiId}
                onChange={(e) => setDropiId(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Copialo tal cual aparece en Dropi: el botón «Llenar Dropi» lo busca, abre «Enviar a cliente» de ese producto y completa todo. Se
                recuerda para este producto.
              </p>

              <button type="button" className="nav-btn active mt-3 w-full !py-2.5" onClick={() => void go()}>
                📋 Copiar y abrir Dropi
              </button>

              <button type="button" className="mt-3 text-xs font-bold text-primary underline" onClick={() => setShowHelp((v) => !v)}>
                {showHelp ? 'Ocultar' : '¿Primera vez o se actualizó? Instalá el botón «Llenar Dropi»'}
              </button>
              {showHelp && (
                <div className="mt-2 space-y-2 rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-xs">
                  <p>
                    <b>1.</b> En Chrome mostrá la barra de favoritos (<b>Ctrl+Shift+B</b>).
                  </p>
                  <p>
                    <b>2.</b> Arrastrá este botón a la barra: <BookmarkletLink />
                  </p>
                  <p>
                    <b>3.</b> Iniciá sesión en Dropi una vez. Después, en cada pedido: <b>Cargar a Dropi</b> → en la pestaña de Dropi que se abre
                    tocá <b>🟠 Llenar Dropi</b> (busca el producto, abre el formulario y lo completa) → revisá, elegí transportadora y tocá{' '}
                    <b>Enviar al cliente</b>.
                  </p>
                  <p className="text-muted-foreground">La primera vez Chrome puede preguntar si Dropi puede leer el portapapeles: tocá «Permitir».</p>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
