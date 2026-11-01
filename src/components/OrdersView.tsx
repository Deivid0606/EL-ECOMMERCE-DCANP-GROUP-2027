import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { generateTrackingLink } from '@/lib/tracking';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const getLocalDate = (value: string | null | undefined) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const getSafeDateRange = (fromDate: string, toDate: string) => {
  return fromDate <= toDate
    ? { from: fromDate, to: toDate }
    : { from: toDate, to: fromDate };
};

// Obtener fecha de hace 3 días
const getLast3Days = () => {
  const today = new Date();
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(today.getDate() - 3);
  return {
    from: threeDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10)
  };
};

const STATUS1_ALL = [
  'PENDIENTE', 'EN RUTA', 'ENTREGADO', 'ENCOMIENDA ENTREGADA',
  'CANCELADO', 'REAGENDADO', 'NO CONTESTA', 'RECHAZADO',
  'RECHAZADO EN EL LUGAR', 'NO DESEA', 'CANCELÓ POR WHATSAPP', 'DEVUELTO A DEPÓSITO'
];
const STATUS1_DELIVERY = STATUS1_ALL.filter(s => s !== 'DEVUELTO A DEPÓSITO');
const STATUS2_ALL = ['--', 'GUIA GENERADA', 'FUERA DE COBERTURA', 'CANCELADO', 'REPETIDO', 'RENDIDO'];

interface EditOrder {
  id: string;
  customer_name: string;
  phone: string;
  city: string;
  street: string;
  district: string;
  email: string;
  obs: string;
  assigned_at: string;
  provider_email?: string;
}

// "Delivery", "Admin", ... para mostrar quién reportó.
const roleLabel = (role: string | null | undefined) =>
  ({ DELIVERY: 'Delivery', ADMIN: 'Admin', PROVEEDOR: 'Proveedor', VENDEDOR: 'Vendedor', DESPACHANTE: 'Despachante' } as Record<string, string>)[
    String(role || '').toUpperCase()
  ] || 'Usuario';

interface HistoryEntry {
  id: string;
  previous_status: string | null;
  new_status: string;
  changed_by_email: string;
  changed_by_role: string;
  changed_by_name?: string | null;
  event_type?: 'status' | 'assignment' | 'carry' | string;
  message: string | null;
  attachment_url: string | null;
  created_at: string;
}

function isProviderAllowed(order: any, userEmail: string): boolean {
  const orderProviderEmail = order.provider_email;
  if (!orderProviderEmail) return false;
  return norm(orderProviderEmail) === norm(userEmail);
}

// ============================================
// STOCK DE PEDIDOS
// Lo descuenta y repone la base de datos (order_stock_ledger):
// - ENTREGADO / ENCOMIENDA ENTREGADA: baja el stock propio del delivery; si no
//   tiene (o no le alcanza), baja el global (stock y real_stock).
// - DEVUELTO A DEPÓSITO: repone exactamente lo descontado.
// Acá sólo se informa el resultado.
// ============================================
const isStockDiscountStatus = (status: string | null | undefined) => {
  const s = norm(String(status || ''));
  return s === 'entregado' || s === 'encomienda entregada';
};

const isStockReturnStatus = (status: string | null | undefined) =>
  norm(String(status || '')) === norm('DEVUELTO A DEPÓSITO');

const getDeliveryEmailFromOrder = (order: any) =>
  String(
    order?.delivery_email ||
    order?.assigned_delivery ||
    order?.assigned_to ||
    order?.delivery ||
    ''
  ).trim().toLowerCase();

const showOrderStockResult = async (orderId: string, returned: boolean) => {
  const { data, error } = await supabase
    .from('order_stock_ledger' as any)
    .select('qty_delivery, qty_global, reverted_at')
    .eq('order_id', orderId)
    .order('applied_at', { ascending: false });

  if (error) return;
  const rows = (data || []) as unknown as { qty_delivery: number; qty_global: number; reverted_at: string | null }[];

  if (returned) {
    const units = rows.filter(r => r.reverted_at).reduce((n, r) => n + r.qty_delivery + r.qty_global, 0);
    if (units) toast.success(`↩️ Stock repuesto: ${units} unidad(es)`);
    return;
  }

  const active = rows.filter(r => !r.reverted_at);
  const fromDelivery = active.reduce((n, r) => n + r.qty_delivery, 0);
  const fromGlobal = active.reduce((n, r) => n + r.qty_global, 0);
  if (fromDelivery || fromGlobal) {
    toast.success(
      `📦 Stock descontado: ${[
        fromDelivery ? `${fromDelivery} del delivery` : '',
        fromGlobal ? `${fromGlobal} del global` : '',
      ].filter(Boolean).join(' + ')}`
    );
  }
};

