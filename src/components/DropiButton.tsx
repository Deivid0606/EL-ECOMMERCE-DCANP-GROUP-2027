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

/** ID numérico de Dropi a partir del ID o del link del producto (…/product-details/14348/…). */
export const dropiIdFrom = (v: string) => {
  const t = String(v || '').trim();
  const fromUrl = t.match(/product-details\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(t) ? t : '';
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

// Departamento de las ciudades más comunes (para Dropi, que cubre todo el país aunque
// la ciudad no esté en nuestras tarifas).
const PY_DEPTS: Record<string, string[]> = {
  Central: ['Luque', 'San Lorenzo', 'Capiatá', 'Lambaré', 'Fernando de la Mora', 'Limpio', 'Ñemby', 'Mariano Roque Alonso', 'Itauguá', 'Villa Elisa', 'San Antonio', 'Areguá', 'Ypané', 'Itá', 'Guarambaré', 'J. Augusto Saldívar', 'Villeta', 'Nueva Italia', 'Ypacaraí'],
  Amambay: ['Pedro Juan Caballero', 'Bella Vista Norte', 'Capitán Bado', 'Zanja Pytã', 'Karapaí'],
  'Alto Paraná': ['Ciudad del Este', 'Hernandarias', 'Presidente Franco', 'Minga Guazú', 'Santa Rita', 'Naranjal', 'Juan León Mallorquín', 'Itakyry', 'Los Cedrales', 'Colonia Yguazú'],
  Itapúa: ['Encarnación', 'Hohenau', 'Obligado', 'Bella Vista', 'Coronel Bogado', 'Cambyretá', 'Capitán Miranda', 'María Auxiliadora', 'Natalio', 'Fram', 'Carmen del Paraná', 'Trinidad', 'Edelira'],
  Caaguazú: ['Coronel Oviedo', 'Caaguazú', 'Campo 9', 'Doctor Juan Eulogio Estigarribia', 'Repatriación', 'Yhú', 'Mauricio José Troche', 'Natalicio Talavera'],
  Concepción: ['Concepción', 'Horqueta', 'Yby Yaú', 'Belén', 'Loreto'],
  'San Pedro': ['San Pedro del Ycuamandiyú', 'Santa Rosa del Aguaray', 'San Estanislao', 'Choré', 'Guayaibí', 'Lima', 'Nueva Germania'],
  Cordillera: ['Caacupé', 'Tobatí', 'Piribebuy', 'Eusebio Ayala', 'San Bernardino', 'Altos', 'Atyrá', 'Emboscada', 'Arroyos y Esteros'],
  Guairá: ['Villarrica', 'Independencia', 'Paso Yobái', 'Mbocayaty'],
  Caazapá: ['Caazapá', 'San Juan Nepomuceno', 'Yuty'],
  Misiones: ['San Juan Bautista', 'San Ignacio', 'Santa Rosa', 'Ayolas', 'Santiago'],
  Paraguarí: ['Paraguarí', 'Carapeguá', 'Yaguarón', 'Quiindy', 'Ybycuí', 'Acahay', 'Pirayú'],
  Ñeembucú: ['Pilar', 'Alberdi'],
  Canindeyú: ['Salto del Guairá', 'Curuguaty', 'Katueté', 'La Paloma', 'Ypejhú', 'Corpus Christi', 'Nueva Esperanza'],
  'Presidente Hayes': ['Villa Hayes', 'Benjamín Aceval', 'Pozo Colorado'],
  Boquerón: ['Filadelfia', 'Loma Plata', 'Mariscal Estigarribia', 'Neuland'],
  'Alto Paraguay': ['Fuerte Olimpo'],
};
const DEPT_BY_CITY = new Map<string, string>(
  Object.entries(PY_DEPTS).flatMap(([dept, cities]) => cities.map((c) => [prodKey(c), dept] as [string, string])),
);
export const departmentForCity = (city: string) => DEPT_BY_CITY.get(prodKey(city)) || '';

export const buildDropiPayload = (o: DropiOrder, dropiId: string) => {
  const qty = Math.max(1, Math.round(Number(o.qty) || 1));
  const total = Math.round(Number(o.total) || 0);
  return {
    ...splitName(o.customer),
    phone: dropiPhone(o.phone),
    department: o.department || departmentForCity(o.city || ''),
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
    const ref = dropiId.trim();
    saveId(order.product, ref);
    const json = JSON.stringify(payload);
    try {
      await navigator.clipboard.writeText(`DCANP_DROPI:${json}`);
    } catch {
      /* el link ya lleva los datos */
    }
    // Los datos viajan en el link (#dcanp=...): la extensión los lee y completa sola.
    const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const id = dropiIdFrom(ref);
    const base = id ? `https://app.dropi.com.py/dashboard/product-details/${id}/producto` : DROPI_SEARCH_URL;
    window.open(`${base}#dcanp=${b64}`, '_blank', 'noopener');
    toast.success(
      id
        ? '🟠 Abriendo el producto en Dropi: con la extensión el formulario se completa solo.'
        : '🟠 Abriendo Dropi. Tip: poné el ID del producto (o el link) para que abra directo el formulario.',
      { duration: 9000 },
    );
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

              <label className="app-label">ID del producto en Dropi (o pegá su link)</label>
              <input
                className="app-input"
                placeholder="Ej. 14348"
                value={dropiId}
                onChange={(e) => setDropiId(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Es el número «ID: …» del producto en Dropi. Se recuerda para este producto.
              </p>

              <button type="button" className="nav-btn active mt-3 w-full !py-2.5" onClick={() => void go()}>
                🟠 Abrir en Dropi y completar
              </button>

              <button type="button" className="mt-3 text-xs font-bold text-primary underline" onClick={() => setShowHelp((v) => !v)}>
                {showHelp ? 'Ocultar' : '¿Primera vez? Instalá la extensión (se hace una sola vez)'}
              </button>
              {showHelp && (
                <div className="mt-2 space-y-2 rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-xs">
                  <p className="font-bold">✨ Extensión: abre el formulario y lo completa solo</p>
                  <p>
                    <b>1.</b>{' '}
                    <a href="/dcanp-dropi-extension.zip" download className="font-bold text-primary underline">
                      Descargá la extensión
                    </a>{' '}
                    y descomprimí el .zip en una carpeta que no vayas a borrar.
                  </p>
                  <p>
                    <b>2.</b> En Chrome entrá a <b>chrome://extensions</b> y activá <b>Modo de desarrollador</b> (arriba a la derecha).
                  </p>
                  <p>
                    <b>3.</b> Tocá <b>Cargar descomprimida</b> y elegí esa carpeta. Listo: aparece «DCANP → Dropi».
                  </p>
                  <p>
                    <b>4.</b> Iniciá sesión en Dropi una vez. Desde ahí: <b>Cargar a Dropi</b> → <b>Abrir en Dropi y completar</b> → se abre el
                    producto con el formulario lleno → elegís transportadora y tocás <b>Enviar al cliente</b>.
                  </p>
                  <hr className="border-orange-500/30" />
                  <p className="text-muted-foreground">
                    Sin extensión: arrastrá <BookmarkletLink /> a la barra de favoritos (Ctrl+Shift+B) y tocalo en la pestaña de Dropi que se abre. El cartel naranja de Dropi tiene que decir <b>«versión 3»</b>; si no lo dice, borrá el favorito o la extensión vieja e instalá la nueva.
                  </p>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