// Modal para solicitar comentario y captura
function StatusChangeModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  newStatus,
  uploading 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: (message: string, attachment: File | null) => void; 
  newStatus: string;
  uploading: boolean;
}) {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('📁 Archivo seleccionado:', { name: file.name, size: file.size, type: file.type });
      setAttachment(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      console.log('📁 Archivo arrastrado:', { name: file.name, size: file.size, type: file.type });
      setAttachment(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      toast.error('Por favor, sube un archivo de imagen válido');
    }
  };

  const handleSubmit = () => {
    if (!message.trim()) {
      toast.error('Debes escribir un comentario');
      return;
    }
    if (!attachment) {
      toast.error('Debes adjuntar una captura de pantalla');
      return;
    }
    console.log('📤 Enviando al padre:', { message, attachmentName: attachment.name });
    onConfirm(message, attachment);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/80 z-[10000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-white">
            Cambiar a {newStatus}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Comentario <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white min-h-[100px] focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Ej: Llamé 3 veces y no contestó..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 text-gray-300">
              Captura de pantalla <span className="text-red-500">*</span>
            </label>
            <div
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <span className="text-2xl">📸</span>
                <span className="text-sm text-gray-400">
                  Haz clic o arrastra una imagen aquí
                </span>
                <span className="text-xs text-gray-500">
                  PNG, JPG, GIF hasta 5MB
                </span>
              </label>
            </div>
            {preview && (
              <div className="mt-3">
                <div className="relative inline-block">
                  <img 
                    src={preview} 
                    alt="Preview" 
                    className="max-h-40 rounded-lg border border-gray-600"
                  />
                  <button
                    onClick={() => {
                      setAttachment(null);
                      setPreview(null);
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors" onClick={onClose} disabled={uploading}>
            Cancelar
          </button>
          <button className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors" onClick={handleSubmit} disabled={uploading}>
            {uploading ? 'Subiendo...' : 'Confirmar cambio'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Modal de historial CON FONDO OSCURO y BOTÓN VER ARCHIVO
function HistoryModal({ isOpen, onClose, order, history, loading }: { 
  isOpen: boolean; 
  onClose: () => void; 
  order: any; 
  history: any[]; 
  loading: boolean;
}) {
  const [fullImageUrl, setFullImageUrl] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const statusClass = (s: string) => {
    if (s === 'ENTREGADO' || s === 'ENCOMIENDA ENTREGADA') return 'bg-green-500/20 text-green-400 border-green-500/30';
    if (['CANCELADO', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'NO DESEA', 'CANCELÓ POR WHATSAPP', 'NO CONTESTA'].includes(s)) return 'bg-red-500/20 text-red-400 border-red-500/30';
    if (s === 'EN RUTA') return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  };

  // Estadísticas simplificadas
  const totalChanges = history.length;
  const uniqueUsers = new Set(history.map(h => h.changed_by_email)).size;
  const statusCounts: Record<string, number> = {};
  history.forEach(h => {
    statusCounts[h.new_status] = (statusCounts[h.new_status] || 0) + 1;
  });
  const mostCommonStatus = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0];

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-2 sm:p-4" onClick={() => { onClose(); setFullImageUrl(null); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 sm:p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-start mb-6 sticky top-0 bg-gray-900 pb-2 z-10">
          <div>
            <h4 className="text-xl font-extrabold flex items-center gap-2 text-white">
              📜 Historial de Estados
              <span className="text-sm font-normal text-gray-400">
                Pedido #{order?.order_number || order?.id?.slice(0, 8)}
              </span>
            </h4>
            <p className="text-sm text-gray-400 mt-1">
              Cliente: {order?.customer_name} | Ciudad: {order?.city}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none">✕</button>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400">Cargando historial...</div>
        ) : history.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            No hay cambios registrados en este pedido
          </div>
        ) : (
          <>
            {/* KPIs SIMPLIFICADOS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4 text-white shadow-lg">
                <div className="text-2xl font-bold">{totalChanges}</div>
                <div className="text-xs opacity-90">Cambios totales</div>
              </div>
              <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-xl p-4 text-white shadow-lg">
                <div className="text-2xl font-bold">{uniqueUsers}</div>
                <div className="text-xs opacity-90">Usuarios distintos</div>
              </div>
              <div className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl p-4 text-white shadow-lg">
                <div className="text-2xl font-bold">{mostCommonStatus?.[1] || 0}</div>
                <div className="text-xs opacity-90">Estado más usado</div>
                <div className="text-xs font-mono mt-1 truncate">{mostCommonStatus?.[0] || '—'}</div>
              </div>
            </div>

            {/* Timeline de cambios */}
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {history.map((item) => (
                <div key={item.id} className="relative pl-8 pb-6 last:pb-0 before:content-[''] before:absolute before:left-3 before:top-0 before:bottom-0 before:w-0.5 before:bg-gradient-to-b before:from-blue-500 before:to-transparent">
                  {/* Círculo de timeline */}
                  <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center ring-4 ring-gray-900">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  </div>
                  
                  <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 hover:bg-gray-800 transition-all duration-200">
                    {/* Header */}
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono bg-gray-700 px-2 py-1 rounded-md text-gray-300">
                          {new Date(item.created_at).toLocaleString('es-PY', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          item.changed_by_role === 'ADMIN' ? 'bg-red-500/20 text-red-400' :
                          item.changed_by_role === 'DELIVERY' ? 'bg-green-500/20 text-green-400' :
                          item.changed_by_role === 'PROVEEDOR' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-gray-500/20 text-gray-400'
                        }`}>
                          {item.changed_by_role || 'Usuario'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <span>👤</span>
                        <span className="font-mono truncate max-w-[150px]">{item.changed_by_email}</span>
                      </div>
                    </div>
                    
                    {item.event_type && item.event_type !== 'status' ? (
                      /* Asignación o pase de día: el detalle viene en el mensaje */
                      <div className={`p-3 rounded-lg border-l-4 ${item.event_type === 'assignment' ? 'bg-sky-500/10 border-sky-500' : 'bg-violet-500/10 border-violet-500'}`}>
                        <p className="text-sm font-semibold text-gray-100">{item.message}</p>
                        <p className="mt-1 text-xs text-gray-400">
                          Por {roleLabel(item.changed_by_role)} {item.changed_by_name || item.changed_by_email} · estado {item.new_status}
                        </p>
                      </div>
                    ) : (
                      <>
                      {/* Quién reportó */}
                      <p className="mb-2 text-sm text-gray-200">
                        {item.changed_by_role === 'DELIVERY' ? '🚚' : '👤'}{' '}
                        <b>{roleLabel(item.changed_by_role)} {item.changed_by_name || item.changed_by_email}</b>{' '}
                        <span className="text-gray-400">reportó</span> <b>{item.new_status}</b>
                      </p>

                      {/* Cambio de estado */}
                      <div className="flex items-center gap-2 flex-wrap mb-3 p-2 rounded-lg bg-gray-900/50">
                        <span className={`text-sm font-medium px-2 py-0.5 rounded-full border ${statusClass(item.previous_status || 'PENDIENTE')}`}>
                          {item.previous_status || '—'}
                        </span>
                        <span className="text-gray-500">→</span>
                        <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${statusClass(item.new_status)}`}>
                          {item.new_status}
                        </span>
                      </div>
                    
                      {/* Mensaje */}
                      {item.message && (
                        <div className="mt-2 p-3 bg-amber-500/10 rounded-lg border-l-4 border-amber-500">
                          <div className="flex items-start gap-2">
                            <span className="text-base">💬</span>
                            <p className="text-sm text-gray-300 flex-1">{item.message}</p>
                          </div>
                        </div>
                      )}
                    
                      </>
                    )}

                    {/* BOTÓN VER ARCHIVO ADJUNTO */}
                    {item.attachment_url && (
                      <div className="mt-3">
                        <button
                          onClick={() => window.open(item.attachment_url!, '_blank')}
                          className="flex items-center gap-2 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-colors text-sm"
                        >
                          <span>📎</span>
                          <span>Ver archivo adjunto</span>
                        </button>
                        {!imageErrors[item.id] && (
                          <div 
                            className="cursor-pointer group mt-2 inline-block"
                            onClick={() => setFullImageUrl(item.attachment_url!)}
                          >
                            <img 
                              src={item.attachment_url} 
                              alt="Vista previa" 
                              className="max-h-32 rounded-lg border border-gray-600 object-cover hover:opacity-90 transition-opacity"
                              onError={(e) => {
                                console.error('Error cargando previsualización:', item.attachment_url);
                                setImageErrors(prev => ({ ...prev, [item.id]: true }));
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            <div className="text-xs text-center text-gray-500 mt-1 group-hover:text-blue-400">
                              🔍 Click para ampliar
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        
        {/* Footer */}
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-700 sticky bottom-0 bg-gray-900">
          <button className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors" onClick={onClose}>
            Cerrar
          </button>
          <button 
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            onClick={() => {
              const historyText = history.map(h => 
                `[${new Date(h.created_at).toLocaleString('es-PY')}] ${roleLabel(h.changed_by_role)} ${h.changed_by_name || h.changed_by_email} reportó: ${h.previous_status || '—'} → ${h.new_status}${h.message ? `\n  💬 ${h.message}` : ''}${h.attachment_url ? `\n  📎 Archivo adjunto: ${h.attachment_url}` : ''}`
              ).join('\n\n');
              navigator.clipboard.writeText(historyText);
              toast.success('Historial copiado al portapapeles');
            }}
          >
            📋 Copiar historial
          </button>
        </div>
      </div>

      {/* Modal de imagen ampliada */}
      {fullImageUrl && (
        <div className="fixed inset-0 bg-black/95 z-[10001] flex items-center justify-center p-4" onClick={() => setFullImageUrl(null)}>
          <div className="relative max-w-5xl max-h-[90vh]">
            <img 
              src={fullImageUrl} 
              alt="Captura ampliada" 
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onError={(e) => {
                console.error('Error cargando imagen ampliada:', fullImageUrl);
                toast.error('No se pudo cargar la imagen');
                setFullImageUrl(null);
              }}
            />
            <button
              onClick={() => setFullImageUrl(null)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 text-2xl bg-black/50 rounded-full w-8 h-8 flex items-center justify-center"
            >
              ✕
            </button>
            <button
              onClick={() => window.open(fullImageUrl, '_blank')}
              className="absolute -bottom-12 right-0 text-white hover:text-gray-300 text-sm bg-black/50 px-3 py-1 rounded-lg"
            >
              Abrir en nueva pestaña
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

export default function OrdersView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const myEmail = profile?.email || '';

  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [clientPrices, setClientPrices] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const last3Days = getLast3Days();
  const [dateFrom, setDateFrom] = useState(() => last3Days.from);
  const [dateTo, setDateTo] = useState(() => last3Days.to);
  const [loading, setLoading] = useState(false);
  const [editOrder, setEditOrder] = useState<EditOrder | null>(null);
  const [guideText, setGuideText] = useState('');
  const [guideOrderId, setGuideOrderId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [orderHistory, setOrderHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  
  const [statusChangeModal, setStatusChangeModal] = useState<{
    isOpen: boolean;
    orderId: string;
    newStatus: string;
    oldStatus: string;
  }>({
    isOpen: false,
    orderId: '',
    newStatus: '',
    oldStatus: ''
  });

  const fetchAllOrdersPaginated = async () => {
    const { data, error } = await fetchAllRows('orders', (q) => q.order('created_at', { ascending: false }));
    if (error) throw error;
    return data;
  };

  // Carga robusta de deliveries.
  // Fuentes:
  // 1) profiles.role = DELIVERY
  // 2) user_roles.role = DELIVERY
  // 3) deliveries ya asignados en pedidos
  // 4) emails presentes en delivery_stock
  // Así el selector no queda vacío si una tabla tiene RLS o IDs inconsistentes.
  const loadDeliveryProfiles = async (ordersData: any[]) => {
    const deliveryMap = new Map<string, { email: string; name: string; user_id?: string }>();

    const addDelivery = (emailValue: any, nameValue?: any, userIdValue?: any) => {
      const email = String(emailValue || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return;

      const current = deliveryMap.get(email);
      const name = String(nameValue || '').trim();

      deliveryMap.set(email, {
        email,
        name: name || current?.name || email,
        user_id: String(userIdValue || current?.user_id || '').trim() || undefined,
      });
    };

    let profiles: any[] = [];

    // Primero intentamos leer el rol directamente desde profiles.
    const profilesWithRole = await supabase
      .from('profiles')
      .select('email, name, user_id, role');

    if (!profilesWithRole.error) {
      profiles = profilesWithRole.data || [];
    } else {
      console.warn('⚠️ No se pudo leer profiles.role; usando consulta compatible:', profilesWithRole.error);
      const basicProfiles = await supabase
        .from('profiles')
        .select('email, name, user_id');

      if (basicProfiles.error) {
        console.error('❌ No se pudieron cargar perfiles para deliveries:', basicProfiles.error);
      } else {
        profiles = basicProfiles.data || [];
      }
    }

    // user_roles puede estar protegido por RLS. Si falla, no interrumpe Pedidos.
    const rolesRes = await supabase
      .from('user_roles')
      .select('user_id, role')
      .eq('role', 'DELIVERY');

    if (rolesRes.error) {
      console.warn('⚠️ No se pudo leer user_roles para deliveries:', rolesRes.error);
    }

    const deliveryUserIds = new Set(
      (rolesRes.data || [])
        .map((row: any) => String(row?.user_id || '').trim())
        .filter(Boolean)
    );

    for (const profileRow of profiles) {
      const profileRole = norm(String(profileRow?.role || ''));
      const profileUserId = String(profileRow?.user_id || '').trim();

      if (profileRole === 'delivery' || deliveryUserIds.has(profileUserId)) {
        addDelivery(profileRow?.email, profileRow?.name, profileUserId);
      }
    }

    // Respaldo: deliveries que ya figuran en pedidos históricos.
    for (const order of ordersData || []) {
      const email = getDeliveryEmailFromOrder(order);
      if (email) addDelivery(email, email);
    }

    // Respaldo adicional: deliveries con stock asignado.
    const deliveryStockRes = await supabase
      .from('delivery_stock')
      .select('delivery_email');

    if (deliveryStockRes.error) {
      console.warn('⚠️ No se pudo leer delivery_stock para completar deliveries:', deliveryStockRes.error);
    } else {
      for (const row of deliveryStockRes.data || []) {
        addDelivery(row?.delivery_email, row?.delivery_email);
      }
    }

    return Array.from(deliveryMap.values()).sort((a, b) =>
      (a.name || a.email).localeCompare(b.name || b.email, 'es')
    );
  };

  const loadOrders = async () => {
    setLoading(true);

    let allOrdersData: any[] = [];

    try {
      allOrdersData = await fetchAllOrdersPaginated();
    } catch (ordersError: any) {
      console.error('Error cargando pedidos:', ordersError);
      toast.error('Error al cargar pedidos: ' + (ordersError?.message || 'Error desconocido'));
      setLoading(false);
      return;
    }

    const [deliveriesRes, providersRes] = await Promise.all([
      loadDeliveryProfiles(allOrdersData),
      supabase.from('profiles').select('email, name, company_name').eq('role', 'PROVEEDOR')
    ]);

    if (providersRes.error) {
      console.warn('⚠️ No se pudieron cargar proveedores:', providersRes.error);
    }

    setAllOrders(allOrdersData || []);

    const { from, to } = getSafeDateRange(dateFrom, dateTo);

    const filteredByDate = (allOrdersData || []).filter(order => {
      const orderDate = getLocalDate(order.created_at);
      if (!orderDate) return false;
      return orderDate >= from && orderDate <= to;
    });

    setOrders(filteredByDate);
    setDeliveries(deliveriesRes);
    setProviders(providersRes.data || []);
    setLoading(false);
    supabase.from('client_prices').select('*').order('city').then(({ data }) => setClientPrices(data || []));
  };

  useEffect(() => {
    if (allOrders.length > 0) {
      const { from, to } = getSafeDateRange(dateFrom, dateTo);

      const filteredByDate = allOrders.filter(order => {
        const orderDate = getLocalDate(order.created_at);
        if (!orderDate) return false;
        return orderDate >= from && orderDate <= to;
      });

      setOrders(filteredByDate);
    }
  }, [dateFrom, dateTo, allOrders]);

  useEffect(() => {
    loadOrders();
  }, []);

  const filtered = useMemo(() => {
    const q = norm(search);
    return orders.filter(o => {
      if (role === 'VENDEDOR' && norm(o.created_by || '') !== norm(myEmail)) return false;
      if (role === 'DELIVERY' && norm(o.assigned_delivery || '') !== norm(myEmail)) return false;
      if (role === 'PROVEEDOR' && !isProviderAllowed(o, myEmail)) return false;

      if (statusFilter && (o.status || 'PENDIENTE') !== statusFilter) return false;

      if (q) {
        const idNum = String(o.order_number || o.id || '').replace(/^[a-z]+/i, '');
        const hay = [o.customer_name, o.phone, o.order_number, o.id, idNum, o.city, o.created_by, o.assigned_delivery, o.provider_email].map(norm).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, search, statusFilter, role, myEmail]);

  const postNews = async (message: string, orderNum: string) => {
    await supabase.from('news').insert({
      message, order_id: orderNum, actor_email: myEmail, role_scope: role,
    });
  };

  const uploadAttachment = async (file: File, orderId: string): Promise<string | null> => {
    try {
      console.log('1. Iniciando subida de archivo:', { fileName: file.name, fileSize: file.size, orderId });
      
      const fileExt = file.name.split('.').pop();
      const fileName = `${orderId}_${Date.now()}.${fileExt}`;
      const filePath = `order_attachments/${fileName}`;
      
      console.log('2. Path del archivo:', filePath);
      
      const { error: uploadError, data } = await supabase.storage
        .from('order_attachments')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true
        });
        
      if (uploadError) {
        console.error('3. Error en upload:', uploadError);
        toast.error('Error al subir la imagen: ' + uploadError.message);
        return null;
      }
      
      console.log('3. Archivo subido exitosamente:', data);
      
      const { data: urlData } = supabase.storage
        .from('order_attachments')
        .getPublicUrl(filePath);
      
      console.log('4. URL pública generada:', urlData.publicUrl);
      
      return urlData.publicUrl;
    } catch (error) {
      console.error('Error en uploadAttachment:', error);
      toast.error('Error inesperado al subir la imagen');
      return null;
    }
  };

  const saveToHistory = async (
    orderId: string, 
    previousStatus: string, 
    newStatus: string, 
    message?: string, 
    attachmentUrl?: string
  ) => {
    console.log('Guardando en historial:', { orderId, previousStatus, newStatus, message, attachmentUrl });
    
    const { data, error } = await supabase
      .from('order_status_history')
      .insert({
        order_id: orderId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_by_email: myEmail,
        changed_by_role: role,
        message: message || null,
        attachment_url: attachmentUrl || null
      })
      .select();
    
    if (error) {
      console.error('Error guardando en historial:', error);
      toast.error('Error al guardar el historial: ' + error.message);
    } else {
      console.log('Historial guardado exitosamente:', data);
    }
  };

  const handleStatusChangeWithValidation = async (orderId: string, newStatus: string) => {
    console.log('handleStatusChangeWithValidation:', { orderId, newStatus, role });
    
    if (role === 'DELIVERY' && (newStatus === 'NO CONTESTA' || newStatus === 'CANCELADO')) {
      const order = orders.find(o => o.id === orderId);
      console.log('Abriendo modal para delivery con estado requerido');
      setStatusChangeModal({
        isOpen: true,
        orderId,
        newStatus,
        oldStatus: order?.status || 'PENDIENTE'
      });
      return;
    }
    
    await executeStatusChange(orderId, newStatus, '', null);
  };

  const executeStatusChange = async (
    orderId: string,
    newStatus: string,
    message: string = '',
    attachmentUrl: string | null = null
  ) => {
    console.log('executeStatusChange:', { orderId, newStatus, message, attachmentUrl });

    if (role === 'DELIVERY' && newStatus === 'DEVUELTO A DEPÓSITO') {
      toast.error('No podés usar DEVUELTO A DEPÓSITO');
      return false;
    }

    let order = orders.find(o => o.id === orderId) || allOrders.find(o => o.id === orderId);

    // Si el pedido no está en el estado local por el filtro de fecha, lo traemos de Supabase.
    if (!order) {
      const { data: dbOrder, error: dbOrderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      if (dbOrderError || !dbOrder) {
        console.error('❌ No se encontró el pedido para cambiar estado:', dbOrderError);
        toast.error('No se encontró el pedido');
        return false;
      }

      order = dbOrder;
    }

    const oldStatus = order?.status || 'PENDIENTE';
    const orderNum = order?.order_number || orderId.slice(0, 8);

    const updates: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (isStockDiscountStatus(newStatus)) {
      updates.delivered_at = order?.delivered_at || new Date().toISOString();
    }

    await saveToHistory(orderId, oldStatus, newStatus, message, attachmentUrl);

    const { error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId);

    if (error) {
      console.error('Error actualizando pedido:', error);
      toast.error(error.message);
      return false;
    }

    setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));
    toast.success(`Estado → ${newStatus}`);
    const reporter = `${roleLabel(role)} ${profile?.name?.trim() || myEmail}`;
    postNews(
      `${role === 'DELIVERY' ? '🚚' : '📦'} ${reporter} reportó ${newStatus} en el pedido ${orderNum}` +
        `${message?.trim() ? `: “${message.trim()}”` : ''}${attachmentUrl ? ' 📷' : ''}`,
      orderNum
    );

    // El stock lo descuenta/repone la base de datos al cambiar el estado.
    if (isStockDiscountStatus(newStatus) || isStockReturnStatus(newStatus)) {
      await showOrderStockResult(orderId, isStockReturnStatus(newStatus));
    }

    return true;
  };

  // ============================================
  // CAMBIO DE ESTADO CON COMENTARIO/ARCHIVO
  // El stock lo descuenta/repone la base de datos (order_stock_ledger).
  // ============================================
  const processStatusChangeWithData = async (message: string, attachment: File | null) => {
    console.log('processStatusChangeWithData iniciado:', { message, hasAttachment: !!attachment });
    setUploadingFile(true);

    try {
      let attachmentUrl: string | null = null;

      if (attachment) {
        console.log('Subiendo attachment...');
        attachmentUrl = await uploadAttachment(attachment, statusChangeModal.orderId);
        console.log('URL obtenida:', attachmentUrl);

        if (!attachmentUrl) {
          console.error('No se pudo obtener la URL del archivo');
          setUploadingFile(false);
          return;
        }
      }

      await executeStatusChange(
        statusChangeModal.orderId,
        statusChangeModal.newStatus,
        message,
        attachmentUrl
      );

      setStatusChangeModal({ isOpen: false, orderId: '', newStatus: '', oldStatus: '' });
    } finally {
      setUploadingFile(false);
    }
  };

  const handleStatus1Change = async (orderId: string, newStatus: string) => {
    await handleStatusChangeWithValidation(orderId, newStatus);
  };

  const handleStatus2Change = async (orderId: string, newStatus2: string) => {
    const val = newStatus2 === '--' ? null : newStatus2;
    const order = orders.find(o => o.id === orderId);
    const oldStatus2 = order?.status2 || null;
    const orderNum = order?.order_number || orderId.slice(0, 8);

    const updates: any = {
      status2: val,
      updated_at: new Date().toISOString(),
    };

    await saveToHistory(orderId, oldStatus2 || '--', val || '--', `Estado 2 cambiado a ${val || 'ninguno'}`, null);

    const { error } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', orderId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(val ? `Estado 2 → ${val}` : 'Guía removida: vuelve a Despacho');

    setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));

    if (val) {
      postNews(`Pedido ${orderNum} estado 2 → ${val}`, orderNum);
    } else {
      postNews(`Pedido ${orderNum} quedó sin guía generada por ${myEmail}`, orderNum);
    }

  };

  const handleAssignDelivery = async (orderId: string, deliveryEmail: string) => {
    const order = orders.find(o => o.id === orderId);
    const orderNum = order?.order_number || orderId.slice(0, 8);
    const updates: any = {
      assigned_delivery: deliveryEmail || null,
      assigned_at: deliveryEmail ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    if (deliveryEmail) updates.status = 'EN RUTA';
    const { error } = await supabase.from('orders').update(updates).eq('id', orderId);
    if (error) { toast.error(error.message); return; }
    toast.success(deliveryEmail ? `Asignado a ${deliveryEmail}` : 'Delivery removido');
    setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));
    if (deliveryEmail) postNews(`${myEmail} asignó pedido ${orderNum} a ${deliveryEmail}`, orderNum);
  };

  const handleAssignProvider = async (orderId: string, providerEmail: string) => {
    const order = orders.find(o => o.id === orderId);
    const orderNum = order?.order_number || orderId.slice(0, 8);

    const { error } = await supabase
      .from('orders')
      .update({
        provider_email: providerEmail || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(providerEmail ? `Proveedor: ${providerEmail}` : 'Proveedor removido');
    setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, provider_email: providerEmail } : o));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, provider_email: providerEmail } : o));
    if (providerEmail) {
      postNews(`${myEmail} asignó pedido ${orderNum} al proveedor ${providerEmail}`, orderNum);
    }
  };

  // Link de seguimiento en vivo (admin, proveedor del pedido o su delivery).
  const canTrack = (o: any) =>
    Boolean(o?.assigned_delivery) &&
    !['ENTREGADO', 'ENCOMIENDA ENTREGADA', 'CANCELADO', 'CANCELÓ POR WHATSAPP', 'NO DESEA', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'DEVUELTO A DEPÓSITO'].includes(
      String(o?.status || '').toUpperCase(),
    ) &&
    (role === 'ADMIN' || role === 'PROVEEDOR' || role === 'DELIVERY');

  const shareTracking = async (o: any) => {
    const url = await generateTrackingLink(o);
    if (url) window.dispatchEvent(new Event('dcanp-tracking-created'));
  };

  const loadOrderHistory = async (order: any) => {
    setLoadingHistory(true);
    setSelectedOrder(order);
    
    const { data, error } = await supabase
      .from('order_status_history')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false });
      
    if (error) {
      toast.error('Error cargando historial: ' + error.message);
      setOrderHistory([]);
    } else {
      console.log('Historial cargado:', data?.length, 'registros');
      setOrderHistory(data || []);
    }
    
    setLoadingHistory(false);
    setHistoryModalOpen(true);
  };

  const openEdit = (o: any) => {
    setEditOrder({
      id: o.id,
      customer_name: o.customer_name || '',
      phone: o.phone || '',
      city: o.city || '',
      street: o.street || '',
      district: o.district || '',
      email: o.email || '',
      obs: o.obs || '',
      assigned_at: o.assigned_at ? new Date(o.assigned_at).toISOString().slice(0, 16) : '',
      provider_email: o.provider_email || '',
    });
  };

  const saveEdit = async () => {
    if (!editOrder) return;
    if (!editOrder.customer_name || !editOrder.phone || !editOrder.city) {
      toast.error('Cliente, teléfono y ciudad son obligatorios');
      return;
    }
    const { id, assigned_at, provider_email, ...data } = editOrder;
    const updates: any = { ...data, updated_at: new Date().toISOString() };
    if (assigned_at) updates.assigned_at = new Date(assigned_at).toISOString();
    if (provider_email !== undefined) updates.provider_email = provider_email;
    const { error } = await supabase.from('orders').update(updates).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Pedido actualizado');
    setAllOrders(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...updates } : o));
    setEditOrder(null);
  };

  const cancelOrder = async (orderId: string) => {
    const order = orders.find(o => o.id === orderId);
    const orderNum = order?.order_number || orderId.slice(0, 8);
    
    await saveToHistory(orderId, order?.status || 'PENDIENTE', 'CANCELADO', 'Pedido cancelado por usuario');
    
    const { error } = await supabase.from('orders').update({ status: 'CANCELADO', updated_at: new Date().toISOString() }).eq('id', orderId);
    if (error) { toast.error(error.message); return; }
    toast.success('Pedido cancelado');
    setAllOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELADO' } : o));
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'CANCELADO' } : o));
    postNews(`Pedido ${orderNum} fue CANCELADO por ${myEmail}`, orderNum);
  };

  const deleteOrderPermanently = async (orderId: string) => {
    if (!['ADMIN', 'DESPACHANTE', 'PROVEEDOR'].includes(role)) {
      toast.error('No tienes permiso para eliminar pedidos');
      return;
    }

    const order = orders.find(o => o.id === orderId);

    if (role === 'PROVEEDOR' && !isProviderAllowed(order, myEmail)) {
      toast.error('No puedes eliminar pedidos de otros proveedores');
      return;
    }

    const orderNum = order?.order_number || orderId.slice(0, 8);

    const { error } = await supabase.from('orders').delete().eq('id', orderId);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success('Pedido ELIMINADO permanentemente');
    setAllOrders(prev => prev.filter(o => o.id !== orderId));
    setOrders(prev => prev.filter(o => o.id !== orderId));
    await postNews(`Pedido ${orderNum} fue ELIMINADO PERMANENTEMENTE por ${myEmail}`, orderNum);
  };

  const generateGuide = (o: any) => {
    try {
      const items = typeof o.items_json === 'string'
        ? JSON.parse(o.items_json || '[]')
        : (o.items_json || []);

      // Mostrar únicamente producto y cantidad, sin precios parciales.
      const itemsText = items.map((it: any, i: number) =>
        `${i + 1}. ${it.title || it.sku || 'Item'} x${it.qty || it.quantity || 1} —`
      ).join('\n');

      const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

      const text = [
        `GUÍA DE ENVÍO — ${o.order_number || o.id.slice(0, 8)}`,
        separator,
        `Cliente: ${o.customer_name || ''}`,
        `Teléfono: ${o.phone || ''}`,
        `Email: ${o.email || ''}`,
        `Departamento: ${o.department || o.departamento || ''}`,
        `Ciudad: ${o.city || ''}`,
        `Dirección: ${o.street || ''} ${o.district ? '- ' + o.district : ''}`.trimEnd(),
        '',
        `Productos:`,
        '',
        itemsText,
        '',
        `Total: Gs ${nf(Number(o.total_gs || 0))}`,
        o.obs ? `Observación: ${o.obs}` : '',
        separator,
        `Vendedor: ${o.created_by || ''}`,
        `Proveedor: ${o.provider_email || 'Sin proveedor'}`,
      ].filter(line => line !== null && line !== undefined).join('\n');

      setGuideText(text);
      setGuideOrderId(o.order_number || o.id.slice(0, 8));
    } catch {
      toast.error('Error generando guía');
    }
  };

  const copyGuide = () => {
    navigator.clipboard.writeText(guideText);
    toast.success('Guía copiada al portapapeles');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(o => o.id)));
    }
  };

  const bulkGenerateGuides = () => {
    const selected = filtered.filter(o => selectedIds.has(o.id));

    if (selected.length === 0) {
      toast.error('Seleccioná pedidos primero');
      return;
    }

    const separator = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

    const allText = selected.map(o => {
      const items = typeof o.items_json === 'string'
        ? JSON.parse(o.items_json || '[]')
        : (o.items_json || []);

      const itemsText = items.map((it: any, i: number) =>
        `${i + 1}. ${it.title || it.sku || 'Item'} x${it.qty || it.quantity || 1} —`
      ).join('\n');

      return [
        `GUÍA DE ENVÍO — ${o.order_number || o.id.slice(0, 8)}`,
        separator,
        `Cliente: ${o.customer_name || ''}`,
        `Teléfono: ${o.phone || ''}`,
        `Email: ${o.email || ''}`,
        `Departamento: ${o.department || o.departamento || ''}`,
        `Ciudad: ${o.city || ''}`,
        `Dirección: ${o.street || ''} ${o.district ? '- ' + o.district : ''}`.trimEnd(),
        '',
        `Productos:`,
        '',
        itemsText,
        '',
        `Total: Gs ${nf(Number(o.total_gs || 0))}`,
        o.obs ? `Observación: ${o.obs}` : '',
        separator,
        `Vendedor: ${o.created_by || ''}`,
        `Proveedor: ${o.provider_email || 'Sin proveedor'}`,
      ].filter(line => line !== null && line !== undefined).join('\n');
    }).join('\n\n');

    navigator.clipboard.writeText(allText);
    toast.success(`${selected.length} guías copiadas`);
  };

  const statusClass = (s: string) => {
    if (s === 'ENTREGADO' || s === 'ENCOMIENDA ENTREGADA') return 'badge-entregado';
    if (['CANCELADO', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'NO DESEA', 'CANCELÓ POR WHATSAPP', 'NO CONTESTA'].includes(s)) return 'badge-cancelado';
    if (s === 'EN RUTA') return 'badge-entregado';
    return 'badge-pendiente';
  };

  const canEditStatus1 = role !== 'VENDEDOR';
  const canEditStatus2 = role === 'ADMIN' || role === 'DESPACHANTE' || role === 'PROVEEDOR';
  const canAssign = ['ADMIN', 'DESPACHANTE', 'PROVEEDOR'].includes(role);
  const canEdit = role === 'ADMIN' || role === 'DESPACHANTE' || role === 'PROVEEDOR';
  const canDeletePermanently = ['ADMIN', 'DESPACHANTE', 'PROVEEDOR'].includes(role);
  const canAssignProvider = role === 'ADMIN' || role === 'DESPACHANTE';

  return (
    <div className="app-card">
      <h3 className="text-lg font-extrabold mb-3">Pedidos</h3>

      <div className="flex flex-col sm:flex-row flex-wrap items-center gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label className="app-label !mt-0">Desde</label>
          <input type="date" className="app-input flex-1 sm:!w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <label className="app-label !mt-0">Hasta</label>
          <input type="date" className="app-input flex-1 sm:!w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
        <button 
          className="nav-btn !bg-gray-500 text-xs !py-1 !px-2"
          onClick={() => {
            const last3 = getLast3Days();
            setDateFrom(last3.from);
            setDateTo(last3.to);
            loadOrders();
          }}
          title="Últimos 3 días"
        >
          📅 Últimos 3 días
        </button>
        <select className="app-input w-full sm:!w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          {STATUS1_ALL.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="app-input w-full sm:!w-auto sm:min-w-[250px] sm:flex-1" placeholder="🔎 Buscar por cliente, teléfono, ID, ciudad o proveedor"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className="nav-btn active w-full sm:w-auto" onClick={loadOrders} disabled={loading}>{loading ? 'Cargando...' : 'Actualizar'}</button>
        {selectedIds.size > 0 && (
          <button className="nav-btn w-full sm:w-auto" onClick={bulkGenerateGuides}>📋 Copiar {selectedIds.size} guías</button>
        )}
      </div>

      <div className="text-xs text-muted-foreground mb-2">
        {filtered.length} pedidos (últimos 3 días: {dateFrom} a {dateTo})
      </div>

      {/* Tabla Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="app-table min-w-[1000px]">
          <thead>
            <tr>
              <th className="!w-[40px] text-center">
                <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll} title="Seleccionar todos" />
              </th>
              <th>Fecha</th>
              <th>ID</th>
              <th>Ciudad</th>
              <th>Cliente</th>
              <th>Vendedor</th>
              <th>Proveedor</th>
              {role !== 'DESPACHANTE' && <th>Delivery</th>}
              <th className="text-right">Total (Gs)</th>
              <th className="text-right">{role === 'DELIVERY' ? 'Tarifa (Gs)' : 'Comisión (Gs)'}</th>
              <th>Estado 1</th>
              {role !== 'DELIVERY' && <th>Estado 2</th>}
              {canAssign && <th>Asignar Delivery</th>}
              <th>Guía</th>
              {canEdit && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={16} className="text-center text-muted-foreground py-8">
                  Sin pedidos en los últimos 3 días
                </td>
              </tr>
            )}
            {filtered.map(o => {
              const feeStored = Number(o.delivery_fee_gs || 0);
              const commVal = role === 'DELIVERY' ? feeStored : Number(o.commission_gs || 0);
              const dateShown = (role === 'DELIVERY' && o.assigned_at)
                ? new Date(o.assigned_at).toLocaleString('es-PY')
                : new Date(o.created_at).toLocaleString('es-PY');

              return (
                <tr key={o.id}>
                  <td className="text-center">
                    <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
                  </td>
                  <td className="whitespace-nowrap text-xs">{dateShown}</td>
                  <td className="font-bold text-xs">{o.order_number || o.id.slice(0, 8)}</td>
                  <td className="text-xs">{o.city}</td>
                  <td className="text-xs">{o.customer_name}</td>
                  <td className="text-xs">{o.created_by}</td>
                  <td className="text-xs">
                    {canAssignProvider ? (
                      <select
                        className="app-input !py-1 !px-2 !text-[11px] !w-auto !min-w-[180px]"
                        value={o.provider_email || ''}
                        onChange={e => handleAssignProvider(o.id, e.target.value)}
                      >
                        <option value="">-- Sin proveedor --</option>
                        {providers.map(p => (
                          <option key={p.email} value={p.email}>
                            {p.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs font-medium text-blue-600">{o.provider_email || '—'}</span>
                    )}
                  </td>
                  {role !== 'DESPACHANTE' && <td className="text-xs">{o.assigned_delivery || '—'}</td>}
                  <td className="text-right text-xs font-bold">{nf(Number(o.total_gs || 0))}</td>
                  <td className="text-right text-xs">{nf(commVal)}</td>
                  <td>
                    {canEditStatus1 ? (
                      <select
                        className="app-input !py-1 !px-2 !text-[11px] !w-auto !min-w-[130px]"
                        value={o.status || 'PENDIENTE'}
                        onChange={e => handleStatus1Change(o.id, e.target.value)}
                      >
                        {(role === 'DELIVERY' ? STATUS1_DELIVERY : STATUS1_ALL).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`badge-status ${statusClass(o.status || '')}`}>{o.status || 'PENDIENTE'}</span>
                    )}
                  </td>
                  {role !== 'DELIVERY' && (
                    <td>
                      {canEditStatus2 ? (
                        <select
                          className="app-input !py-1 !px-2 !text-[11px] !w-auto !min-w-[120px]"
                          value={o.status2 || '--'}
                          onChange={e => handleStatus2Change(o.id, e.target.value)}
                        >
                          {STATUS2_ALL.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span className="text-xs text-muted-foreground">{o.status2 || '—'}</span>
                      )}
                    </td>
                  )}
                  {canAssign && (
                    <td>
                      <select
                        className="app-input !py-1 !px-2 !text-[11px] !w-auto !min-w-[140px]"
                        value={o.assigned_delivery || ''}
                        onChange={e => handleAssignDelivery(o.id, e.target.value)}
                      >
                        <option value="">-- Sin asignar --</option>
                        {deliveries.map(d => (
                          <option key={d.email} value={d.email}>{d.name || d.email}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td>
                    <div className="flex gap-1">
                      <button className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => generateGuide(o)} title="Ver guía">📄</button>
                      <button className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => { generateGuide(o); setTimeout(copyGuide, 100); }} title="Copiar guía">📋</button>
                      <button 
                        className="nav-btn !px-2 !py-1 !text-[10px] !bg-blue-600/20 hover:!bg-blue-600/40 text-blue-700"
                        onClick={() => loadOrderHistory(o)}
                        title="Ver historial de cambios"
                      >
                        📜 Historial
                      </button>
                      {canTrack(o) && (
                        <button
                          className="nav-btn !px-2 !py-1 !text-[10px] !bg-emerald-600/20 hover:!bg-emerald-600/40"
                          onClick={() => void shareTracking(o)}
                          title="Generar link de seguimiento en vivo para el cliente"
                        >
                          🛵 Link
                        </button>
                      )}
                    </div>
                  </td>
                  {canEdit && (
                    <td>
                      <div className="flex gap-1">
                        <button className="nav-btn !px-2 !py-1 !text-[10px]" onClick={() => openEdit(o)}>✏️ Editar</button>
                        <button
                          className="nav-btn !px-2 !py-1 !text-[10px] !bg-yellow-600/20 hover:!bg-yellow-600/40 text-yellow-700"
                          onClick={() => {
                            if (confirm('¿Cancelar este pedido? (Solo cambiará el estado a CANCELADO)'))
                              cancelOrder(o.id);
                          }}
                        >
                          ⛔ Cancelar
                        </button>
                        {canDeletePermanently && (
                          <button
                            className="nav-btn !px-2 !py-1 !text-[10px] !bg-red-600/20 hover:!bg-red-600/40 text-red-700"
                            onClick={() => {
                              if (confirm('⚠️ ¿ELIMINAR PERMANENTEMENTE este pedido?\n\nEsta acción NO se puede deshacer y borrará todos los datos del pedido de la base de datos.'))
                                deleteOrderPermanently(o.id);
                            }}
                          >
                            🗑️ Eliminar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Vista Celular - Tarjetas simplificada */}
      <div className="md:hidden space-y-3">
        {filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-8">Sin pedidos en los últimos 3 días</div>
        )}
        {filtered.map(o => {
          const feeStored = Number(o.delivery_fee_gs || 0);
          const commVal = role === 'DELIVERY' ? feeStored : Number(o.commission_gs || 0);
          const dateShown = (role === 'DELIVERY' && o.assigned_at)
            ? new Date(o.assigned_at).toLocaleString('es-PY')
            : new Date(o.created_at).toLocaleString('es-PY');

          return (
            <div key={o.id} className="bg-card border border-border rounded-lg p-4 shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-bold text-sm">{o.order_number || o.id.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{dateShown}</div>
                </div>
                <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} />
              </div>

              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-1">
                  <span className="font-medium">Cliente:</span>
                  <span className="text-right">{o.customer_name}</span>
                  <span className="font-medium">Ciudad:</span>
                  <span className="text-right">{o.city}</span>
                  <span className="font-medium">Total:</span>
                  <span className="text-right font-bold">Gs {nf(Number(o.total_gs || 0))}</span>
                </div>

                <div className="pt-2">
                  <span className="font-medium block mb-1">Estado 1:</span>
                  {canEditStatus1 ? (
                    <select
                      className="app-input !py-2 !px-2 !text-sm w-full"
                      value={o.status || 'PENDIENTE'}
                      onChange={e => handleStatus1Change(o.id, e.target.value)}
                    >
                      {(role === 'DELIVERY' ? STATUS1_DELIVERY : STATUS1_ALL).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`inline-block badge-status ${statusClass(o.status || '')}`}>{o.status || 'PENDIENTE'}</span>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <button className="nav-btn flex-1 !py-2 !text-sm" onClick={() => generateGuide(o)}>
                    📄 Ver Guía
                  </button>
                  <button 
                    className="nav-btn flex-1 !py-2 !text-sm !bg-blue-600/20 text-blue-700"
                    onClick={() => loadOrderHistory(o)}
                  >
                    📜 Historial
                  </button>
                  {canTrack(o) && (
                    <button className="nav-btn flex-1 !py-2 !text-sm !bg-emerald-600/20" onClick={() => void shareTracking(o)}>
                      🛵 Link seguimiento
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modales */}
      {editOrder && createPortal(
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-2 sm:p-4" onClick={() => setEditOrder(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3" onClick={e => e.stopPropagation()}>
            <h4 className="text-lg font-extrabold text-white">Editar Pedido</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Cliente *</label>
                <input className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white" value={editOrder.customer_name} onChange={e => setEditOrder({ ...editOrder, customer_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Teléfono *</label>
                <input className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white" value={editOrder.phone} onChange={e => setEditOrder({ ...editOrder, phone: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Ciudad *</label>
                <select className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white" value={editOrder.city} onChange={e => setEditOrder({ ...editOrder, city: e.target.value })}>
                  <option value="">Seleccionar ciudad…</option>
                  {clientPrices.map(c => <option key={c.id} value={c.city}>{c.city}</option>)}
                  {editOrder.city && !clientPrices.find(c => c.city === editOrder.city) && (
                    <option value={editOrder.city}>{editOrder.city}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Calle</label>
                <input className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white" value={editOrder.street} onChange={e => setEditOrder({ ...editOrder, street: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Barrio</label>
                <input className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white" value={editOrder.district} onChange={e => setEditOrder({ ...editOrder, district: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1">Observaciones</label>
                <textarea className="w-full px-3 py-2 border border-gray-600 rounded-lg bg-gray-800 text-white min-h-[60px]" value={editOrder.obs} onChange={e => setEditOrder({ ...editOrder, obs: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600" onClick={() => setEditOrder(null)}>Cancelar</button>
              <button className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={saveEdit}>Guardar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {guideText && createPortal(
        <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-2 sm:p-4" onClick={() => setGuideText('')}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-4 sm:p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <h4 className="text-lg font-extrabold mb-3 text-white">Guía — {guideOrderId}</h4>
            <pre className="text-xs sm:text-sm whitespace-pre-wrap bg-gray-800 p-3 sm:p-5 rounded-xl border border-gray-700 max-h-[60vh] overflow-auto leading-relaxed text-gray-300">{guideText}</pre>
            <div className="flex gap-2 justify-end mt-4">
              <button className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600" onClick={() => setGuideText('')}>Cerrar</button>
              <button className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700" onClick={copyGuide}>Copiar</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <StatusChangeModal
        isOpen={statusChangeModal.isOpen}
        onClose={() => setStatusChangeModal({ isOpen: false, orderId: '', newStatus: '', oldStatus: '' })}
        onConfirm={processStatusChangeWithData}
        newStatus={statusChangeModal.newStatus}
        uploading={uploadingFile}
      />

      <HistoryModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        order={selectedOrder}
        history={orderHistory}
        loading={loadingHistory}
      />
    </div>
  );
}
