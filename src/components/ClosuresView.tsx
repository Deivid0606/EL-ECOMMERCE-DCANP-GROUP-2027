import './closures-premium.css';
import ClosurePaymentsPanel from './ClosurePaymentsPanel';
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

const getTodayAndTomorrowPY = () => {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const today = formatter.format(now);
  const [year, month, day] = today.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  const tomorrow = formatter.format(nextDate);

  return { today, tomorrow };
};

const dateKeyPY = (value: string | null | undefined) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find(part => part.type === type)?.value || '';

  const year = get('year');
  const month = get('month');
  const day = get('day');

  return year && month && day ? `${year}-${month}-${day}` : '';
};

const STATUS_1_OPTIONS = [
  'PENDIENTE',
  'EN RUTA',
  'ENTREGADO',
  'ENCOMIENDA ENTREGADA',
  'CANCELADO',
  'DEVUELTO A DEPÓSITO',
  'REAGENDADO',
  'NO CONTESTA',
] as const;


type TeamMember = {
  relation_id: string;
  owner_user_id: string;
  member_user_id: string;
  member_email: string;
  member_name: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REMOVED';
  invited_at: string;
  accepted_at: string | null;
};

type TeamInvitation = {
  relation_id: string;
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REMOVED';
  invited_at: string;
};

type AdminTeamRow = {
  relation_id: string;
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  member_user_id: string;
  member_email: string;
  member_name: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
};


type TeamClosureSummary = {
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  member_user_id: string;
  member_email: string;
  member_name: string;
  assigned_count: number;
  delivered_count: number;
  pending_receipt_count: number;
  amount_collected: number;
  delivery_fee_total: number;
  amount_to_render: number;
  fee_configured: boolean;
};

type TeamReceiptHistory = {
  receipt_id: string;
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  member_user_id: string;
  member_email: string;
  member_name: string;
  period_from: string;
  period_to: string;
  order_count: number;
  amount_collected: number;
  delivery_fee_total: number;
  amount_received: number;
  fee_configured: boolean;
  received_at: string;
  received_by_email: string;
  note: string | null;
};


const formatDatePY = (dateValue?: string | null) => {
  if (!dateValue) return '—';
  const onlyDate = dateValue.slice(0, 10);
  const [year, month, day] = onlyDate.split('-');
  if (!year || !month || !day) return '—';
  return `${day}/${month}/${year}`;
};

const dateInputValue = (dateValue?: string | null) => {
  if (!dateValue) return '';
  return dateValue.slice(0, 10);
};


const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const getOrderPhone = (order: any) =>
  String(order?.customer_phone || order?.phone || '').trim();

const normalizeWhatsAppPhone = (phoneValue: string) => {
  let phone = String(phoneValue || '').replace(/\D/g, '');

  if (phone.startsWith('595')) return phone;
  if (phone.startsWith('0')) return `595${phone.slice(1)}`;
  if (phone.startsWith('9') && phone.length >= 9) return `595${phone}`;

  return phone;
};

const getOrderItems = (order: any): any[] => {
  try {
    const raw = typeof order?.items_json === 'string'
      ? JSON.parse(order.items_json || '[]')
      : (order?.items_json || []);

    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

const buildGuideText = (order: any) => {
  const items = getOrderItems(order);

  const itemsText = items.length > 0
    ? items
        .map((item: any, index: number) => {
          const qty = Number(
            item.qty ||
            item.quantity ||
            item.cantidad ||
            1,
          );

          const label = String(
            item.title ||
            item.name ||
            item.sku ||
            'Producto',
          ).trim();

          return `${index + 1}. ${label} x${qty}`;
        })
        .join('\n')
    : 'Sin detalle de productos';

  const phone = getOrderPhone(order);

  const address = [
    String(order?.street || '').trim(),
    String(order?.district || '').trim(),
  ]
    .filter(Boolean)
    .join(', ');

  return [
    `GUÍA DE ENVÍO — ${
      order?.order_number ||
      order?.id?.slice(0, 8) ||
      '—'
    }`,
    `Cliente: ${order?.customer_name || ''}`,
    `Teléfono: ${phone}`,
    `Ciudad: ${order?.city || ''}`,
    address ? `Dirección: ${address}` : '',
    'Productos:',
    itemsText,
    `Total: Gs ${nf(Number(order?.total_gs || 0))}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const buildWhatsAppMessage = (order: any) => {
  const items = getOrderItems(order);

  const productsText = items.length > 0
    ? items
        .map((item: any, index: number) => {
          const qty = Number(
            item.qty ||
            item.quantity ||
            item.cantidad ||
            1,
          );

          const label = String(
            item.title ||
            item.name ||
            item.sku ||
            'Producto',
          ).trim();

          // Importante: no mostrar precio unitario ni subtotal por producto.
          return `${index + 1}. ${label} x${qty}`;
        })
        .join('\n')
    : 'Sin detalle de productos';

  const address = [
    String(order?.street || '').trim(),
    String(order?.district || '').trim(),
  ]
    .filter(Boolean)
    .join(', ');

  const guide = [
    `GUÍA DE ENVÍO — ${
      order?.order_number ||
      order?.id?.slice(0, 8) ||
      '—'
    }`,
    `Cliente: ${order?.customer_name || ''}`,
    `Teléfono: ${getOrderPhone(order)}`,
    `Ciudad: ${order?.city || ''}`,
    address ? `Dirección: ${address}` : '',
    'Productos:',
    productsText,
    // El único importe que se muestra es el total final del pedido.
    `Total: Gs ${nf(Number(order?.total_gs || 0))}`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `*Buenas ${order?.customer_name || ''}, le escribo para coordinar la entrega de su pedido.*`,
    '',
    '*¿Me podría indicar o enviar la ubicación por Google Maps para poder realizar la entrega?*',
    '',
    guide,
  ].join('\n');
};

const getWhatsAppUrl = (order: any) => {
  const phone = normalizeWhatsAppPhone(getOrderPhone(order));
  return phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsAppMessage(order))}`
    : '';
};

// Modal para solicitar comentario y captura
function StatusChangeModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  newStatus,
  uploading,
  orderCount = 1,
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: (message: string, attachment: File | null) => void; 
  newStatus: string;
  uploading: boolean;
  orderCount?: number;
}) {
  const [message, setMessage] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachment(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
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
    onConfirm(message, attachment);
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-[10000] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-xl font-bold mb-4">
          Cambiar {orderCount > 1 ? `${orderCount} pedidos` : 'pedido'} a {newStatus}
        </h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Comentario <span className="text-red-500">*</span>
            </label>
            <textarea
              className="app-input w-full min-h-[100px]"
              placeholder="Ej: Llamé 3 veces y no contestó..."
              value={message}
              onChange={e => setMessage(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Captura de pantalla <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="app-input w-full"
            />
            {preview && (
              <div className="mt-2">
                <img src={preview} alt="Preview" className="max-h-32 rounded-lg border" />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button className="nav-btn" onClick={onClose} disabled={uploading}>
            Cancelar
          </button>
          <button className="nav-btn active" onClick={handleSubmit} disabled={uploading}>
            {uploading ? 'Subiendo...' : 'Confirmar cambio'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Modal de historial
function HistoryModal({ isOpen, onClose, order, history, loading }: { 
  isOpen: boolean; 
  onClose: () => void; 
  order: any; 
  history: any[]; 
  loading: boolean;
}) {
  const statusClass = (s: string) => {
    if (s === 'ENTREGADO' || s === 'ENCOMIENDA ENTREGADA') return 'badge-entregado';
    if (['CANCELADO', 'RECHAZADO', 'RECHAZADO EN EL LUGAR', 'NO DESEA', 'CANCELÓ POR WHATSAPP', 'NO CONTESTA'].includes(s)) return 'badge-cancelado';
    if (s === 'EN RUTA') return 'badge-entregado';
    return 'badge-pendiente';
  };

  const getHistoryStats = () => {
    const totalChanges = history.length;
    const uniqueUsers = new Set(history.map(h => h.changed_by_email)).size;
    const statusCounts: Record<string, number> = {};
    history.forEach(h => {
      statusCounts[h.new_status] = (statusCounts[h.new_status] || 0) + 1;
    });
    const mostCommonStatus = Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0];
    
    return { totalChanges, uniqueUsers, mostCommonStatus };
  };

  if (!isOpen) return null;

  const stats = getHistoryStats();

  return createPortal(
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-5xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <h4 className="text-xl font-extrabold flex items-center gap-2">
              📜 Historial de Estados
              <span className="text-sm font-normal text-muted-foreground">
                Pedido #{order?.order_number || order?.id?.slice(0, 8)}
              </span>
            </h4>
            <p className="text-sm text-muted-foreground mt-1">
              Cliente: {order?.customer_name} | Ciudad: {order?.city}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-2xl leading-none">✕</button>
        </div>

        {loading ? (
          <div className="text-center py-12">Cargando historial...</div>
        ) : history.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            No hay cambios registrados en este pedido
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white">
                <div className="text-3xl font-bold">{stats.totalChanges}</div>
                <div className="text-sm opacity-90">Cambios totales</div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white">
                <div className="text-3xl font-bold">{stats.uniqueUsers}</div>
                <div className="text-sm opacity-90">Usuarios distintos</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white">
                <div className="text-3xl font-bold">{stats.mostCommonStatus?.[1] || 0}</div>
                <div className="text-sm opacity-90">Estado más usado</div>
                <div className="text-xs font-mono mt-1">{stats.mostCommonStatus?.[0] || '—'}</div>
              </div>
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-4 text-white">
                <div className="text-3xl font-bold">{history[0]?.new_status || '—'}</div>
                <div className="text-sm opacity-90">Estado actual</div>
              </div>
            </div>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
              {history.map((item) => (
                <div key={item.id} className="relative pl-8 before:content-[''] before:absolute before:left-3 before:top-0 before:bottom-0 before:w-0.5 before:bg-border">
                  <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-primary"></div>
                  </div>
                  
                  <div className="bg-background border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-muted px-2 py-1 rounded">
                          {new Date(item.created_at).toLocaleString('es-PY', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit'
                          })}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded-full ${
                          item.changed_by_role === 'ADMIN' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          item.changed_by_role === 'DELIVERY' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                          item.changed_by_role === 'PROVEEDOR' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                          {item.changed_by_role || 'Usuario'}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground font-mono">
                        {item.changed_by_email}
                      </span>
                    </div>
                    
                    {item.event_type && item.event_type !== 'status' ? (
                      <div className={`mb-3 p-3 rounded-lg border-l-4 ${item.event_type === 'assignment' ? 'bg-sky-500/10 border-sky-500' : 'bg-violet-500/10 border-violet-500'}`}>
                        <p className="text-sm font-semibold">{item.message}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Por {item.changed_by_name || item.changed_by_email} · estado {item.new_status}
                        </p>
                      </div>
                    ) : (
                      <>
                      <p className="mb-2 text-sm">
                        {item.changed_by_role === 'DELIVERY' ? '🚚' : '👤'}{' '}
                        <b>
                          {({ DELIVERY: 'Delivery', ADMIN: 'Admin', PROVEEDOR: 'Proveedor', VENDEDOR: 'Vendedor', DESPACHANTE: 'Despachante' } as Record<string, string>)[
                            String(item.changed_by_role || '').toUpperCase()
                          ] || 'Usuario'}{' '}
                          {item.changed_by_name || item.changed_by_email}
                        </b>{' '}
                        <span className="text-muted-foreground">reportó</span> <b>{item.new_status}</b>
                      </p>

                      <div className="flex items-center gap-3 flex-wrap mb-3">
                        <span className={`text-sm font-medium px-3 py-1 rounded-lg ${statusClass(item.previous_status || 'PENDIENTE')} bg-opacity-20`}>
                          {item.previous_status || '—'}
                        </span>
                        <span className="text-muted-foreground text-lg">→</span>
                        <span className={`text-sm font-bold px-3 py-1 rounded-lg ${statusClass(item.new_status)}`}>
                          {item.new_status}
                        </span>
                      </div>
                    
                      </>
                    )}

                    {item.message && (!item.event_type || item.event_type === 'status') && (
                      <div className="mt-2 p-3 bg-muted/30 rounded-lg border-l-4 border-blue-500">
                        <div className="flex items-start gap-2">
                          <span className="text-base">💬</span>
                          <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">Mensaje:</div>
                            <div className="text-sm">{item.message}</div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {item.attachment_url && (
                      <div className="mt-3">
                        <button
                          onClick={() => window.open(item.attachment_url, '_blank')}
                          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-950/30 px-3 py-2 rounded-lg transition-colors"
                        >
                          <span>🖼️</span>
                          <span>Ver captura adjunta</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-border">
          <button className="nav-btn" onClick={onClose}>Cerrar</button>
          <button 
            className="nav-btn active"
            onClick={() => {
              navigator.clipboard.writeText(
                history.map(h => 
                  `[${new Date(h.created_at).toLocaleString('es-PY')}] ${h.changed_by_role} (${h.changed_by_email}): ${h.previous_status || '—'} → ${h.new_status}${h.message ? ` - Mensaje: ${h.message}` : ''}`
                ).join('\n')
              );
              toast.success('Historial copiado al portapapeles');
            }}
          >
            📋 Copiar historial
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ClosuresView() {
  const { profile } = useAuth();
  const myEmail = profile?.email || '';
  const myRole = profile?.role || '';
  
  const isSupplier = myRole === 'PROVEEDOR';
  const isAdmin = myRole === 'ADMIN';
  const isVendedor = myRole === 'VENDEDOR';
  const isDelivery = myRole === 'DELIVERY';

  // Permisos base declarados temprano para evitar referencias antes de inicialización.
  const canEditFull = isAdmin || isSupplier;
  const canEditStatus1 = isAdmin || isSupplier || isDelivery || isVendedor;
  const canManageRendicion = isAdmin || isSupplier;
  const canViewRendicion = isAdmin || isSupplier || isDelivery;
  const canMarkContacted = isAdmin || isDelivery || isSupplier;
  const canBulkStatus = isAdmin || isSupplier || isDelivery;
  
  const [orders, setOrders] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [fees, setFees] = useState<any[]>([]);
  // Intentos pagados al delivery (estados configurados, ej. RECHAZADO EN EL LUGAR) por pedido.
  const [attemptPayByOrder, setAttemptPayByOrder] = useState<Map<string, number>>(new Map());
  const [clientPrices, setClientPrices] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  
  const [filterDeliveries, setFilterDeliveries] = useState<Set<string>>(new Set());
  const [deliverySearch, setDeliverySearch] = useState('');
  const [showDeliveryDropdown, setShowDeliveryDropdown] = useState(false);
  const MAX_SUPPLIERS = 10;
  const [filterSuppliers, setFilterSuppliers] = useState<Set<string>>(new Set());
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [filterStatuses, setFilterStatuses] = useState<Set<string>>(new Set());
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'settled' | 'pending'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [rendicionNote, setRendicionNote] = useState('');
  const [rendicionPagada, setRendicionPagada] = useState<{ id: string; pagado_en: string; nota: string; marcado_por: string } | null>(null);
  const [dateFrom, setDateFrom] = useState(
    () => getTodayAndTomorrowPY().today,
  );
  const [dateTo, setDateTo] = useState(
    () => getTodayAndTomorrowPY().tomorrow,
  );
  const [filterDateBy, setFilterDateBy] = useState<'assigned_at' | 'created_at'>('assigned_at');
  const [totalPedidosAsignados, setTotalPedidosAsignados] = useState(0);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [selectedGuideIds, setSelectedGuideIds] = useState<Set<string>>(new Set());
  const [updatingContactedIds, setUpdatingContactedIds] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<'orders' | 'team' | 'teamClosures'>('orders');
  const [closureTab, setClosureTab] = useState<'resumen' | 'pedidos' | 'repetidos' | 'pagos' | 'historial' | 'config'>('resumen');
  const [bulkStatus, setBulkStatus] = useState<string>('EN RUTA');
  const [bulkRetiroStatus, setBulkRetiroStatus] = useState<string>('REALIZADO');
  const [bulkTeamUserId, setBulkTeamUserId] = useState<string>('');
  const [bulkAssignedDate, setBulkAssignedDate] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamInvitations, setTeamInvitations] = useState<TeamInvitation[]>([]);
  const [allTeams, setAllTeams] = useState<AdminTeamRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamClosureSummary, setTeamClosureSummary] = useState<TeamClosureSummary[]>([]);
  const [teamReceiptHistory, setTeamReceiptHistory] = useState<TeamReceiptHistory[]>([]);
  const [teamClosureLoading, setTeamClosureLoading] = useState(false);
  const [selectedTeamOwnerEmail, setSelectedTeamOwnerEmail] = useState<string>('');
  
  // Estados para el modal de cambio de estado
  const [statusChangeModal, setStatusChangeModal] = useState<{
    isOpen: boolean;
    orderIds: string[];
    newStatus: string;
  }>({
    isOpen: false,
    orderIds: [],
    newStatus: '',
  });
  const [uploadingFile, setUploadingFile] = useState(false);
  
  // Estados para el modal de historial
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Función para subir archivo
  const uploadAttachment = async (file: File, orderId: string): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${orderId}_${Date.now()}.${fileExt}`;
    const filePath = `order_attachments/${fileName}`;
    
    const { error: uploadError } = await supabase.storage
      .from('order_attachments')
      .upload(filePath, file);
      
    if (uploadError) {
      toast.error('Error al subir la imagen: ' + uploadError.message);
      return null;
    }
    
    const { data: urlData } = supabase.storage
      .from('order_attachments')
      .getPublicUrl(filePath);
      
    return urlData.publicUrl;
  };

  // Función para guardar en el historial
  const saveToHistory = async (
    orderId: string, 
    previousStatus: string, 
    newStatus: string, 
    message?: string, 
    attachmentUrl?: string
  ) => {
    const { error } = await supabase
      .from('order_status_history')
      .insert({
        order_id: orderId,
        previous_status: previousStatus,
        new_status: newStatus,
        changed_by_email: myEmail,
        changed_by_role: myRole,
        message: message || null,
        attachment_url: attachmentUrl || null
      });
    
    if (error) {
      console.error('Error guardando en historial:', error);
    }
  };

  // Función para cargar el historial
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
      setOrderHistory(data || []);
    }
    
    setLoadingHistory(false);
    setHistoryModalOpen(true);
  };

  const loadDeliveries = async () => {
    setLoadingDeliveries(true);

    try {
      // Usar RPC SECURITY DEFINER para que DELIVERY también pueda ver
      // todos los repartidores aprobados aunque RLS bloquee profiles/user_roles.
      const { data, error } = await supabase.rpc('get_approved_deliveries');

      if (error) throw error;

      const deliveryMap = new Map<
        string,
        { user_id: string; email: string; name: string }
      >();

      (data || []).forEach((delivery: any) => {
        const userId = String(delivery?.user_id || '').trim();
        const email = String(delivery?.email || '').trim();
        if (!userId || !email) return;

        deliveryMap.set(email.toLowerCase(), {
          user_id: userId,
          email,
          name: String(delivery?.name || email).trim(),
        });
      });

      const finalDeliveries = Array.from(deliveryMap.values()).sort((a, b) =>
        String(a.name || a.email).localeCompare(
          String(b.name || b.email),
          'es',
          { sensitivity: 'base' },
        ),
      );

      setDeliveries(finalDeliveries);
    } catch (error: any) {
      console.error('Error loading deliveries:', error);
      toast.error(
        `Error al cargar repartidores activos: ${
          error?.message || 'Error desconocido'
        }`,
      );
      setDeliveries([]);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const loadTeamData = async () => {
    if (!(isDelivery || isAdmin || isSupplier)) return;

    setTeamLoading(true);
    try {
      if (isDelivery || isSupplier || isAdmin) {
        const requests: PromiseLike<any>[] = [
          supabase.rpc('get_delivery_team'),
        ];

        // Solo DELIVERY puede recibir invitaciones como miembro.
        if (isDelivery) {
          requests.push(supabase.rpc('get_delivery_team_invitations'));
        }

        // ADMIN y PROVEEDOR conservan además la vista global de todos los equipos.
        if (isSupplier || isAdmin) {
          requests.push(supabase.rpc('get_all_delivery_teams'));
        }

        const results = await Promise.all(requests);

        const teamResult = results[0];
        if (teamResult.error) throw teamResult.error;
        setTeamMembers((teamResult.data || []) as TeamMember[]);

        let index = 1;

        if (isDelivery) {
          const invitationsResult = results[index++];
          if (invitationsResult.error) throw invitationsResult.error;
          setTeamInvitations((invitationsResult.data || []) as TeamInvitation[]);
        } else {
          setTeamInvitations([]);
        }

        if (isSupplier || isAdmin) {
          const allTeamsResult = results[index];
          if (allTeamsResult.error) throw allTeamsResult.error;
          setAllTeams((allTeamsResult.data || []) as AdminTeamRow[]);
        }
      }
    } catch (error: any) {
      console.error('Error cargando equipo de logística:', error);
      toast.error(`No se pudo cargar Equipo de Logística: ${error?.message || 'Error desconocido'}`);
      setTeamMembers([]);
      setTeamInvitations([]);
      if (isAdmin || isSupplier) {
        setAllTeams([]);
      }
    } finally {
      setTeamLoading(false);
    }
  };


  // Mantener visibles las invitaciones recibidas.
  // Un DELIVERY puede recibir solicitudes tanto de un DELIVERY líder
  // como de un PROVEEDOR líder.
  useEffect(() => {
    if (!isDelivery) return;

    const loadPendingInvitations = async () => {
      try {
        const { data, error } = await supabase.rpc(
          'get_delivery_team_invitations',
        );

        if (error) throw error;

        setTeamInvitations((data || []) as TeamInvitation[]);
      } catch (error) {
        console.error('Error cargando solicitudes de equipo:', error);
      }
    };

    loadPendingInvitations();
  }, [isDelivery, myEmail]);

  useEffect(() => {
    if (activeSection === 'team' && (isDelivery || isSupplier || isAdmin)) {
      loadTeamData();
    }
  }, [activeSection]);

  const loadTeamClosures = async () => {
    if (!(isDelivery || isAdmin || isSupplier)) return;

    setTeamClosureLoading(true);
    try {
      const [summaryResult, historyResult] = await Promise.all([
        supabase.rpc('get_delivery_team_closure_summary', {
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }),
        supabase.rpc('get_delivery_team_receipt_history'),
      ]);

      if (summaryResult.error) throw summaryResult.error;
      if (historyResult.error) throw historyResult.error;

      setTeamClosureSummary((summaryResult.data || []) as TeamClosureSummary[]);
      setTeamReceiptHistory((historyResult.data || []) as TeamReceiptHistory[]);
    } catch (error: any) {
      console.error('Error cargando cierres de equipo:', error);
      toast.error(
        `No se pudieron cargar los cierres de equipo: ${
          error?.message || 'Error desconocido'
        }`,
      );
      setTeamClosureSummary([]);
      setTeamReceiptHistory([]);
    } finally {
      setTeamClosureLoading(false);
    }
  };

  const markTeamReceiptReceived = async (memberUserId: string) => {
    if (!(isDelivery || isSupplier || isAdmin)) return;

    const row = teamClosureSummary.find(
      item => item.member_user_id === memberUserId,
    );

    if (!row || Number(row.pending_receipt_count || 0) <= 0) {
      toast.error('Ese delivery no tiene entregas pendientes de rendición');
      return;
    }

    if (
      !confirm(
        `¿Confirmar que recibiste la rendición de ${row.member_name || row.member_email}?\n\n` +
        `Pedidos pendientes: ${row.pending_receipt_count}\n` +
        `Monto a recibir: Gs ${nf(Number(row.amount_to_render || 0))}\n` +
        `Período: ${formatDatePY(dateFrom)} al ${formatDatePY(dateTo)}\n\n` +
        'Esta acción quedará guardada en el historial.',
      )
    ) return;

    setBulkBusy(true);
    try {
      const { data, error } = await supabase.rpc('mark_delivery_team_receipt', {
        p_member_user_id: memberUserId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
        p_note: null,
      });

      if (error) throw error;

      const receipt = Array.isArray(data) ? data[0] : data;

      toast.success(
        `Rendición recibida${receipt?.amount_received != null
          ? ` — Gs ${nf(Number(receipt.amount_received || 0))}`
          : ''}`,
      );

      await loadTeamClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo registrar la rendición recibida');
    } finally {
      setBulkBusy(false);
    }
  };

  const inviteDelivery = async (memberUserId: string) => {
    if (!(isDelivery || isSupplier || isAdmin) || !memberUserId) return;

    setBulkBusy(true);
    try {
      const { error } = await supabase.rpc('invite_delivery_team_member', {
        p_member_user_id: memberUserId,
      });
      if (error) throw error;

      toast.success('Solicitud enviada al delivery');
      setTeamSearch('');
      await loadTeamData();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo enviar la solicitud');
    } finally {
      setBulkBusy(false);
    }
  };

  const respondTeamInvitation = async (relationId: string, accept: boolean) => {
    setBulkBusy(true);
    try {
      const { error } = await supabase.rpc('respond_delivery_team_invitation', {
        p_relation_id: relationId,
        p_accept: accept,
      });
      if (error) throw error;

      toast.success(accept ? 'Solicitud aceptada' : 'Solicitud rechazada');
      await loadTeamData();
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo responder la solicitud');
    } finally {
      setBulkBusy(false);
    }
  };

  const removeTeamMember = async (relationId: string) => {
    if (!confirm('¿Quitar este delivery del equipo?')) return;

    setBulkBusy(true);
    try {
      const { error } = await supabase.rpc('remove_delivery_team_member', {
        p_relation_id: relationId,
      });
      if (error) throw error;

      toast.success('Delivery quitado del equipo');
      await loadTeamData();
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo quitar al delivery');
    } finally {
      setBulkBusy(false);
    }
  };

  const loadSuppliers = async () => {
    try {
      /*
       * La lista oficial se obtiene mediante una función SECURITY DEFINER
       * creada en Supabase. De esta forma ADMIN y DELIVERY ven exactamente
       * los mismos proveedores aprobados, sin depender de las políticas RLS
       * aplicadas directamente sobre orders, profiles o user_roles.
       */
      const { data, error } = await supabase.rpc('get_approved_suppliers');

      if (error) throw error;

      const supplierMap = new Map<
        string,
        { email: string; name: string }
      >();

      (data || []).forEach((supplier: any) => {
        const email = String(supplier?.email || '')
          .trim()
          .toLowerCase();

        if (!email) return;

        supplierMap.set(email, {
          email,
          name: String(
            supplier?.name ||
            supplier?.email
          ).trim(),
        });
      });

      /*
       * PROVEEDOR:
       * agregar también los provider_email presentes en pedidos que él
       * gestiona como delivery_owner. Así el filtro normal nunca depende
       * únicamente de que la RPC devuelva esos proveedores.
       */
      if (isSupplier && myEmail) {
        const { data: managedProviderRows } = await supabase
          .from('orders')
          .select('provider_email')
          .or(`provider_email.eq.${myEmail},delivery_owner.eq.${myEmail}`)
          .not('provider_email', 'is', null)
          .limit(5000);

        (managedProviderRows || []).forEach((row: any) => {
          const email = String(row?.provider_email || '')
            .trim()
            .toLowerCase();

          if (!email || supplierMap.has(email)) return;

          supplierMap.set(email, {
            email,
            name: email,
          });
        });
      }

      const finalSuppliers = Array
        .from(supplierMap.values())
        .sort((a, b) =>
          String(a.name || a.email).localeCompare(
            String(b.name || b.email),
            'es',
            { sensitivity: 'base' },
          ),
        );

      setSuppliers(finalSuppliers);
    } catch (error: any) {
      console.error(
        'Error cargando proveedores oficiales en Cierres:',
        error,
      );

      if (isSupplier && myEmail) {
        const { data: fallbackRows, error: fallbackError } = await supabase
          .from('orders')
          .select('provider_email')
          .or(`provider_email.eq.${myEmail},delivery_owner.eq.${myEmail}`)
          .not('provider_email', 'is', null)
          .limit(5000);

        if (!fallbackError) {
          const map = new Map<string, { email: string; name: string }>();

          (fallbackRows || []).forEach((row: any) => {
            const email = String(row?.provider_email || '')
              .trim()
              .toLowerCase();

            if (!email) return;

            map.set(email, {
              email,
              name: email,
            });
          });

          setSuppliers(
            Array.from(map.values()).sort((a, b) =>
              a.email.localeCompare(b.email),
            ),
          );

          return;
        }
      }

      toast.error(
        `Error al cargar proveedores: ${
          error?.message || 'Error desconocido'
        }`,
      );

      setSuppliers([]);
    }
  };

  useEffect(() => {
    if (!(isAdmin || isSupplier)) return;
    supabase
      .from('delivery_attempt_payments' as any)
      .select('order_id, amount')
      .then(({ data, error }) => {
        if (error) return;
        const map = new Map<string, number>();
        ((data || []) as unknown as { order_id: string; amount: number }[]).forEach(a =>
          map.set(a.order_id, (map.get(a.order_id) || 0) + Number(a.amount || 0)),
        );
        setAttemptPayByOrder(map);
      });
  }, [isAdmin, isSupplier]);

  useEffect(() => {
    loadSuppliers();
    loadDeliveries();
    loadTeamData();
    // Tarifas para cierres:
    // ADMIN/PROVEEDOR necesitan poder leer también la tarifa del líder de otro equipo.
    // La RPC SECURITY DEFINER evita que RLS deje la tarifa en 0 por falta de visibilidad.
    supabase.rpc('get_closure_delivery_fees').then(({ data, error }) => {
      if (!error) {
        setFees(data || []);
        return;
      }

      console.warn('RPC get_closure_delivery_fees no disponible:', error.message);

      // Fallback compatible mientras se instala el parche SQL.
      supabase
        .from('delivery_fees')
        .select('*')
        .then(({ data: directData }) => setFees(directData || []));
    });
    supabase.from('client_prices').select('*').order('city').then(({ data }) => setClientPrices(data || []));
    supabase.from('products').select('*').then(({ data }) => setProducts(data || []));
  }, []);


  const selectedDeliveryList = useMemo(() => Array.from(filterDeliveries), [filterDeliveries]);

  const selectedSupplierList = useMemo(
    () => Array.from(filterSuppliers),
    [filterSuppliers],
  );

  const filteredSupplierOptions = useMemo(() => {
    const q = supplierSearch.toLowerCase().trim();

    if (!q) return suppliers;

    return suppliers.filter((supplier: any) =>
      String(supplier.name || '').toLowerCase().includes(q) ||
      String(supplier.email || '').toLowerCase().includes(q)
    );
  }, [suppliers, supplierSearch]);

  const toggleSupplierFilter = (email: string) => {
    setFilterSuppliers(previous => {
      const next = new Set(previous);

      if (next.has(email)) {
        next.delete(email);
        return next;
      }

      if (next.size >= MAX_SUPPLIERS) {
        toast.error(`Solo podés seleccionar hasta ${MAX_SUPPLIERS} proveedores`);
        return previous;
      }

      next.add(email);
      return next;
    });
  };

  const selectFirstTenSupplierFilters = () => {
    const emails = filteredSupplierOptions
      .slice(0, MAX_SUPPLIERS)
      .map((supplier: any) => supplier.email);

    setFilterSuppliers(new Set(emails));

    if (filteredSupplierOptions.length > MAX_SUPPLIERS) {
      toast.info(`Se seleccionaron los primeros ${MAX_SUPPLIERS} proveedores`);
    }
  };

  const selectedStatusList = useMemo(
    () => Array.from(filterStatuses),
    [filterStatuses],
  );

  const toggleStatusFilter = (status: string) => {
    setFilterStatuses(previous => {
      const next = new Set(previous);

      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }

      return next;
    });
  };

  const selectAllStatusFilters = () => {
    setFilterStatuses(previous =>
      previous.size === STATUS_1_OPTIONS.length
        ? new Set()
        : new Set<string>(STATUS_1_OPTIONS),
    );
  };

  const teamClosureTeamOptions = useMemo(() => {
    if (activeSection !== 'teamClosures') return [];

    if (isAdmin) {
      const unique = new Map<
        string,
        { owner_email: string; owner_name: string; owner_user_id: string }
      >();

      allTeams
        .filter(row => String(row.status || '').toUpperCase() === 'ACCEPTED')
        .forEach(row => {
          const email = String(row.owner_email || '').trim();
          if (!email) return;

          unique.set(email.toLowerCase(), {
            owner_email: email,
            owner_name: String(row.owner_name || email),
            owner_user_id: String(row.owner_user_id || ''),
          });
        });

      return Array.from(unique.values()).sort((a, b) =>
        String(a.owner_name || a.owner_email).localeCompare(
          String(b.owner_name || b.owner_email),
          'es',
          { sensitivity: 'base' },
        ),
      );
    }

    const hasAcceptedMembers = teamMembers.some(
      member => String(member.status || '').toUpperCase() === 'ACCEPTED',
    );

    if (!hasAcceptedMembers || !myEmail) return [];

    return [
      {
        owner_email: myEmail,
        owner_name: String(profile?.name || myEmail),
        owner_user_id: String(profile?.user_id || ''),
      },
    ];
  }, [
    activeSection,
    isAdmin,
    allTeams,
    teamMembers,
    myEmail,
    profile?.name,
    profile?.user_id,
  ]);



  const effectiveTeamOwnerEmail =
    activeSection === 'teamClosures'
      ? isAdmin
        ? String(selectedTeamOwnerEmail || '').trim()
        : String(myEmail || '').trim()
      : '';


  const teamClosureDeliveryOptions = useMemo(() => {
    if (activeSection !== 'teamClosures') return deliveries;
    if (!effectiveTeamOwnerEmail) return [];

    const ownerEmail = effectiveTeamOwnerEmail.toLowerCase();

    const allowedEmails = new Set<string>(
      (
        isAdmin
          ? allTeams
              .filter(
                row =>
                  String(row.status || '').toUpperCase() === 'ACCEPTED' &&
                  String(row.owner_email || '').trim().toLowerCase() === ownerEmail,
              )
              .map(row => String(row.member_email || '').trim().toLowerCase())
          : String(myEmail || '').trim().toLowerCase() === ownerEmail
            ? teamMembers
                .filter(
                  member =>
                    String(member.status || '').toUpperCase() === 'ACCEPTED',
                )
                .map(member =>
                  String(member.member_email || '').trim().toLowerCase(),
                )
            : []
      ).filter(Boolean),
    );

    return deliveries.filter((delivery: any) =>
      allowedEmails.has(String(delivery.email || '').trim().toLowerCase()),
    );
  }, [
    activeSection,
    deliveries,
    allTeams,
    teamMembers,
    isAdmin,
    myEmail,
    effectiveTeamOwnerEmail,
  ]);

  const filteredDeliveryOptions = useMemo(() => {
    const source = teamClosureDeliveryOptions;
    if (!deliverySearch.trim()) return source;
    const q = deliverySearch.toLowerCase().trim();
    return source.filter((d: any) =>
      String(d.name || '').toLowerCase().includes(q) ||
      String(d.email || '').toLowerCase().includes(q)
    );
  }, [teamClosureDeliveryOptions, deliverySearch]);

  const toggleDeliveryFilter = (email: string) => {
    setFilterDeliveries(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const selectAllDeliveryFilters = () => {
    const source = activeSection === 'teamClosures'
      ? teamClosureDeliveryOptions
      : deliveries;

    if (filterDeliveries.size === source.length) {
      setFilterDeliveries(new Set());
    } else {
      setFilterDeliveries(new Set(source.map((d: any) => d.email)));
    }
  };

  const updateOrderCity = async (orderId: string, city: string) => {
    const { error } = await supabase.from('orders').update({
      city,
      updated_at: new Date().toISOString()
    }).eq('id', orderId);

    if (error) {
      toast.error(error.message);
      loadClosures();
      return;
    }

    toast.success('Ciudad actualizada');
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, city, updated_at: new Date().toISOString() } : o));
  };

  const updateAssignedDelivery = async (orderId: string, deliveryEmail: string) => {
    const { error } = await supabase.from('orders').update({
      delivery_owner: deliveryEmail || null,
      assigned_delivery: deliveryEmail || null,
      assigned_team_member: null,
      assigned_at: deliveryEmail ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', orderId);

    if (error) {
      toast.error(error.message);
      loadClosures();
      return;
    }

    toast.success(deliveryEmail ? 'Delivery reasignado' : 'Delivery removido');
    setOrders(prev => prev.map(o => o.id === orderId ? {
      ...o,
      delivery_owner: deliveryEmail || null,
      assigned_delivery: deliveryEmail || null,
      assigned_team_member: null,
      assigned_at: deliveryEmail ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    } : o));
  };

  const toggleContacted = async (order: any) => {
    const orderId = String(order?.id || '');
    if (!orderId || updatingContactedIds.has(orderId)) return;

    const nextContacted = !Boolean(order.contacted);
    const now = new Date().toISOString();

    setUpdatingContactedIds(previous => {
      const next = new Set(previous);
      next.add(orderId);
      return next;
    });

    setOrders(previous =>
      previous.map(item =>
        item.id === orderId
          ? {
              ...item,
              contacted: nextContacted,
              contacted_at: nextContacted ? now : null,
              contacted_by: nextContacted ? myEmail : null,
            }
          : item,
      ),
    );

    const { error } = await supabase
      .from('orders')
      .update({
        contacted: nextContacted,
        contacted_at: nextContacted ? now : null,
        contacted_by: nextContacted ? myEmail : null,
        updated_at: now,
      })
      .eq('id', orderId);

    if (error) {
      setOrders(previous =>
        previous.map(item => (item.id === orderId ? order : item)),
      );
      toast.error(`No se pudo actualizar Contactado: ${error.message}`);
    } else {
      toast.success(
        nextContacted
          ? 'Cliente marcado como contactado'
          : 'Marca de contacto eliminada',
      );
    }

    setUpdatingContactedIds(previous => {
      const next = new Set(previous);
      next.delete(orderId);
      return next;
    });
  };

  const loadClosures = async () => {
    let dateField = filterDateBy;
    
    if (isDelivery || isSupplier) {
      dateField = 'assigned_at';
    } else if (isVendedor) {
      dateField = 'created_at';
    }
    
    const isTeamClosureView =
      activeSection === 'teamClosures' &&
      (isDelivery || isSupplier || isAdmin);

    /*
     * CIERRE NORMAL:
     * conserva el filtro SQL por assigned_at / created_at.
     *
     * CIERRES DE EQUIPO:
     * primero traemos los pedidos de los miembros y luego filtramos por la
     * FECHA REAL DE ASIGNACIÓN AL DELIVERY:
     *   team_assigned_at ?? assigned_at
     *
     * Esto evita que una sincronización posterior del líder cambie el día
     * en que el pedido debe aparecer para el DELIVERY encargado.
     */
    let query = supabase.from('orders').select('*');

    if (!isTeamClosureView) {
      query = query
        .gte(dateField, dateFrom + 'T00:00:00')
        .lte(dateField, dateTo + 'T23:59:59')
        .order(dateField, { ascending: false });
    }

    if (isTeamClosureView) {
      /*
       * CIERRES DE EQUIPO:
       * - primero se identifica el LÍDER mediante delivery_owner;
       * - luego se limita a DELIVERY ACCEPTED de ese equipo;
       * - provider_email NO limita la visualización.
       *
       * Esto evita mezclar pedidos si un DELIVERY participa en más de un equipo.
       */
      const teamOwnerEmail = effectiveTeamOwnerEmail;

      if (!teamOwnerEmail) {
        setOrders([]);
        setTotalPedidosAsignados(0);
        setRendicionPagada(null);
        return;
      }

      const allowedTeamEmails = isAdmin
        ? Array.from(
            new Set(
              allTeams
                .filter(
                  row =>
                    String(row.status || '').toUpperCase() === 'ACCEPTED' &&
                    String(row.owner_email || '').trim().toLowerCase() ===
                      teamOwnerEmail.toLowerCase(),
                )
                .map(row => String(row.member_email || '').trim())
                .filter(Boolean),
            ),
          )
        : teamMembers
            .filter(
              member =>
                String(member.status || '').toUpperCase() === 'ACCEPTED',
            )
            .map(member => String(member.member_email || '').trim())
            .filter(Boolean);

      const requestedEmails =
        selectedDeliveryList.length > 0
          ? selectedDeliveryList.filter(email =>
              allowedTeamEmails.some(
                allowed =>
                  allowed.toLowerCase() === String(email).toLowerCase(),
              ),
            )
          : allowedTeamEmails;

      if (allowedTeamEmails.length === 0 || requestedEmails.length === 0) {
        setOrders([]);
        setTotalPedidosAsignados(0);
        setRendicionPagada(null);
        return;
      }

      /*
       * REGLA FINAL:
       * Si el pedido está asignado a un DELIVERY ACCEPTED de este equipo,
       * pertenece al cierre de este líder.
       *
       * No exigimos delivery_owner para MOSTRARLO, porque pedidos antiguos
       * o asignaciones hechas antes del trigger V18 pueden no tenerlo todavía.
       * delivery_owner sigue utilizándose para identificar/tarifar al líder.
       */
      query = query
        .in('assigned_delivery', requestedEmails)
        .order('assigned_at', { ascending: false });

      /*
       * FILTRO PROVEEDOR EN CIERRES DE EQUIPO:
       *
       * - Por defecto NO limita provider_email.
       * - Por eso el líder ve ventas de cualquier proveedor.
       * - Si el usuario elige uno o varios proveedores en el filtro,
       *   recién ahí se aplica provider_email.
       */
      if (selectedSupplierList.length > 0) {
        query = query.in('provider_email', selectedSupplierList);
      }
    } else if (isSupplier) {
      /*
       * CIERRE NORMAL - PROVEEDOR
       *
       * Debe ver:
       * 1) TODOS SUS PEDIDOS COMERCIALES:
       *    provider_email = su correo
       *
       * 2) PEDIDOS DE OTROS PROVEEDORES QUE ÉL GESTIONA COMO LÍDER:
       *    delivery_owner = su correo
       *    O assigned_delivery = él / miembro ACCEPTED de su equipo
       *
       * provider_email puede usarse después como filtro visual.
       */
      const supplierManagedEmails = Array.from(
        new Set(
          [
            String(myEmail || '').trim().toLowerCase(),
            ...teamMembers
              .filter(
                member =>
                  String(member.status || '').toUpperCase() === 'ACCEPTED',
              )
              .map(member =>
                String(member.member_email || '').trim().toLowerCase(),
              ),
          ].filter(Boolean),
        ),
      );

      const managedDeliveryFilter =
        supplierManagedEmails.length > 0
          ? supplierManagedEmails.join(',')
          : '__NO_MATCH__';

      query = query.or(
        [
          `provider_email.eq.${myEmail}`,
          `delivery_owner.eq.${myEmail}`,
          `assigned_delivery.in.(${managedDeliveryFilter})`,
        ].join(','),
      );

      if (selectedDeliveryList.length > 0) {
        query = query.in('assigned_delivery', selectedDeliveryList);
      }

      if (selectedSupplierList.length > 0) {
        query = query.in('provider_email', selectedSupplierList);
      }
    } else if (isVendedor) {
      query = query.eq('created_by', myEmail);
      if (selectedDeliveryList.length > 0) {
        query = query.in('assigned_delivery', selectedDeliveryList);
      }
    } else if (isDelivery) {
      query = query.or(`delivery_owner.eq.${myEmail},assigned_delivery.eq.${myEmail}`);
      if (selectedSupplierList.length > 0) {
        query = query.in('provider_email', selectedSupplierList);
      }
    } else if (isAdmin) {
      if (selectedDeliveryList.length > 0) {
        query = query.in('assigned_delivery', selectedDeliveryList);
      }
      if (selectedSupplierList.length > 0) {
        query = query.in('provider_email', selectedSupplierList);
      }
    }

    if (selectedStatusList.length > 0) {
      query = query.in('status', selectedStatusList);
    }

    /*
     * Supabase/PostgREST normalmente limita una respuesta a 1000 filas.
     * Para que PROVEEDOR, ADMIN y DELIVERY líder reciban TODOS los pedidos,
     * cargamos por páginas hasta que la última página tenga menos de 1000.
     */
    const PAGE_SIZE = 1000;
    const allLoadedOrders: any[] = [];
    let pageFrom = 0;

    while (true) {
      const { data: pageData, error: pageError } = await query.range(
        pageFrom,
        pageFrom + PAGE_SIZE - 1,
      );

      if (pageError) {
        console.error('Error cargando pedidos de cierres:', pageError);
        toast.error(`No se pudieron cargar todos los pedidos: ${pageError.message}`);
        break;
      }

      const pageRows = pageData || [];
      allLoadedOrders.push(...pageRows);

      if (pageRows.length < PAGE_SIZE) {
        break;
      }

      pageFrom += PAGE_SIZE;

      // Límite defensivo alto para evitar un ciclo accidental por backend.
      if (pageFrom >= 50000) {
        console.warn('Se alcanzó el límite defensivo de 50.000 pedidos en Cierres');
        break;
      }
    }

    let finalOrders = allLoadedOrders;

    if (isTeamClosureView) {
      finalOrders = finalOrders
        .filter(order => {
          const effectiveAssignedAt =
            order.team_assigned_at ||
            order.assigned_at;

          const key = dateKeyPY(effectiveAssignedAt);

          return Boolean(
            key &&
            key >= dateFrom &&
            key <= dateTo,
          );
        })
        .sort((a, b) => {
          const aTime = new Date(
            a.team_assigned_at ||
            a.assigned_at ||
            a.created_at ||
            0,
          ).getTime();

          const bTime = new Date(
            b.team_assigned_at ||
            b.assigned_at ||
            b.created_at ||
            0,
          ).getTime();

          return bTime - aTime;
        });
    }

    setOrders(finalOrders);
    setTotalPedidosAsignados(finalOrders.length);

    let deliveryToCheck = '';
    if (isDelivery) {
      deliveryToCheck = myEmail;
    } else if ((isAdmin || isSupplier) && selectedDeliveryList.length === 1) {
      deliveryToCheck = selectedDeliveryList[0];
    }
    
    if (deliveryToCheck) {
      const { data: rp } = await supabase.from('rendiciones_pagadas').select('*')
        .eq('delivery_email', deliveryToCheck)
        .gte('pagado_en', dateFrom + 'T00:00:00')
        .lte('pagado_en', dateTo + 'T23:59:59')
        .order('pagado_en', { ascending: false })
        .limit(1);
      setRendicionPagada(rp && rp.length > 0 ? { id: rp[0].id, pagado_en: rp[0].pagado_en, nota: rp[0].nota || '', marcado_por: rp[0].marcado_por || '' } : null);
    } else {
      setRendicionPagada(null);
    }
  };

  useEffect(() => {
    loadClosures();
  }, [
    filterSuppliers,
    filterDeliveries,
    filterStatuses,
    dateFrom,
    dateTo,
    filterDateBy,
    activeSection,
    teamMembers,
    allTeams,
    effectiveTeamOwnerEmail,
  ]);

  const filteredOrders = useMemo(() => {
    let base = orders;

    if (settlementFilter !== 'all') {
      base = base.filter(order => {
        const isDelivered = order.status === 'ENTREGADO' || order.status === 'ENCOMIENDA ENTREGADA';
        if (!isDelivered) return false;
        return settlementFilter === 'settled' ? Boolean(order.delivery_settled) : !Boolean(order.delivery_settled);
      });
    }

    if (!searchTerm.trim()) return base;

    const term = searchTerm.toLowerCase().trim();
    return base.filter(order => {
      return (
        (order.customer_name && order.customer_name.toLowerCase().includes(term)) ||
        (order.customer_phone && order.customer_phone.toLowerCase().includes(term)) ||
        (order.order_number && order.order_number.toLowerCase().includes(term)) ||
        (order.id && order.id.toLowerCase().includes(term)) ||
        (order.city && order.city.toLowerCase().includes(term))
      );
    });
  }, [orders, searchTerm, settlementFilter]);

  // Detección informativa, sin modificar estados ni importes de pedidos.
  // Se consideran posibles repetidos cuando comparten teléfono, ciudad y fecha de creación.
  // Sin teléfono o fecha no se clasifica un pedido como repetido.
  const possibleDuplicates = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const order of orders) {
      const phone = String(order.customer_phone || order.phone || '').replace(/\D/g, '');
      const city = String(order.city || '').trim().toLowerCase();
      const day = String(order.created_at || '').slice(0, 10);
      if (phone.length < 8 || !city || !day) continue;
      const key = `${phone}|${city}|${day}`;
      groups.set(key, [...(groups.get(key) || []), order]);
    }
    const ids = new Set<string>();
    let groupsCount = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      groupsCount++;
      group.forEach(order => ids.add(order.id));
    }
    return { ids, groupsCount, count: ids.size };
  }, [orders]);

  const [onlyPossibleDuplicates, setOnlyPossibleDuplicates] = useState(false);

  // Pedidos que llegaron a esta fecha desde otra (pasados por "Finalicé mi día"
  // o asignados por primera vez un día anterior).
  const [onlyCarried, setOnlyCarried] = useState(false);
  const pyDayKey = (value: string | null | undefined) =>
    value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date(value)) : '';
  const isCarried = (o: any) =>
    Number(o?.carried_over_count || 0) > 0 ||
    Boolean(o?.first_assigned_at && o?.assigned_at && pyDayKey(o.first_assigned_at) < pyDayKey(o.assigned_at));
  const carriedCount = useMemo(() => filteredOrders.filter(isCarried).length, [filteredOrders]);

  const displayedOrders = useMemo(() => {
    let list = onlyPossibleDuplicates ? filteredOrders.filter(o => possibleDuplicates.ids.has(o.id)) : filteredOrders;
    if (onlyCarried) list = list.filter(isCarried);
    return list;
  }, [filteredOrders, possibleDuplicates, onlyPossibleDuplicates, onlyCarried]);

  const normalizeFeeKey = (value: string) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const getFee = (deliveryEmail: string, city: string) => {
    const emailKey = normalizeFeeKey(deliveryEmail);
    const cityKey = normalizeFeeKey(city);

    const feeRow = fees.find(
      fee =>
        normalizeFeeKey(fee?.delivery_email || '') === emailKey &&
        normalizeFeeKey(fee?.city || '') === cityKey,
    );

    return Number(feeRow?.fee_gs || 0);
  };

  const productCostMap = useMemo(() => {
    const m: Record<string, number> = {};
    products.forEach((p: any) => {
      if (p.sku) m[String(p.sku).trim()] = Number(p.real_cost_gs || 0);
    });
    return m;
  }, [products]);

  const getOrderRealProductCost = (order: any) => {
    try {
      const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : (order.items_json || []);
      return items.reduce((sum: number, it: any) => {
        const sku = String(it.sku || '').trim();
        const qty = Number(it.qty || 0);
        const realCost = Number(productCostMap[sku] || 0);
        return sum + (realCost * qty);
      }, 0);
    } catch {
      return 0;
    }
  };

  const getOrderTeamLeaderLabel = (order: any) => {
    const ownerEmail = String(order?.delivery_owner || '').trim();
    const memberEmail = String(order?.assigned_delivery || '').trim();

    if (
      !ownerEmail ||
      !memberEmail ||
      ownerEmail.toLowerCase() === memberEmail.toLowerCase()
    ) {
      return '';
    }

    const teamRow = allTeams.find(
      row =>
        String(row.owner_email || '').trim().toLowerCase() ===
          ownerEmail.toLowerCase() &&
        String(row.member_email || '').trim().toLowerCase() ===
          memberEmail.toLowerCase(),
    );

    if (teamRow) {
      return String(teamRow.owner_name || teamRow.owner_email || ownerEmail);
    }

    const deliveryLeader = deliveries.find(
      (delivery: any) =>
        String(delivery?.email || '').trim().toLowerCase() ===
        ownerEmail.toLowerCase(),
    );

    return String(deliveryLeader?.name || ownerEmail);
  };

  const getDeliveryFeeForOrder = (order: any) => {
    /*
     * REGLA DE TARIFA SEGÚN PESTAÑA
     *
     * CIERRE NORMAL:
     * - Se conserva exactamente la lógica actual.
     * - Si el pedido pertenece a un Equipo de Logística, usa la tarifa
     *   del titular/líder mediante delivery_owner.
     *
     * CIERRES DE EQUIPO:
     * - Usa SIEMPRE la tarifa propia del DELIVERY miembro asignado
     *   mediante assigned_delivery.
     * - Así cada delivery del equipo muestra su tarifa real por ciudad.
     */
    const storedFee = Number(order?.delivery_fee_gs || 0);

    // Si hay una tarifa explícitamente congelada/guardada en el pedido,
    // se respeta en ambas pestañas.
    if (storedFee > 0) {
      return storedFee;
    }

    const tariffEmail =
      activeSection === 'teamClosures'
        ? String(order?.assigned_delivery || '').trim()
        : String(
            order?.delivery_owner ||
            order?.assigned_delivery ||
            '',
          ).trim();

    if (!tariffEmail) return 0;

    return getFee(tariffEmail, order?.city || '');
  };

  const delivered = useMemo(
    () =>
      filteredOrders.filter(
        order =>
          order.status === 'ENTREGADO' ||
          order.status === 'ENCOMIENDA ENTREGADA',
      ),
    [filteredOrders],
  );

  const settlementFilterCounts = useMemo(
    () => ({
      all: orders.length,
      settled: orders.filter(order => (order.status === 'ENTREGADO' || order.status === 'ENCOMIENDA ENTREGADA') && order.delivery_settled).length,
      pending: orders.filter(order => (order.status === 'ENTREGADO' || order.status === 'ENCOMIENDA ENTREGADA') && !order.delivery_settled).length,
    }),
    [orders],
  );

  const rendidos = useMemo(
    () => delivered.filter(order => order.delivery_settled),
    [delivered],
  );

  const noRendidos = useMemo(
    () => delivered.filter(order => !order.delivery_settled),
    [delivered],
  );

  /*
   * Reglas financieras:
   * - ENTREGADO: el delivery rinde total_gs menos su tarifa.
   * - ENCOMIENDA ENTREGADA: el delivery no rinde el monto del pedido.
   *   Solo cobra su tarifa de delivery.
   * - Los demás estados no generan rendición ni pago de delivery.
   */
  const getOrderCollectedAmount = (order: any) => {
    if (order.status !== 'ENTREGADO') return 0;
    return Number(order.total_gs || 0);
  };

  const getOrderAmountToSettle = (order: any) => {
    if (
      order.status !== 'ENTREGADO' &&
      order.status !== 'ENCOMIENDA ENTREGADA'
    ) {
      return 0;
    }

    /*
     * Este valor individual se usa solo como referencia.
     * La rendición real se calcula de forma global para que la tarifa
     * de ENCOMIENDA ENTREGADA también se descuente del dinero cobrado
     * en pedidos ENTREGADO.
     */
    return getOrderCollectedAmount(order) - getDeliveryPaymentForOrder(order);
  };

  const getDeliveryPaymentForOrder = (order: any) => {
    if (
      order.status !== 'ENTREGADO' &&
      order.status !== 'ENCOMIENDA ENTREGADA'
    ) {
      return 0;
    }

    return getDeliveryFeeForOrder(order);
  };

  const statusKpis = useMemo(
    () =>
      STATUS_1_OPTIONS.map(status => {
        const statusOrders = filteredOrders.filter(
          order => order.status === status,
        );

        return {
          status,
          count: statusOrders.length,
          totalGs: statusOrders.reduce(
            (sum, order) => sum + Number(order.total_gs || 0),
            0,
          ),
        };
      }),
    [filteredOrders],
  );

  const enRutaFinance = useMemo(() => {
    const enRutaOrders = filteredOrders.filter(
      order => order.status === 'EN RUTA',
    );

    const totalNeto = enRutaOrders.reduce(
      (sum, order) => sum + Number(order.total_gs || 0),
      0,
    );

    const totalDelivery = enRutaOrders.reduce(
      (sum, order) => sum + getDeliveryFeeForOrder(order),
      0,
    );

    return {
      count: enRutaOrders.length,
      totalNeto,
      totalDelivery,
      netoMenosDelivery: Math.max(0, totalNeto - totalDelivery),
    };
  }, [filteredOrders, fees]);

  const kpis = useMemo(() => {
    const entregados = filteredOrders.filter(
      order => order.status === 'ENTREGADO',
    );
    const encomiendas = filteredOrders.filter(
      order => order.status === 'ENCOMIENDA ENTREGADA',
    );

    return {
      entregados: entregados.length,
      entregadosRev: entregados.reduce(
        (sum, order) => sum + Number(order.total_gs || 0),
        0,
      ),
      encomiendas: encomiendas.length,

      // El monto comercial de las encomiendas no entra en los cálculos.
      encomiendaRev: 0,

      deliveryFee: delivered.reduce(
        (sum, order) => sum + getDeliveryPaymentForOrder(order),
        0,
      ),
      rendidos: rendidos.length,
      noRendidos: noRendidos.length,
      montoRendido: Math.max(
        0,
        rendidos.reduce(
          (sum, order) => sum + getOrderCollectedAmount(order),
          0,
        ) -
          rendidos.reduce(
            (sum, order) => sum + getDeliveryPaymentForOrder(order),
            0,
          ),
      ),
      montoPendiente: Math.max(
        0,
        noRendidos.reduce(
          (sum, order) => sum + getOrderCollectedAmount(order),
          0,
        ) -
          noRendidos.reduce(
            (sum, order) => sum + getDeliveryPaymentForOrder(order),
            0,
          ),
      ),
    };
  }, [filteredOrders, delivered, rendidos, noRendidos, fees]);

  const settlementSummary = useMemo(() => {
    const totalCollected = delivered.reduce(
      (sum, order) => sum + getOrderCollectedAmount(order),
      0,
    );

    const totalDeliveryPayment = delivered.reduce(
      (sum, order) => sum + getDeliveryPaymentForOrder(order),
      0,
    );

    return {
      totalCollected,
      totalDeliveryPayment,
      netToSettle: Math.max(0, totalCollected - totalDeliveryPayment),
    };
  }, [delivered, fees]);

  const totalAPagar = settlementSummary.netToSettle;
  const netRendir = settlementSummary.netToSettle;

  // ============================================
  // DETALLE FINANCIERO (admin ve todo; proveedor sólo sus pedidos)
  //
  // En un pedido ENTREGADO, lo cobrado se reparte así:
  //   venta = comisión del vendedor + precio del proveedor + delivery cobrado al vendedor
  // Ganancia producto  = precio del proveedor − costo real
  // Ganancia delivery  = delivery cobrado al vendedor − pago al delivery
  // Ganancia neta      = ganancia producto + ganancia delivery
  // ENCOMIENDA ENTREGADA no suma venta: sólo resta el pago al delivery.
  // ============================================
  type FinanceRow = {
    provider: string;
    orders: number;
    venta: number;
    comisiones: number;
    precioProveedor: number;
    costoReal: number;
    gananciaProducto: number;
    deliveryCobrado: number;
    pagoDelivery: number;
    gananciaDelivery: number;
    gananciaNeta: number;
    sinCosto: number;
  };

  const emptyFinance = (provider: string): FinanceRow => ({
    provider,
    orders: 0,
    venta: 0,
    comisiones: 0,
    precioProveedor: 0,
    costoReal: 0,
    gananciaProducto: 0,
    deliveryCobrado: 0,
    pagoDelivery: 0,
    gananciaDelivery: 0,
    gananciaNeta: 0,
    sinCosto: 0,
  });

  const orderProviderEmail = (order: any) =>
    String(
      order?.provider_email ||
        String(order?.provider_emails_list || '').split(/[,;\s]+/)[0] ||
        (() => {
          try {
            const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json || [];
            return items[0]?.provider_email || '';
          } catch {
            return '';
          }
        })(),
    )
      .trim()
      .toLowerCase();

  const orderProviderPrice = (order: any) => {
    try {
      const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json || [];
      const fromItems = items.reduce(
        (sum: number, it: any) => sum + Number(it.provider_price_gs || 0) * Number(it.qty || it.quantity || 1),
        0,
      );
      if (fromItems > 0) return fromItems;
    } catch {
      // Sin ítems legibles: se calcula por diferencia.
    }
    return Math.max(0, Number(order.total_gs || 0) - Number(order.commission_gs || 0) - Number(order.delivery_gs || 0));
  };

  const financePanel = useMemo(() => {
    const total = emptyFinance('TOTAL');
    const byProvider = new Map<string, FinanceRow>();
    const me = myEmail.trim().toLowerCase();

    delivered.forEach((order: any) => {
      const provider = orderProviderEmail(order) || 'Sin proveedor';
      // El proveedor sólo ve los pedidos de sus productos.
      if (isSupplier && provider !== me) return;

      const row = byProvider.get(provider) || emptyFinance(provider);
      const add = (key: keyof Omit<FinanceRow, 'provider'>, value: number) => {
        row[key] += value;
        total[key] += value;
      };

      const pago = getDeliveryPaymentForOrder(order);
      add('orders', 1);
      add('pagoDelivery', pago);

      if (order.status === 'ENCOMIENDA ENTREGADA') {
        add('gananciaDelivery', -pago);
        add('gananciaNeta', -pago);
      } else {
        const venta = Number(order.total_gs || 0);
        const comision = Number(order.commission_gs || 0);
        const deliveryCobrado = Number(order.delivery_gs || 0);
        const precio = orderProviderPrice(order);
        const costo = getOrderRealProductCost(order);
        if (costo <= 0) add('sinCosto', 1);
        add('venta', venta);
        add('comisiones', comision);
        add('deliveryCobrado', deliveryCobrado);
        add('precioProveedor', precio);
        add('costoReal', costo);
        add('gananciaProducto', precio - costo);
        add('gananciaDelivery', deliveryCobrado - pago);
        add('gananciaNeta', precio - costo + deliveryCobrado - pago);
      }
      byProvider.set(provider, row);
    });

    // Intentos pagados en pedidos no entregados de los filtros actuales.
    filteredOrders.forEach((order: any) => {
      if (order.status === 'ENTREGADO' || order.status === 'ENCOMIENDA ENTREGADA') return;
      const pago = attemptPayByOrder.get(order.id) || 0;
      if (!pago) return;
      const provider = orderProviderEmail(order) || 'Sin proveedor';
      if (isSupplier && provider !== me) return;
      const row = byProvider.get(provider) || emptyFinance(provider);
      row.pagoDelivery += pago;
      row.gananciaDelivery -= pago;
      row.gananciaNeta -= pago;
      total.pagoDelivery += pago;
      total.gananciaDelivery -= pago;
      total.gananciaNeta -= pago;
      byProvider.set(provider, row);
    });

    return {
      total,
      providers: Array.from(byProvider.values()).sort((x, y) => y.gananciaNeta - x.gananciaNeta),
    };
  }, [delivered, filteredOrders, attemptPayByOrder, productCostMap, fees, isSupplier, myEmail]);



  // Cambio de estado individual o masivo con la misma validación
  const handleStatusChangeWithValidation = async (orderId: string, newStatus: string) => {
    if (isDelivery && newStatus === 'DEVUELTO A DEPÓSITO') {
      toast.error('Los repartidores no pueden cambiar a DEVUELTO A DEPÓSITO');
      return;
    }

    if (isDelivery && (newStatus === 'NO CONTESTA' || newStatus === 'CANCELADO')) {
      setStatusChangeModal({
        isOpen: true,
        orderIds: [orderId],
        newStatus,
      });
      return;
    }

    await executeStatusChange([orderId], newStatus, '', null);
  };

  const executeStatusChange = async (
    orderIds: string[],
    newStatus: string,
    message: string = '',
    attachmentUrl: string | null = null,
  ) => {
    if (orderIds.length === 0) return;

    if (isDelivery && newStatus === 'DEVUELTO A DEPÓSITO') {
      toast.error('Los repartidores no pueden cambiar a DEVUELTO A DEPÓSITO');
      return;
    }

    const { error } = await supabase.rpc('bulk_update_order_status', {
      p_order_ids: orderIds,
      p_status: newStatus,
      p_message: message || null,
      p_attachment_url: attachmentUrl,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(
      orderIds.length === 1
        ? 'Estado actualizado'
        : `${orderIds.length} pedidos actualizados a ${newStatus}`,
    );

    setSelectedGuideIds(new Set());
    await loadClosures();
  };

  const processStatusChangeWithData = async (message: string, attachment: File | null) => {
    setUploadingFile(true);

    try {
      let attachmentUrl: string | null = null;
      if (attachment) {
        const uploadKey =
          statusChangeModal.orderIds.length === 1
            ? statusChangeModal.orderIds[0]
            : `bulk_${Date.now()}`;

        attachmentUrl = await uploadAttachment(attachment, uploadKey);
        if (!attachmentUrl) return;
      }

      await executeStatusChange(
        statusChangeModal.orderIds,
        statusChangeModal.newStatus,
        message,
        attachmentUrl,
      );

      setStatusChangeModal({ isOpen: false, orderIds: [], newStatus: '' });
    } finally {
      setUploadingFile(false);
    }
  };

  const updateStatus1 = async (orderId: string, status: string) => {
    await handleStatusChangeWithValidation(orderId, status);
  };

  const applyBulkStatus = async () => {
    const ids = Array.from(selectedGuideIds);
    if (ids.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    if (isDelivery && bulkStatus === 'DEVUELTO A DEPÓSITO') {
      toast.error('Los repartidores no pueden cambiar a DEVUELTO A DEPÓSITO');
      return;
    }

    if (!confirm(`¿Cambiar ${ids.length} pedido(s) a ${bulkStatus}?`)) return;

    if (isDelivery && (bulkStatus === 'NO CONTESTA' || bulkStatus === 'CANCELADO')) {
      setStatusChangeModal({
        isOpen: true,
        orderIds: ids,
        newStatus: bulkStatus,
      });
      return;
    }

    setBulkBusy(true);
    try {
      await executeStatusChange(ids, bulkStatus, '', null);
    } finally {
      setBulkBusy(false);
    }
  };

  const updateStatus2 = async (orderId: string, status2: string) => {
    const { error } = await supabase.from('orders').update({ 
      status2,
      updated_at: new Date().toISOString()
    }).eq('id', orderId);
    if (error) toast.error(error.message);
    else { toast.success('Estado 2 actualizado'); loadClosures(); }
  };

  const updateRetiro = async (orderId: string, estado: string) => {
    const { error } = await supabase.from('orders').update({ 
      estado_retiro: estado,
      updated_at: new Date().toISOString()
    }).eq('id', orderId);
    if (error) toast.error(error.message);
    else { toast.success('Estado de retiro actualizado'); loadClosures(); }
  };

  const applyBulkRetiroStatus = async () => {
    const ids = Array.from(selectedGuideIds);

    if (ids.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    if (!canEditFull) {
      toast.error('No tenés permiso para cambiar el estado de retiro');
      return;
    }

    if (!bulkRetiroStatus) {
      toast.error('Seleccioná un estado de retiro');
      return;
    }

    if (!confirm(`¿Cambiar ${ids.length} pedido(s) a Estado de retiro: ${bulkRetiroStatus}?`)) {
      return;
    }

    setBulkBusy(true);

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          estado_retiro: bulkRetiroStatus,
          updated_at: new Date().toISOString(),
        })
        .in('id', ids);

      if (error) throw error;

      toast.success(`${ids.length} pedido(s) actualizado(s) a ${bulkRetiroStatus}`);
      setSelectedGuideIds(new Set());
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo actualizar el Estado de retiro');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDateChange = async (orderId: string, newDate: string) => {
    if (!newDate) return;

    const newAssignedAt = `${newDate}T12:00:00`;

    setOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? { ...o, assigned_at: newAssignedAt, updated_at: new Date().toISOString() }
          : o
      )
    );

    setEditingDateId(null);
    
    const { error } = await supabase
      .from('orders')
      .update({ 
        assigned_at: newAssignedAt, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', orderId);
      
    if (error) {
      toast.error(error.message);
      loadClosures();
    } else {
      toast.success('Fecha actualizada');
    }
  };

  const markSingleRendido = async (orderId: string) => {
    const { error } = await supabase.from('orders').update({
      delivery_settled: true,
      status2: 'RENDIDO',
      updated_at: new Date().toISOString(),
    }).eq('id', orderId);
    if (error) { toast.error(error.message); return; }
    toast.success('Marcado como RENDIDO');
    loadClosures();
  };

  const markRendicionPagada = async () => {
    let deliveryEmail = '';
    if (isDelivery) {
      deliveryEmail = myEmail;
    } else if (isAdmin || isSupplier) {
      if (selectedDeliveryList.length !== 1) {
        toast.error('Seleccioná un solo delivery para marcar rendición pagada');
        return;
      }
      deliveryEmail = selectedDeliveryList[0];
    }
    
    if (!deliveryEmail) { toast.error('Seleccioná un delivery primero'); return; }
    if (delivered.length === 0) { toast.error('No hay pedidos entregados para procesar'); return; }
    if (
      !confirm(
        `¿Marcar rendición de ${deliveryEmail} como PAGADA?\n\n` +
        `Cobrado en pedidos normales: Gs ${nf(settlementSummary.totalCollected)}\n` +
        `Pago total al delivery: Gs ${nf(settlementSummary.totalDeliveryPayment)}\n` +
        `Neto a rendir: Gs ${nf(totalAPagar)}`
      )
    ) return;

    for (const o of delivered) {
      await supabase.from('orders').update({
        delivery_settled: true,
        delivery_paid_at: new Date().toISOString(),
        status2: 'RENDIDO',
      }).eq('id', o.id);
    }

    const { error } = await supabase.from('rendiciones_pagadas').insert({
      delivery_email: deliveryEmail,
      fecha_rendicion: new Date().toISOString().slice(0, 10),
      monto_total: totalAPagar,
      nota: rendicionNote || `Rendición ${dateFrom} a ${dateTo} — ${delivered.length} pedidos — Cobrado Gs ${nf(settlementSummary.totalCollected)} — Delivery Gs ${nf(settlementSummary.totalDeliveryPayment)} — Neto Gs ${nf(totalAPagar)}`,
      marcado_por: myEmail,
      marcado_en: new Date().toISOString(),
      pagado_en: new Date().toISOString(),
    });

    if (error) { toast.error(error.message); return; }
    toast.success(`Rendición de Gs ${nf(totalAPagar)} marcada como PAGADA`);
    setRendicionNote('');
    loadClosures();
  };

  const desmarcarPagado = async () => {
    if (!rendicionPagada) return;
    if (!confirm('¿Desmarcar esta rendición como pagada?')) return;

    for (const o of delivered) {
      await supabase.from('orders').update({
        delivery_settled: false,
        delivery_paid_at: null,
        status2: '--',
      }).eq('id', o.id);
    }

    await supabase.from('rendiciones_pagadas').delete().eq('id', rendicionPagada.id);
    toast.success('Rendición desmarcada');
    loadClosures();
  };

  const canUseGuides = isDelivery || isAdmin || isSupplier;

  const selectedGuideOrders = useMemo(
    () => displayedOrders.filter(order => selectedGuideIds.has(order.id)),
    [displayedOrders, selectedGuideIds]
  );

  const toggleGuideSelection = (orderId: string) => {
    setSelectedGuideIds(previous => {
      const next = new Set(previous);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  const toggleAllGuideSelections = () => {
    const visibleIds = displayedOrders.map(order => order.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every(id => selectedGuideIds.has(id));

    setSelectedGuideIds(previous => {
      const next = new Set(previous);

      if (allVisibleSelected) {
        visibleIds.forEach(id => next.delete(id));
      } else {
        visibleIds.forEach(id => next.add(id));
      }

      return next;
    });
  };


  const selectedOrders = useMemo(
    () => displayedOrders.filter(order => selectedGuideIds.has(order.id)),
    [displayedOrders, selectedGuideIds],
  );

  const selectedDeliveredOrders = useMemo(
    () =>
      selectedOrders.filter(
        order =>
          (order.status === 'ENTREGADO' || order.status === 'ENCOMIENDA ENTREGADA') &&
          !order.delivery_settled,
      ),
    [selectedOrders],
  );

  const selectedRendibleOrders = useMemo(() => {
    // Cierre normal: conservar exactamente el comportamiento existente.
    if (activeSection !== 'teamClosures') {
      return selectedDeliveredOrders;
    }

    // Cierres de Equipo:
    // ADMIN puede rendir cualquiera.
    if (isAdmin) {
      return selectedDeliveredOrders;
    }

    // PROVEEDOR solo puede rendir ventas/productos propios.
    if (isSupplier) {
      const email = myEmail.trim().toLowerCase();

      return selectedDeliveredOrders.filter(
        order =>
          String(order.provider_email || '').trim().toLowerCase() === email,
      );
    }

    // DELIVERY, incluso si es líder, nunca puede marcar RENDIDO.
    return [];
  }, [
    activeSection,
    selectedDeliveredOrders,
    isAdmin,
    isSupplier,
    myEmail,
  ]);

  const canMarkSelectedAsRendido =
    activeSection === 'teamClosures'
      ? isAdmin || isSupplier
      : canManageRendicion;

  // ADMIN / PROVEEDOR: marcar SOLO los pedidos seleccionados como RENDIDO.
  // No marca la rendición como PAGADA; eso sigue siendo un proceso independiente.
  const markSelectedAsRendido = async () => {
    if (!canMarkSelectedAsRendido) return;

    if (selectedRendibleOrders.length === 0) {
      toast.error(
        activeSection === 'teamClosures' && isSupplier
          ? 'En Cierres de Equipo solo podés marcar RENDIDO pedidos ENTREGADOS que sean ventas de tu propio proveedor'
          : 'Seleccioná pedidos ENTREGADO o ENCOMIENDA ENTREGADA que todavía no estén RENDIDOS',
      );
      return;
    }

    if (
      !confirm(
        `¿Marcar como RENDIDO ${selectedRendibleOrders.length} pedido(s) seleccionado(s)?\n\n` +
        'Solo se modificarán los pedidos seleccionados. Los demás quedarán sin cambios.',
      )
    ) return;

    setBulkBusy(true);

    try {
      const now = new Date().toISOString();
      const ids = selectedRendibleOrders.map(order => order.id);

      const { error } = await supabase
        .from('orders')
        .update({
          delivery_settled: true,
          status2: 'RENDIDO',
          updated_at: now,
        })
        .in('id', ids);

      if (error) throw error;

      toast.success(
        `${ids.length} pedido${ids.length === 1 ? '' : 's'} marcado${ids.length === 1 ? '' : 's'} como RENDIDO`,
      );

      setSelectedGuideIds(new Set());
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudieron marcar los pedidos como RENDIDO');
    } finally {
      setBulkBusy(false);
    }
  };

  // ADMIN / PROVEEDOR: cambiar la fecha de asignación SOLO de los pedidos seleccionados.
  const changeSelectedAssignedDate = async () => {
    if (!canManageRendicion) return;

    const ids = selectedOrders.map(order => order.id);

    if (ids.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    if (!bulkAssignedDate) {
      toast.error('Seleccioná la nueva fecha de asignación');
      return;
    }

    if (
      !confirm(
        `¿Cambiar la fecha de asignación de ${ids.length} pedido(s) a ${formatDatePY(bulkAssignedDate)}?\n\n` +
        'Solo se modificarán los pedidos seleccionados.',
      )
    ) return;

    setBulkBusy(true);

    try {
      const newAssignedAt = `${bulkAssignedDate}T12:00:00`;
      const now = new Date().toISOString();

      const { error } = await supabase
        .from('orders')
        .update({
          assigned_at: newAssignedAt,
          updated_at: now,
        })
        .in('id', ids);

      if (error) throw error;

      toast.success(
        `Fecha actualizada en ${ids.length} pedido${ids.length === 1 ? '' : 's'}`,
      );

      setBulkAssignedDate('');
      setSelectedGuideIds(new Set());
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudo cambiar la fecha de los pedidos seleccionados');
    } finally {
      setBulkBusy(false);
    }
  };

  const assignSelectedToTeam = async () => {
    if (!(isDelivery || isSupplier || isAdmin)) return;

    const ids = Array.from(selectedGuideIds);
    if (ids.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    if (!bulkTeamUserId) {
      toast.error('Seleccioná un integrante de tu equipo');
      return;
    }

    if ((isSupplier || isAdmin) && bulkTeamUserId === 'SELF') {
      toast.error(
        `${isAdmin ? 'El ADMIN' : 'El PROVEEDOR'} líder debe asignar el pedido a un delivery de su equipo`,
      );
      return;
    }

    const target =
      bulkTeamUserId === 'SELF'
        ? { name: profile?.name || myEmail }
        : teamMembers.find(member => member.member_user_id === bulkTeamUserId);

    if (!target) {
      toast.error('El integrante seleccionado ya no está disponible');
      return;
    }

    const targetLabel = (target as any).name || (target as any).member_name || (target as any).member_email || myEmail;
    if (!confirm(`¿Asignar ${ids.length} pedido(s) a ${targetLabel}?`)) return;

    setBulkBusy(true);
    try {
      const { data, error } = await supabase.rpc('assign_orders_to_team_member', {
        p_order_ids: ids,
        p_member_user_id: bulkTeamUserId === 'SELF' ? null : bulkTeamUserId,
      });

      if (error) throw error;

      toast.success(`${Number(data ?? ids.length)} pedido(s) asignado(s) correctamente`);
      setSelectedGuideIds(new Set());
      await loadClosures();
    } catch (error: any) {
      toast.error(error?.message || 'No se pudieron asignar los pedidos');
    } finally {
      setBulkBusy(false);
    }
  };

  const copySelectedGuides = async () => {
    if (selectedGuideOrders.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    try {
      const guideText = selectedGuideOrders
        .map(buildGuideText)
        .join('\n\n════════════════════════════════\n\n');

      await navigator.clipboard.writeText(guideText);
      toast.success(`${selectedGuideOrders.length} guía${selectedGuideOrders.length === 1 ? '' : 's'} copiada${selectedGuideOrders.length === 1 ? '' : 's'}`);
    } catch {
      toast.error('No se pudieron copiar las guías');
    }
  };

  const downloadSelectedGuidesPdf = () => {
    if (selectedGuideOrders.length === 0) {
      toast.error('Seleccioná al menos un pedido');
      return;
    }

    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      toast.error('El navegador bloqueó la ventana. Permití ventanas emergentes e intentá nuevamente.');
      return;
    }

    const orderCards = selectedGuideOrders.map((order, index) => {
      const phone = getOrderPhone(order);
      const whatsappUrl = getWhatsAppUrl(order);
      const items = getOrderItems(order);
      const address = [order?.street, order?.district].filter(Boolean).join(' - ');

      const itemsHtml = items.length > 0
        ? items.map((item: any, itemIndex: number) => {
            const qty = Number(item.qty || item.quantity || item.cantidad || 1);
            const unitPrice = Number(item.sale_gs || item.price_gs || item.price || 0);
            const lineTotal = unitPrice * qty;
            const label = item.title || item.name || item.sku || 'Producto';

            return `
              <tr>
                <td>${itemIndex + 1}</td>
                <td>${escapeHtml(label)}</td>
                <td>${qty}</td>
                <td>${lineTotal > 0 ? `Gs ${escapeHtml(nf(lineTotal))}` : '—'}</td>
              </tr>
            `;
          }).join('')
        : '<tr><td colspan="4">Sin detalle de productos</td></tr>';

      return `
        <section class="guide ${index < selectedGuideOrders.length - 1 ? 'page-break' : ''}">
          <div class="guide-header">
            <div>
              <h1>GUÍA DE ENVÍO</h1>
              <div class="order-number">Pedido ${escapeHtml(order?.order_number || order?.id?.slice(0, 8) || '—')}</div>
            </div>
            <div class="date">${escapeHtml(formatDatePY(order?.assigned_at || order?.created_at))}</div>
          </div>

          <div class="message">
            <strong>Mensaje para el cliente:</strong><br>
            Buenas ${escapeHtml(order?.customer_name || '')}, le escribo para coordinar la entrega de su pedido.
            ¿Me podría indicar o enviar la ubicación por Google Maps para poder realizar la entrega?
          </div>

          <div class="grid">
            <div><span>Cliente</span><strong>${escapeHtml(order?.customer_name || '—')}</strong></div>
            <div>
              <span>Teléfono / WhatsApp</span>
              ${whatsappUrl
                ? `<a href="${escapeHtml(whatsappUrl)}">${escapeHtml(phone)}</a>`
                : `<strong>${escapeHtml(phone || '—')}</strong>`}
            </div>
            <div><span>Ciudad</span><strong>${escapeHtml(order?.city || '—')}</strong></div>
            <div><span>Dirección</span><strong>${escapeHtml(address || '—')}</strong></div>
            ${order?.email ? `<div><span>Email</span><strong>${escapeHtml(order.email)}</strong></div>` : ''}
            <div><span>Total</span><strong>Gs ${escapeHtml(nf(Number(order?.total_gs || 0)))}</strong></div>
          </div>

          <h2>Productos</h2>
          <table>
            <thead>
              <tr><th>#</th><th>Producto</th><th>Cantidad</th><th>Subtotal</th></tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>

          ${order?.obs ? `<div class="observation"><strong>Observación:</strong> ${escapeHtml(order.obs)}</div>` : ''}

          <div class="click-note">
            Hacé clic en el número de teléfono para abrir WhatsApp con el mensaje y la guía completa.
          </div>
        </section>
      `;
    }).join('');

    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Guías de pedidos</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
            .toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: center; gap: 12px; padding: 12px; background: #111827; }
            .toolbar button { border: 0; border-radius: 8px; padding: 10px 18px; font-weight: 700; cursor: pointer; }
            .toolbar .primary { background: #2563eb; color: #fff; }
            .toolbar .secondary { background: #e5e7eb; color: #111827; }
            .guide { max-width: 190mm; margin: 12mm auto; padding: 10mm; border: 1px solid #d1d5db; border-radius: 12px; }
            .guide-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 3px solid #111827; }
            h1 { margin: 0; font-size: 22px; }
            h2 { margin: 18px 0 8px; font-size: 15px; }
            .order-number { margin-top: 5px; font-size: 14px; font-weight: 700; }
            .date { font-size: 12px; }
            .message { margin: 14px 0; padding: 12px; border: 1px solid #93c5fd; border-radius: 8px; background: #eff6ff; font-size: 13px; line-height: 1.5; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .grid > div { padding: 8px; border: 1px solid #e5e7eb; border-radius: 7px; }
            span { display: block; margin-bottom: 3px; color: #6b7280; font-size: 10px; text-transform: uppercase; }
            strong, a { font-size: 13px; overflow-wrap: anywhere; }
            a { color: #047857; font-weight: 800; text-decoration: underline; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; }
            th { background: #f3f4f6; }
            .observation { margin-top: 12px; padding: 10px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px; font-size: 12px; }
            .click-note { margin-top: 12px; text-align: center; color: #4b5563; font-size: 10px; }
            .page-break { break-after: page; page-break-after: always; }
            @page { size: A4; margin: 8mm; }
            @media print {
              .toolbar { display: none !important; }
              .guide { max-width: none; margin: 0; padding: 6mm; border: 0; border-radius: 0; }
              a { color: #047857 !important; text-decoration: underline !important; }
            }
          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="primary" onclick="window.print()">Guardar como PDF</button>
            <button class="secondary" onclick="window.close()">Cerrar</button>
          </div>
          ${orderCards}
          <script>
            window.addEventListener('load', function () {
              setTimeout(function () { window.print(); }, 500);
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
  };

  const state2Opts = ['--', 'GUIA GENERADA', 'FUERA DE COBERTURA', 'CANCELADO', 'REPETIDO', 'RENDIDO'];
  const retiroOpts = ['', 'PENDIENTE', 'REALIZADO', 'CANCELADO'];
  
  let deliveryName = '';
  if (isDelivery) {
    deliveryName = profile?.name || myEmail;
  } else if ((isAdmin || isSupplier) && selectedDeliveryList.length === 1) {
    const found = deliveries.find((d: any) => d.email === selectedDeliveryList[0]);
    deliveryName = found?.name || selectedDeliveryList[0];
  } else if ((isAdmin || isSupplier) && selectedDeliveryList.length > 1) {
    deliveryName = `${selectedDeliveryList.length} repartidores seleccionados`;
  }
  
  const allRendered = noRendidos.length === 0 && delivered.length > 0;
  
  const acceptedTeamMembers = teamMembers.filter(member => member.status === 'ACCEPTED');

  // Visibilidad financiera en la pestaña NORMAL de Cierres.
  //
  // ADMIN / PROVEEDOR:
  //   siempre ven tarifa y valores financieros.
  //
  // DELIVERY encargado/líder:
  //   siempre los ve porque administra un Equipo de Logística.
  //
  // DELIVERY común:
  //   solo los ve cuando SU propio usuario ya tiene al menos una tarifa
  //   configurada en delivery_fees. Si todavía no tiene ninguna, se ocultan.
  const isTeamLeader = (isDelivery || isSupplier || isAdmin) && acceptedTeamMembers.length > 0;

  const deliveryHasOwnTariff = useMemo(() => {
    if (!isDelivery || !myEmail) return false;

    const normalizedEmail = myEmail.trim().toLowerCase();

    return fees.some(
      (fee: any) =>
        String(fee?.delivery_email || '').trim().toLowerCase() === normalizedEmail,
    );
  }, [fees, isDelivery, myEmail]);

  const canViewNormalClosureFinancials =
    isAdmin ||
    isSupplier ||
    isTeamLeader ||
    (isDelivery && deliveryHasOwnTariff);
  const teamCandidates = deliveries.filter((delivery: any) => {
    const q = teamSearch.trim().toLowerCase();
    if (!delivery?.user_id || String(delivery.email || '').toLowerCase() === myEmail.toLowerCase()) return false;
    if (teamMembers.some(member => member.member_user_id === delivery.user_id && member.status !== 'REMOVED' && member.status !== 'REJECTED')) return false;
    if (!q) return true;
    return (
      String(delivery.name || '').toLowerCase().includes(q) ||
      String(delivery.email || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="app-card">
      <header className="closure-tabs-head">
        <div className="closure-premium-eyebrow">CENTRO DE OPERACIONES</div>
        <h3 className="text-2xl font-black">CIERRES <span className="text-muted-foreground text-base font-medium">/ Panel de control</span></h3>
        <p className="text-sm text-muted-foreground">Cada módulo está separado. Elegí qué querés revisar sin llenar toda la pantalla.</p>
      </header>
      <nav className="closure-tab-nav" aria-label="Módulos de cierres">
        {([
          ['resumen', '📊', 'Resumen'],
          ['pedidos', '📦', 'Pedidos'],
          ['repetidos', '🔁', 'Repetidos'],
          ['pagos', '💳', 'Pagos de cierre'],
          ['historial', '🧾', 'Historial'],
          ['config', '⚙️', 'Configuración'],
        ] as const).filter(([id]) => id !== 'config' || isAdmin || isSupplier).filter(([id]) => (id !== 'pagos' && id !== 'historial') || canViewRendicion).map(([id, icon, label]) => (
          <button key={id} type="button" className={`closure-tab-btn ${closureTab === id ? 'selected' : ''}`}
            onClick={() => { setClosureTab(id); if (id === 'repetidos') setOnlyPossibleDuplicates(true); else setOnlyPossibleDuplicates(false); if (activeSection !== 'orders') setActiveSection('orders'); }}
            aria-current={closureTab === id ? 'page' : undefined}>
            <span aria-hidden="true">{icon}</span><span>{label}</span>
            {id === 'repetidos' && possibleDuplicates.count > 0 && <span className="closure-tab-count">{possibleDuplicates.count}</span>}
          </button>
        ))}
      </nav>
      {canViewRendicion && (closureTab === 'pagos' || closureTab === 'historial' || closureTab === 'config') && (
        <ClosurePaymentsPanel role={myRole} email={myEmail} userId={profile?.user_id} view={closureTab} />
      )}

      {(closureTab === 'pedidos') && (isDelivery || isAdmin || isSupplier) && (
        <div className="flex flex-wrap gap-2 mb-4 border-b border-border pb-3">
          <button
            type="button"
            className={`nav-btn ${activeSection === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveSection('orders')}
          >
            📦 Pedidos
          </button>
          <button
            type="button"
            className={`nav-btn ${activeSection === 'team' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('team');
              loadTeamData();
            }}
          >
            👥 Equipo de Logística
            {isDelivery && teamInvitations.length > 0 && (
              <span className="ml-2 inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded-full bg-amber-500 text-black text-[10px] font-extrabold">
                {teamInvitations.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`nav-btn ${activeSection === 'teamClosures' ? 'active' : ''}`}
            onClick={async () => {
              if (isAdmin) {
                setSelectedTeamOwnerEmail('');
              }
              setFilterDeliveries(new Set());
              setFilterSuppliers(new Set());
              setSelectedGuideIds(new Set());

              // En Cierres de Equipo, ADMIN / PROVEEDOR / DELIVERY
              // también deben poder filtrar por proveedor.
              await Promise.all([
                loadTeamData(),
                loadSuppliers(),
              ]);

              setActiveSection('teamClosures');
            }}
          >
            📊 Cierres de Equipo
          </button>
        </div>
      )}

      {activeSection === 'team' && (isDelivery || isAdmin || isSupplier) && (
        <div className="space-y-4">
          {isDelivery && teamInvitations.length > 0 && (
            <div className="app-card !p-4 border-2 border-amber-500/50 bg-amber-500/10">
              <div className="font-extrabold text-base">
                🔔 Tenés {teamInvitations.length} solicitud{teamInvitations.length === 1 ? '' : 'es'} para unirte a un equipo
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Aceptá la solicitud para que el líder pueda asignarte pedidos.
              </div>
            </div>
          )}
          {teamLoading ? (
            <div className="app-card text-sm text-muted-foreground">Cargando Equipo de Logística...</div>
          ) : (isDelivery || isSupplier || isAdmin) ? (
            <>
              {isDelivery && teamInvitations.length > 0 && (
                <div className="app-card !p-4 border border-amber-500/30 bg-amber-500/5">
                  <h4 className="font-extrabold mb-3">🔔 Solicitudes recibidas</h4>
                  <div className="space-y-2">
                    {teamInvitations.map(invitation => (
                      <div key={invitation.relation_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                        <div>
                          <div className="font-bold">{invitation.owner_name || invitation.owner_email}</div>
                          <div className="text-xs text-muted-foreground">{invitation.owner_email}</div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            className="nav-btn"
                            disabled={bulkBusy}
                            onClick={() => respondTeamInvitation(invitation.relation_id, false)}
                          >
                            Rechazar
                          </button>
                          <button
                            className="nav-btn active"
                            disabled={bulkBusy}
                            onClick={() => respondTeamInvitation(invitation.relation_id, true)}
                          >
                            Aceptar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="app-card !p-4">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <h4 className="font-extrabold text-lg">
                      👥 {isAdmin
                        ? 'Mi equipo de logística como ADMIN'
                        : isSupplier
                          ? 'Mi equipo de logística como PROVEEDOR'
                          : 'Mi equipo'}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Solo los deliveries que acepten tu solicitud aparecerán al asignar pedidos.
                      {(isSupplier || isAdmin) && ' Vos quedás como titular/líder del equipo.'}
                    </p>
                  </div>
                  <button className="nav-btn" type="button" onClick={loadTeamData}>🔄 Actualizar</button>
                </div>

                {teamMembers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">Todavía no agregaste deliveries a tu equipo.</div>
                ) : (
                  <div className="space-y-2">
                    {teamMembers.map(member => (
                      <div key={member.relation_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                        <div>
                          <div className="font-bold">{member.member_name || member.member_email}</div>
                          <div className="text-xs text-muted-foreground">{member.member_email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`badge-status ${
                            member.status === 'ACCEPTED'
                              ? 'badge-entregado'
                              : member.status === 'PENDING'
                                ? 'badge-pendiente'
                                : 'badge-cancelado'
                          }`}>
                            {member.status === 'ACCEPTED' ? 'ACTIVO' : member.status === 'PENDING' ? 'PENDIENTE' : member.status}
                          </span>
                          {(member.status === 'ACCEPTED' || member.status === 'PENDING') && (
                            <button
                              className="nav-btn !py-1 !px-2 text-xs"
                              disabled={bulkBusy}
                              onClick={() => removeTeamMember(member.relation_id)}
                            >
                              {member.status === 'PENDING' ? 'Cancelar solicitud' : 'Quitar'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="app-card !p-4">
                <h4 className="font-extrabold mb-3">➕ Agregar delivery al equipo</h4>
                <input
                  className="app-input w-full mb-3"
                  value={teamSearch}
                  onChange={event => setTeamSearch(event.target.value)}
                  placeholder="Buscar delivery por nombre o correo..."
                />
                <div className="max-h-80 overflow-auto space-y-2">
                  {teamCandidates.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-3">No hay deliveries disponibles para invitar.</div>
                  ) : (
                    teamCandidates.map((delivery: any) => (
                      <div key={delivery.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                        <div>
                          <div className="font-bold">{delivery.name || delivery.email}</div>
                          <div className="text-xs text-muted-foreground">{delivery.email}</div>
                        </div>
                        <button
                          className="nav-btn active"
                          disabled={bulkBusy}
                          onClick={() => inviteDelivery(delivery.user_id)}
                        >
                          Enviar solicitud
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {(isSupplier || isAdmin) && (
                <div className="app-card !p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                    <div>
                      <h4 className="font-extrabold text-lg">🌐 Todos los equipos de logística</h4>
                      <p className="text-xs text-muted-foreground">
                        {isAdmin
                          ? 'Como ADMIN conservás la vista global, además de administrar tu propio equipo.'
                          : 'Como PROVEEDOR conservás la vista global, además de administrar tu propio equipo.'}
                      </p>
                    </div>
                    <button className="nav-btn" type="button" onClick={loadTeamData}>🔄 Actualizar</button>
                  </div>

                  {allTeams.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-4">No hay equipos creados.</div>
                  ) : (
                    <div className="overflow-auto">
                      <table className="app-table min-w-[900px]">
                        <thead>
                          <tr>
                            <th>Líder</th>
                            <th>Miembro</th>
                            <th>Estado</th>
                            <th>Invitado</th>
                            <th>Aceptado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allTeams.map(row => (
                            <tr key={`supplier-global-${row.relation_id}`}>
                              <td>
                                <div className="font-bold text-xs">{row.owner_name || row.owner_email}</div>
                                <div className="text-[11px] text-muted-foreground">{row.owner_email}</div>
                              </td>
                              <td>
                                <div className="font-bold text-xs">{row.member_name || row.member_email}</div>
                                <div className="text-[11px] text-muted-foreground">{row.member_email}</div>
                              </td>
                              <td><span className="badge-status">{row.status}</span></td>
                              <td className="text-xs">{row.invited_at ? new Date(row.invited_at).toLocaleString('es-PY') : '—'}</td>
                              <td className="text-xs">{row.accepted_at ? new Date(row.accepted_at).toLocaleString('es-PY') : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="app-card !p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h4 className="font-extrabold text-lg">👥 Todos los equipos de logística</h4>
                  <p className="text-xs text-muted-foreground">
                    Vista global para ADMIN.
                  </p>
                </div>
                <button className="nav-btn" type="button" onClick={loadTeamData}>🔄 Actualizar</button>
              </div>

              {allTeams.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4">No hay equipos creados.</div>
              ) : (
                <div className="overflow-auto">
                  <table className="app-table min-w-[900px]">
                    <thead>
                      <tr>
                        <th>Delivery líder</th>
                        <th>Miembro</th>
                        <th>Estado</th>
                        <th>Invitado</th>
                        <th>Aceptado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTeams.map(row => (
                        <tr key={row.relation_id}>
                          <td>
                            <div className="font-bold text-xs">{row.owner_name || row.owner_email}</div>
                            <div className="text-[11px] text-muted-foreground">{row.owner_email}</div>
                          </td>
                          <td>
                            <div className="font-bold text-xs">{row.member_name || row.member_email}</div>
                            <div className="text-[11px] text-muted-foreground">{row.member_email}</div>
                          </td>
                          <td><span className="badge-status">{row.status}</span></td>
                          <td className="text-xs">{row.invited_at ? new Date(row.invited_at).toLocaleString('es-PY') : '—'}</td>
                          <td className="text-xs">{row.accepted_at ? new Date(row.accepted_at).toLocaleString('es-PY') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className={(closureTab === 'resumen' || closureTab === 'pedidos' || closureTab === 'repetidos') && (activeSection === 'orders' || activeSection === 'teamClosures') ? '' : 'hidden'}>

      {activeSection === 'teamClosures' && (isDelivery || isSupplier || isAdmin) && (
        <div className="mb-3 app-card !p-3 border border-violet-500/30 bg-violet-500/5">
          {teamClosureTeamOptions.length === 0 && (
            <div className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">
              ⚠️ Cierres de Equipo está vacío porque todavía no existe un equipo activo con miembros ACCEPTED.
            </div>
          )}
          <div className="font-extrabold">📊 CIERRES DE EQUIPO</div>
          <p className="text-xs text-muted-foreground mt-1">
            {isAdmin
              ? 'ADMIN puede elegir cualquier equipo, filtrar sus deliveries y realizar el cierre completo. Todo pedido asignado a un miembro ACCEPTED aparece en su equipo. La tarifa mostrada es la tarifa propia de cada DELIVERY miembro.'
              : isSupplier
                ? 'Todo pedido asignado a un DELIVERY ACCEPTED de tu equipo aparece acá, aunque la venta sea de otro proveedor. El filtro Proveedor sirve solo para organizar la vista. Solo podés marcar RENDIDO cuando provider_email sea tu propio usuario. La tarifa es la propia de cada DELIVERY miembro.'
                : 'Todo pedido asignado a un DELIVERY ACCEPTED de tu equipo aparece automáticamente acá, aunque la venta sea de otro proveedor. DELIVERY también puede usar el filtro Proveedor para organizar la vista. DELIVERY no puede marcar RENDIDO aunque sea líder. La tarifa es la propia de cada DELIVERY miembro.'}
          </p>
        </div>
      )}

      {isDelivery && (
        <div className="mb-3">
          <span className="badge-status badge-entregado">✏️ DELIVERY: solo podés editar Estado 1</span>
          <p className="text-xs text-muted-foreground mt-1">
            Podés actualizar estados, seleccionar varios pedidos, generar guías y asignar pedidos a tu Equipo de Logística.
            {!isTeamLeader && !deliveryHasOwnTariff &&
              ' Todavía no tenés una tarifa configurada, por eso Tarifa, Neto y valores derivados no están visibles.'}
            {!isTeamLeader && deliveryHasOwnTariff &&
              ' Ya tenés tarifa configurada, por eso podés ver Tarifa, Neto y los valores normales de tu cierre.'}
            {isTeamLeader &&
              ' Como encargado de equipo, podés ver las tarifas y valores de cierre.'}
          </p>
        </div>
      )}

      {(isSupplier || isAdmin) && (
        <div className="mb-3">
          <span className="badge-status badge-entregado">✏️ PROVEEDOR/ADMIN: edición completa</span>
          <p className="text-xs text-muted-foreground mt-1">
            Podés actualizar estados, fechas, ciudades, marcar pedidos seleccionados como RENDIDO y gestionar rendiciones.
            {(isSupplier || isAdmin) && ` También podés crear tu propio Equipo de Logística, ser su titular/líder y ${isSupplier ? 'usar tus tarifas por ciudad' : 'asignar pedidos a tus miembros'} para los pedidos delegados.`}
          </p>
        </div>
      )}

      {isVendedor && (
        <div className="mb-3">
          <span className="badge-status badge-entregado">✏️ VENDEDOR: solo podés ver tus pedidos</span>
          <p className="text-xs text-muted-foreground mt-1">Podés filtrar por fecha y estado. Todos los pedidos que ves son los que vos creaste.</p>
        </div>
      )}

      <details className="closure-accordion" open>
        <summary>🔎 Filtros de consulta <span className="closure-accordion-hint">Fechas · Delivery · Proveedor · Estado · Rendición</span></summary>
        <div className="closure-accordion-inner">
      <div className="flex flex-wrap gap-2 mb-3">
        <label className="app-label !mt-0">Desde</label>
        <input
          type="date"
          className="app-input !w-auto"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <label className="app-label !mt-0">Hasta</label>
        <input
          type="date"
          className="app-input !w-auto"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
        <span
          className="self-center text-[10px] text-muted-foreground"
          title="El rango inicial es hoy a mañana, pero podés cambiar ambas fechas libremente."
        >
          24 h iniciales
        </span>
        
        {activeSection === 'teamClosures' && (isDelivery || isSupplier || isAdmin) && (
          <div className="flex items-center gap-1">
            <select
              className="app-input !w-auto min-w-[280px]"
              value={isAdmin ? selectedTeamOwnerEmail : effectiveTeamOwnerEmail}
              onChange={event => {
                if (!isAdmin) return;
                setSelectedTeamOwnerEmail(event.target.value);
                setFilterDeliveries(new Set());
                setSelectedGuideIds(new Set());
              }}
              disabled={!isAdmin}
              title={isAdmin ? 'Seleccionar equipo/líder' : 'Tu equipo de logística'}
            >
              {isAdmin && <option value="">Seleccionar equipo...</option>}
              {teamClosureTeamOptions.map(team => (
                <option key={team.owner_email} value={team.owner_email}>
                  👥 {team.owner_name || team.owner_email}
                </option>
              ))}
            </select>

            {teamClosureTeamOptions.length === 0 && (
              <span className="text-xs text-amber-400 font-bold">
                No hay equipos activos con miembros ACCEPTED
              </span>
            )}
          </div>
        )}

        {(
          activeSection === 'teamClosures'
            ? (isDelivery || isSupplier || isAdmin)
            : (isSupplier || isAdmin)
        ) && (
          <div className="relative flex items-center gap-1">
            <button
              type="button"
              className="app-input !w-auto min-w-[280px] text-left"
              onClick={() => setShowDeliveryDropdown(!showDeliveryDropdown)}
            >
              {selectedDeliveryList.length === 0
                ? activeSection === 'teamClosures'
                  ? 'Todos los deliveries del equipo'
                  : 'Todos los repartidores'
                : `${selectedDeliveryList.length} repartidor${selectedDeliveryList.length > 1 ? 'es' : ''} seleccionado${selectedDeliveryList.length > 1 ? 's' : ''}`}
            </button>

            <button
              className="nav-btn !bg-gray-500 text-xs !py-1 !px-2"
              onClick={() => loadDeliveries()}
              title="Recargar repartidores"
              type="button"
            >
              🔄
            </button>

            {showDeliveryDropdown && (
              <div className="absolute top-full left-0 z-50 mt-1 w-[360px] max-h-96 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="p-2 border-b border-border">
                  <input
                    className="app-input w-full text-sm"
                    placeholder="🔎 Buscar delivery por nombre o correo..."
                    value={deliverySearch}
                    onChange={e => setDeliverySearch(e.target.value)}
                  />
                </div>
                <div className="flex gap-2 p-2 border-b border-border">
                  <button className="nav-btn !py-1 text-xs" type="button" onClick={selectAllDeliveryFilters}>
                    {filterDeliveries.size === (activeSection === 'teamClosures' ? teamClosureDeliveryOptions.length : deliveries.length) ? 'Deseleccionar todos' : 'Seleccionar todos'}
                  </button>
                  <button className="nav-btn !py-1 text-xs" type="button" onClick={() => setFilterDeliveries(new Set())}>
                    Limpiar
                  </button>
                </div>
                <div className="max-h-64 overflow-auto">
                  {loadingDeliveries ? (
                    <div className="p-3 text-sm text-muted-foreground">Cargando repartidores...</div>
                  ) : filteredDeliveryOptions.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No hay repartidores disponibles</div>
                  ) : (
                    filteredDeliveryOptions.map((d: any) => (
                      <label key={d.email} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-secondary">
                        <input
                          type="checkbox"
                          checked={filterDeliveries.has(d.email)}
                          onChange={() => toggleDeliveryFilter(d.email)}
                        />
                        <span className="font-bold">{d.name || d.email}</span>
                        {d.name && <span className="ml-auto text-xs text-muted-foreground">{d.email}</span>}
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {(
          activeSection === 'teamClosures'
            ? (isAdmin || isSupplier || isDelivery)
            : (isAdmin || isSupplier || isDelivery)
        ) && (
          <div className="relative">
            <button
              type="button"
              className="app-input min-w-[280px] flex items-center justify-between gap-3"
              onClick={() => setShowSupplierDropdown(previous => !previous)}
            >
              <span className="truncate">
                {selectedSupplierList.length === 0
                  ? activeSection === 'teamClosures'
                    ? 'Todos los proveedores de las ventas'
                    : isSupplier
                      ? 'Todos los proveedores de mis pedidos gestionados'
                      : 'Todos los proveedores'
                  : `${selectedSupplierList.length} proveedor${
                      selectedSupplierList.length === 1 ? '' : 'es'
                    } seleccionado${
                      selectedSupplierList.length === 1 ? '' : 's'
                    }`}
              </span>

              <span className="shrink-0 text-xs text-muted-foreground">
                {selectedSupplierList.length}/{MAX_SUPPLIERS} ▾
              </span>
            </button>

            {showSupplierDropdown && (
              <div className="absolute top-full left-0 z-50 mt-1 w-[360px] max-w-[calc(100vw-2rem)] max-h-96 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
                <div className="p-2 border-b border-border">
                  <input
                    className="app-input w-full text-sm"
                    placeholder="🔎 Buscar proveedor por nombre o correo..."
                    value={supplierSearch}
                    onChange={event => setSupplierSearch(event.target.value)}
                    autoFocus
                  />
                </div>

                <div className="flex gap-2 p-2 border-b border-border">
                  <button
                    type="button"
                    className="nav-btn !py-1 text-xs"
                    onClick={selectFirstTenSupplierFilters}
                  >
                    Seleccionar hasta 10
                  </button>

                  <button
                    type="button"
                    className="nav-btn !py-1 text-xs"
                    onClick={() => setFilterSuppliers(new Set())}
                  >
                    Limpiar
                  </button>
                </div>

                <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
                  Podés seleccionar hasta {MAX_SUPPLIERS} proveedores.
                </div>

                <div className="max-h-64 overflow-auto">
                  {suppliers.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No se encontraron proveedores
                    </div>
                  ) : filteredSupplierOptions.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">
                      No hay proveedores que coincidan con la búsqueda
                    </div>
                  ) : (
                    filteredSupplierOptions.map((supplier: any) => {
                      const selected = filterSuppliers.has(supplier.email);
                      const limitReached =
                        !selected && filterSuppliers.size >= MAX_SUPPLIERS;

                      return (
                        <label
                          key={supplier.email}
                          className={`flex items-center gap-2 px-3 py-2 text-sm ${
                            limitReached
                              ? 'cursor-not-allowed opacity-50'
                              : 'cursor-pointer hover:bg-secondary'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={limitReached}
                            onChange={() => toggleSupplierFilter(supplier.email)}
                          />

                          <span className="font-bold">
                            {supplier.name || supplier.email}
                          </span>

                          {supplier.name && (
                            <span className="ml-auto max-w-[150px] truncate text-xs text-muted-foreground">
                              {supplier.email}
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="relative">
          <button
            type="button"
            className="app-input min-w-[230px] flex items-center justify-between gap-3"
            onClick={() => setShowStatusDropdown(previous => !previous)}
          >
            <span className="truncate">
              {selectedStatusList.length === 0
                ? 'Todos los estados'
                : selectedStatusList.length === STATUS_1_OPTIONS.length
                  ? 'Todos los estados seleccionados'
                  : `${selectedStatusList.length} estado${
                      selectedStatusList.length === 1 ? '' : 's'
                    } seleccionado${
                      selectedStatusList.length === 1 ? '' : 's'
                    }`}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {selectedStatusList.length}/{STATUS_1_OPTIONS.length} ▾
            </span>
          </button>

          {showStatusDropdown && (
            <div className="absolute top-full left-0 z-50 mt-1 w-[330px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              <div className="flex gap-2 p-2 border-b border-border">
                <button
                  type="button"
                  className="nav-btn !py-1 text-xs"
                  onClick={selectAllStatusFilters}
                >
                  {filterStatuses.size === STATUS_1_OPTIONS.length
                    ? 'Deseleccionar todos'
                    : 'Seleccionar todos'}
                </button>

                <button
                  type="button"
                  className="nav-btn !py-1 text-xs"
                  onClick={() => setFilterStatuses(new Set())}
                >
                  Limpiar filtro
                </button>
              </div>

              <div className="max-h-72 overflow-auto">
                {STATUS_1_OPTIONS.map(status => (
                  <label
                    key={status}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={filterStatuses.has(status)}
                      onChange={() => toggleStatusFilter(status)}
                    />
                    <span className="font-bold">{status}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        
        <div className="closure-premium-filter flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/50 p-2">
          <span className="px-2 text-xs font-bold text-muted-foreground">Rendición:</span>
          <button
            type="button"
            className={`nav-btn !py-1 ${settlementFilter === 'all' ? 'active' : ''}`}
            onClick={() => setSettlementFilter('all')}
          >
            Todos ({settlementFilterCounts.all})
          </button>
          <button
            type="button"
            className={`nav-btn !py-1 ${settlementFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setSettlementFilter('pending')}
          >
            No rendidos ({settlementFilterCounts.pending})
          </button>
          <button
            type="button"
            className={`nav-btn !py-1 ${settlementFilter === 'settled' ? 'active' : ''}`}
            onClick={() => setSettlementFilter('settled')}
          >
            Rendidos ({settlementFilterCounts.settled})
          </button>
        </div>

        {!isVendedor && !isSupplier && (
          <select className="app-input !w-auto" value={filterDateBy} onChange={e => setFilterDateBy(e.target.value as any)}>
            <option value="assigned_at">📅 Filtrar por fecha de asignación</option>
            <option value="created_at">📅 Filtrar por fecha de creación</option>
          </select>
        )}
        
        <button className="nav-btn active" onClick={loadClosures}>Aplicar</button>
      </div>
        </div>
      </details>


      <div className={closureTab === 'resumen' ? '' : 'hidden'}>
      <div className="closure-section-heading"><span className="closure-section-number">02</span><div><h3>Resumen del período</h3><p>Indicadores, estados y posibles pedidos repetidos</p></div></div>
      <section className="closure-premium-overview" aria-label="Resumen ejecutivo de cierres">
        <div className="closure-premium-header">
          <div>
            <div className="closure-premium-eyebrow">CENTRO DE OPERACIONES</div>
            <h3>Control de cierres <span>en tiempo real</span></h3>
            <p>Visualizá el estado de los pedidos filtrados y priorizá las rendiciones pendientes.</p>
          </div>
          <div className="closure-premium-indicator"><span className="closure-live-dot" /> Resumen de pedidos cargados</div>
        </div>
        <div className="closure-premium-kpis">
          <div className="closure-premium-metric metric-orders"><div className="metric-label">📦 PEDIDOS EN VISTA</div><strong>{filteredOrders.length}</strong><span>Según los filtros activos</span></div>
          <div className="closure-premium-metric metric-complete"><div className="metric-label">✅ RENDIDOS</div><strong>{kpis.rendidos}</strong><span>Gs {nf(kpis.montoRendido)}</span></div>
          <div className="closure-premium-metric metric-pending"><div className="metric-label">⏳ SIN RENDIR</div><strong>{kpis.noRendidos}</strong><span>Gs {nf(kpis.montoPendiente)}</span></div>
          <div className="closure-premium-metric metric-net"><div className="metric-label">💰 NETO DEL PERÍODO</div><strong>Gs {nf(kpis.montoRendido + kpis.montoPendiente)}</strong><span>Entregados · neto estimado</span></div>
          <button type="button" className={`closure-premium-metric metric-duplicates text-left ${onlyPossibleDuplicates ? 'metric-selected' : ''}`} onClick={() => { setSelectedGuideIds(new Set()); setOnlyPossibleDuplicates(true); setClosureTab('repetidos'); }} aria-pressed={onlyPossibleDuplicates}>
            <span className="metric-label">🔁 POSIBLES REPETIDOS</span>
            <strong>{possibleDuplicates.count}</strong>
            <span>{possibleDuplicates.groupsCount} grupos · teléfono, ciudad y fecha</span>
            <span className="metric-link">{onlyPossibleDuplicates ? 'Mostrar todos los pedidos' : 'Ver posibles repetidos'}</span>
          </button>
          <button type="button" className={`closure-premium-metric metric-duplicates text-left ${onlyCarried ? 'metric-selected' : ''}`} onClick={() => { setSelectedGuideIds(new Set()); setOnlyCarried(v => !v); setClosureTab('pedidos'); }} aria-pressed={onlyCarried}>
            <span className="metric-label">📅 DE OTRAS FECHAS</span>
            <strong>{carriedCount}</strong>
            <span>Pasados a este día desde otra fecha</span>
            <span className="metric-link">{onlyCarried ? 'Mostrar todos los pedidos' : 'Ver arrastrados'}</span>
          </button>
        </div>
        <div className="closure-premium-graph">
          <div className="closure-premium-graph-head"><span>Progreso de rendiciones</span><b>{delivered.length ? Math.round(kpis.rendidos / delivered.length * 100) : 0}% rendidos</b></div>
          <div className="closure-premium-track" role="progressbar" aria-valuenow={kpis.rendidos} aria-valuemin={0} aria-valuemax={delivered.length || 1} aria-label="Porcentaje de entregas rendidas">
            <span style={{width: `${delivered.length ? Math.round(kpis.rendidos / delivered.length * 100) : 0}%`}} />
          </div>
          <div className="closure-premium-legend"><span>🟢 {kpis.rendidos} rendidos</span><span>🟠 {kpis.noRendidos} pendientes</span></div>
        </div>
      </section>
      </div>
      <div className={closureTab === 'pedidos' ? '' : 'hidden'}>
      {canViewRendicion && delivered.length > 0 && (
        <div className="app-card !p-4 mb-4 border-l-4 border-l-[hsl(var(--primary))]">
          <h4 className="font-extrabold mb-3">📋 Control de Rendición</h4>
          {canViewNormalClosureFinancials && (
            <p className="text-xs text-muted-foreground mb-3">
              En pedidos de Equipo de Logística, la tarifa y el neto del cierre se calculan con la tarifa por ciudad del titular/líder del equipo.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="chip text-[11px]">Delivery:</span>
              <span className="text-sm font-bold">{deliveryName || (isDelivery ? profile?.name : 'Seleccionar')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="chip text-[11px]">Fecha:</span>
              <span className="text-sm">{dateFrom} a {dateTo}</span>
            </div>
            {canViewNormalClosureFinancials && (
              <div className="flex items-center gap-2">
                <span className="chip text-[11px]">Total a pagar:</span>
                <span className="text-lg font-extrabold">{nf(totalAPagar)} Gs</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="chip text-[11px]">Estado:</span>
              <span className={`badge-status ${rendicionPagada ? 'badge-entregado' : allRendered ? 'badge-entregado' : 'badge-pendiente'}`}>
                {rendicionPagada ? '💰 PAGADO' : allRendered ? '✅ RENDIDO' : '⏳ PENDIENTE'}
              </span>
            </div>
          </div>
          
          {rendicionPagada ? (
            <div className="p-3 rounded-xl border border-[#4ade80]/30 bg-[#4ade80]/10">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-extrabold text-sm text-[#4ade80] border border-[#4ade80]/30">
                  💰 PAGADO
                </span>
                <div className="text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">Pagado el:</span> {new Date(rendicionPagada.pagado_en).toLocaleString('es-PY')}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-bold text-foreground">Por:</span> {rendicionPagada.marcado_por}
                </div>
                {rendicionPagada.nota && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-bold text-foreground">Nota:</span> {rendicionPagada.nota}
                  </div>
                )}
                {canManageRendicion && (
                  <button
                    onClick={desmarcarPagado}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border border-destructive/30 text-destructive hover:bg-destructive/10 transition-all"
                  >
                    ↩ Desmarcar
                  </button>
                )}
              </div>
            </div>
          ) : (
            canManageRendicion && (
              <div className="flex flex-wrap items-center gap-3">
                <input className="app-input flex-1 min-w-[250px]" placeholder="Agregar nota (opcional)"
                  value={rendicionNote} onChange={e => setRendicionNote(e.target.value)} />
                <button
                  onClick={markRendicionPagada}
                  disabled={((selectedDeliveryList.length !== 1) && !isDelivery) || delivered.length === 0}
                  className="nav-btn active"
                >
                  ✅ MARCAR COMO PAGADO
                </button>
              </div>
            )
          )}
        </div>
      )}

      <p className="chip mb-3 text-[10px]">
        Los KPIs respetan las fechas, deliveries, proveedores y estados seleccionados.
        En <strong>ENCOMIENDA ENTREGADA</strong>, el monto del pedido no entra en
        rendición ni ganancia; solamente se paga la tarifa del delivery.
      </p>

      <div className="grid-kpi mb-4">
        {statusKpis.map(item => (
          <div className="kpi-card" key={item.status}>
            <div className="text-xs text-muted-foreground mb-1">
              {item.status}
            </div>
            <div className="text-[22px] font-extrabold">
              {item.count}
            </div>
            <div className="text-xs text-muted-foreground">
              pedido{item.count === 1 ? '' : 's'}
            </div>

            {(isAdmin || isSupplier) && item.status === 'EN RUTA' && (
              <div className="mt-2 border-t border-border pt-2 text-xs font-bold">
                Neto Gs {nf(item.totalGs)}
              </div>
            )}
          </div>
        ))}
      </div>

      {canViewNormalClosureFinancials && (
        <>
      <div className="grid-kpi mb-4">
        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">
            🚚 Pago total al delivery
          </div>
          <div className="text-[22px] font-extrabold">
            Gs {nf(settlementSummary.totalDeliveryPayment)}
          </div>
          <div className="text-xs text-muted-foreground">
            Entregados + encomiendas entregadas
          </div>
        </div>

        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">
            💵 Neto a rendir
          </div>
          <div className="text-[22px] font-extrabold">
            Gs {nf(netRendir)}
          </div>
          <div className="text-xs text-muted-foreground">
            Pedidos normales cobrados menos todas las tarifas delivery
          </div>
        </div>

        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">
            ⏳ Pendientes de rendir
          </div>
          <div
            className="text-[22px] font-extrabold"
            style={{ color: '#eab308' }}
          >
            {kpis.noRendidos}
          </div>
          <div className="text-xs text-muted-foreground">
            Neto Gs {nf(kpis.montoPendiente)}
          </div>
        </div>

        <div className="kpi-card">
          <div className="text-xs text-muted-foreground mb-1">
            ✅ Ya rendidos
          </div>
          <div
            className="text-[22px] font-extrabold"
            style={{ color: '#4ade80' }}
          >
            {kpis.rendidos}
          </div>
          <div className="text-xs text-muted-foreground">
            Neto Gs {nf(kpis.montoRendido)}
          </div>
        </div>

        {(isAdmin || isSupplier) && (
          <div className="kpi-card border border-cyan-500/30 bg-cyan-500/10">
            <div className="text-xs text-cyan-200 mb-1">
              🚚 Neto EN RUTA menos delivery
            </div>
            <div className="text-[22px] font-extrabold text-cyan-300">
              Gs {nf(enRutaFinance.netoMenosDelivery)}
            </div>
            <div className="text-xs text-muted-foreground">
              Neto Gs {nf(enRutaFinance.totalNeto)} - delivery Gs {nf(enRutaFinance.totalDelivery)}
            </div>
          </div>
        )}
      </div>

        </>
      )}

      {(isAdmin || isSupplier) && financePanel.total.orders > 0 && (
        <div className="app-card !p-4 mb-4 border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h4 className="font-extrabold text-lg">💰 Detalle de ganancias {isSupplier ? '· mis productos' : '· todos los proveedores'}</h4>
              <p className="text-xs text-muted-foreground">
                {financePanel.total.orders} pedidos entregados en los filtros actuales. Venta = comisión del vendedor + precio del proveedor + delivery cobrado al vendedor.
              </p>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">GANANCIA NETA</div>
              <div className="text-3xl font-extrabold text-emerald-400">Gs {nf(financePanel.total.gananciaNeta)}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="kpi-card border border-slate-500/20">
              <div className="text-xs text-slate-300 mb-2 font-bold">🧾 Cobrado a clientes</div>
              <div className="text-xl font-black">Gs {nf(financePanel.total.venta)}</div>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between"><span>Comisiones vendedores</span><strong className="text-amber-300">Gs {nf(financePanel.total.comisiones)}</strong></div>
                <div className="flex justify-between"><span>Precio proveedor</span><strong>Gs {nf(financePanel.total.precioProveedor)}</strong></div>
                <div className="flex justify-between"><span>Delivery cobrado al vendedor</span><strong>Gs {nf(financePanel.total.deliveryCobrado)}</strong></div>
              </div>
            </div>

            <div className="kpi-card border border-blue-500/20 bg-blue-500/10">
              <div className="text-xs text-blue-200 mb-2 font-bold">📦 Ganancia del producto</div>
              <div className="flex justify-between text-xs mb-1"><span>Precio proveedor</span><strong>Gs {nf(financePanel.total.precioProveedor)}</strong></div>
              <div className="flex justify-between text-xs mb-1"><span>Costo real del producto</span><strong className="text-red-400">- Gs {nf(financePanel.total.costoReal)}</strong></div>
              <div className="border-t border-blue-500/20 mt-2 pt-2 flex justify-between text-sm">
                <span className="font-bold">Me queda como proveedor</span>
                <strong className="text-blue-300">Gs {nf(financePanel.total.gananciaProducto)}</strong>
              </div>
              {financePanel.total.sinCosto > 0 && (
                <div className="mt-1 text-[11px] text-amber-300">⚠️ {financePanel.total.sinCosto} pedido(s) con producto sin costo real cargado</div>
              )}
            </div>

            <div className="kpi-card border border-cyan-500/20 bg-cyan-500/10">
              <div className="text-xs text-cyan-200 mb-2 font-bold">🚚 Ganancia del delivery</div>
              <div className="flex justify-between text-xs mb-1"><span>Cobrado al vendedor</span><strong>Gs {nf(financePanel.total.deliveryCobrado)}</strong></div>
              <div className="flex justify-between text-xs mb-1"><span>Pagado al delivery (tarifas e intentos)</span><strong className="text-red-400">- Gs {nf(financePanel.total.pagoDelivery)}</strong></div>
              <div className="border-t border-cyan-500/20 mt-2 pt-2 flex justify-between text-sm">
                <span className="font-bold">Me queda del delivery</span>
                <strong className="text-cyan-300">Gs {nf(financePanel.total.gananciaDelivery)}</strong>
              </div>
            </div>

            <div className="kpi-card border border-emerald-500/20 bg-emerald-500/10">
              <div className="text-xs text-emerald-200 mb-2 font-bold">💎 Ganancia neta</div>
              <div className="text-[11px] text-muted-foreground mb-2">Ganancia del producto + ganancia del delivery</div>
              <div className="text-3xl font-extrabold text-emerald-400">Gs {nf(financePanel.total.gananciaNeta)}</div>
            </div>
          </div>

          {isAdmin && financePanel.providers.length > 1 && (
            <div className="mt-4 overflow-auto rounded-xl border border-border">
              <table className="app-table min-w-[900px]">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th className="text-right">Pedidos</th>
                    <th className="text-right">Cobrado</th>
                    <th className="text-right">Comisiones</th>
                    <th className="text-right">Costo real</th>
                    <th className="text-right">Gan. producto</th>
                    <th className="text-right">Gan. delivery</th>
                    <th className="text-right">Ganancia neta</th>
                  </tr>
                </thead>
                <tbody>
                  {financePanel.providers.map(row => (
                    <tr key={row.provider}>
                      <td className="font-semibold">{suppliers.find((sp: any) => String(sp.email || '').toLowerCase() === row.provider)?.name || row.provider}</td>
                      <td className="text-right">{row.orders}</td>
                      <td className="text-right">Gs {nf(row.venta)}</td>
                      <td className="text-right text-amber-300">Gs {nf(row.comisiones)}</td>
                      <td className="text-right text-red-300">Gs {nf(row.costoReal)}</td>
                      <td className="text-right text-blue-300">Gs {nf(row.gananciaProducto)}</td>
                      <td className="text-right text-cyan-300">Gs {nf(row.gananciaDelivery)}</td>
                      <td className="text-right font-black text-emerald-300">Gs {nf(row.gananciaNeta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {canUseGuides && (
        <div className="app-card !p-3 mb-4 border border-blue-500/30 bg-blue-500/5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="nav-btn"
              onClick={toggleAllGuideSelections}
              disabled={displayedOrders.length === 0}
            >
              {displayedOrders.length > 0 && displayedOrders.every(order => selectedGuideIds.has(order.id))
                ? '☐ Deseleccionar visibles'
                : '☑ Seleccionar visibles'}
            </button>

            <button
              type="button"
              className="nav-btn"
              onClick={copySelectedGuides}
              disabled={selectedGuideOrders.length === 0}
            >
              📋 Copiar {selectedGuideOrders.length || ''} guía{selectedGuideOrders.length === 1 ? '' : 's'}
            </button>

            <button
              type="button"
              className="nav-btn active"
              onClick={downloadSelectedGuidesPdf}
              disabled={selectedGuideOrders.length === 0}
            >
              📄 Descargar PDF ({selectedGuideOrders.length})
            </button>

            {canBulkStatus && (
              <>
                <select
                  className="app-input !w-auto !py-2 text-xs"
                  value={bulkStatus}
                  onChange={event => setBulkStatus(event.target.value)}
                  disabled={bulkBusy || selectedGuideOrders.length === 0}
                >
                  {STATUS_1_OPTIONS.map(status => (
                    <option
                      key={status}
                      value={status}
                      disabled={isDelivery && status === 'DEVUELTO A DEPÓSITO'}
                    >
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="nav-btn active"
                  onClick={applyBulkStatus}
                  disabled={bulkBusy || selectedGuideOrders.length === 0}
                >
                  🔄 Cambiar estado ({selectedGuideOrders.length})
                </button>
              </>
            )}

            {canEditFull && (
              <>
                <select
                  className="app-input !w-auto !py-2 text-xs"
                  value={bulkRetiroStatus}
                  onChange={event => setBulkRetiroStatus(event.target.value)}
                  disabled={bulkBusy || selectedGuideOrders.length === 0}
                  title="Estado de retiro para selección masiva"
                >
                  {retiroOpts.filter(Boolean).map(status => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  className="nav-btn active"
                  onClick={applyBulkRetiroStatus}
                  disabled={bulkBusy || selectedGuideOrders.length === 0}
                  title="Cambiar Estado de retiro de todos los seleccionados"
                >
                  ✅ Retiro masivo ({selectedGuideOrders.length})
                </button>
              </>
            )}

            {(isDelivery || isSupplier || isAdmin) && (
              <>
                <select
                  className="app-input !w-auto !py-2 text-xs min-w-[210px]"
                  value={bulkTeamUserId}
                  onChange={event => setBulkTeamUserId(event.target.value)}
                  disabled={bulkBusy || selectedGuideOrders.length === 0}
                >
                  <option value="">Asignar a mi equipo...</option>
                  {isDelivery && (
                    <option value="SELF">Yo — {profile?.name || myEmail}</option>
                  )}
                  {acceptedTeamMembers.map(member => (
                    <option key={member.member_user_id} value={member.member_user_id}>
                      {member.member_name || member.member_email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="nav-btn active"
                  onClick={assignSelectedToTeam}
                  disabled={bulkBusy || selectedGuideOrders.length === 0 || !bulkTeamUserId}
                >
                  👥 Asignar ({selectedGuideOrders.length})
                </button>
              </>
            )}

            {canMarkSelectedAsRendido && (
              <>
                <button
                  type="button"
                  className="nav-btn active"
                  onClick={markSelectedAsRendido}
                  disabled={bulkBusy || selectedRendibleOrders.length === 0}
                  title={
                    activeSection === 'teamClosures' && isSupplier
                      ? 'En Cierres de Equipo, PROVEEDOR solo puede rendir ventas propias'
                      : 'Solo marca como RENDIDO los pedidos ENTREGADO / ENCOMIENDA ENTREGADA seleccionados'
                  }
                >
                  ✅ Marcar como RENDIDO ({selectedRendibleOrders.length})
                </button>

                <input
                  type="date"
                  className="app-input !w-auto !py-2 text-xs"
                  value={bulkAssignedDate}
                  onChange={event => setBulkAssignedDate(event.target.value)}
                  disabled={bulkBusy || selectedOrders.length === 0}
                  title="Nueva fecha de asignación para los pedidos seleccionados"
                />

                <button
                  type="button"
                  className="nav-btn active"
                  onClick={changeSelectedAssignedDate}
                  disabled={bulkBusy || selectedOrders.length === 0 || !bulkAssignedDate}
                  title="Cambiar la fecha de asignación de todos los pedidos seleccionados"
                >
                  📅 Cambiar fecha ({selectedOrders.length})
                </button>
              </>
            )}

            <span className="text-xs text-muted-foreground">
              El PDF incluye cliente, dirección, productos, total y teléfono clicable con WhatsApp.
            </span>
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="🔍 Buscar por nombre, teléfono, ID o ciudad..."
            className="app-input w-full pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
            🔍
          </span>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        {searchTerm && (
          <p className="text-xs text-muted-foreground mt-1">
            Mostrando {displayedOrders.length} de {orders.length} pedidos cargados
          </p>
        )}
      </div>

      </div>
      <div className={closureTab === 'pedidos' || closureTab === 'repetidos' ? '' : 'hidden'}>
      {closureTab === 'repetidos' && (
        <div className="closure-tab-intro"><strong>🔁 Posibles pedidos repetidos</strong><p>Coincidencias por teléfono, ciudad y día de creación: {possibleDuplicates.count} pedidos en {possibleDuplicates.groupsCount} grupos. Son alertas para revisar, no duplicados confirmados.</p></div>
      )}
      <div className="mb-4"><input className="app-input w-full" placeholder="🔎 Buscar pedido, cliente, teléfono o ciudad" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
      <div className="closure-section-heading"><span className="closure-section-number">03</span><div><h3>Listado de pedidos</h3><p>Revisá los detalles, los estados y las rendiciones</p></div></div>
      {onlyCarried && <div className="closure-duplicate-notice">📅 Mostrando sólo pedidos que llegaron a estas fechas desde otro día (por "Finalicé mi día" o reasignación). <button type="button" className="nav-btn" onClick={() => { setSelectedGuideIds(new Set()); setOnlyCarried(false); }}>Quitar filtro</button></div>}
      {onlyPossibleDuplicates && <div className="closure-duplicate-notice">🔁 Mostrando solamente coincidencias por teléfono, ciudad y día de creación. Revisá manualmente: no son duplicados confirmados. <button type="button" className="nav-btn" onClick={() => { setSelectedGuideIds(new Set()); setOnlyPossibleDuplicates(false); }}>Quitar filtro</button></div>}
      <div className="closure-premium-table overflow-auto">
        <table className="app-table min-w-[1800px]">
          <thead>
            <tr>
              {canUseGuides && <th className="text-center">✓</th>}
              <th>Fecha Asignación</th>
              <th>Fecha Creación</th>
              <th>ID</th>
              <th>Ciudad</th>
              <th>Cliente</th>
              <th>Teléfono</th>
              {canUseGuides && <th>Guía</th>}
              <th>Proveedor</th>
              <th>Productos</th>
              <th>Delivery</th>
              <th className="text-right">Total (Gs)</th>
              {canViewNormalClosureFinancials && (
                <>
                  <th className="text-right">Tarifa (Gs)</th>
                  <th className="text-right">Neto (Gs)</th>
                </>
              )}
              <th>Estado 1</th>
              <th>Estado de retiro</th>
              <th>Estado 2 (cierre)</th>
              <th>Historial</th>
              {canManageRendicion && <th></th>}
            </tr>
          </thead>
          <tbody>
            {displayedOrders.map(o => {
              const fee = getDeliveryFeeForOrder(o);
              const net = Number(o.total_gs || 0) - fee;
              const isSettled = o.delivery_settled;
              
              const getStatusBadgeClass = (status: string) => {
                if (status === 'ENTREGADO' || status === 'ENCOMIENDA ENTREGADA') return 'badge-entregado';
                if (status === 'CANCELADO' || status === 'NO CONTESTA') return 'badge-cancelado';
                if (status === 'DEVUELTO A DEPÓSITO') return 'badge-warning';
                if (status === 'REAGENDADO') return 'badge-info';
                return 'badge-pendiente';
              };
              
              return (
                <tr key={o.id} className={isSettled ? 'opacity-60' : ''}>
                  {canUseGuides && (
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={selectedGuideIds.has(o.id)}
                        onChange={() => toggleGuideSelection(o.id)}
                        aria-label={`Seleccionar pedido ${o.order_number || o.id.slice(0, 8)}`}
                      />
                    </td>
                  )}
                  <td className="text-xs whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      {o.day_seq ? <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 font-black text-sky-300" title="Número del pedido en la ruta del día">#{o.day_seq}</span> : null}
                      <span>
                        {formatDatePY(
                          activeSection === 'teamClosures'
                            ? (o.team_assigned_at || o.assigned_at)
                            : o.assigned_at,
                        )}
                      </span>
                      {isCarried(o) && (
                        <span
                          className="rounded-md bg-violet-500/15 px-1.5 py-0.5 font-bold text-violet-300"
                          title={`Primera asignación: ${formatDatePY(o.first_assigned_at)} · pasó ${o.carried_over_count || 0} vez/veces por fin de día`}
                        >
                          🔁 de {formatDatePY(o.first_assigned_at)}
                        </span>
                      )}
                      {canEditFull && editingDateId === o.id ? (
                        <input
                          type="date"
                          className="app-input !py-0 !px-1 text-xs w-auto"
                          defaultValue={dateInputValue(
                            activeSection === 'teamClosures'
                              ? (o.team_assigned_at || o.assigned_at)
                              : o.assigned_at,
                          )}
                          onChange={(e) => handleDateChange(o.id, e.target.value)}
                          onBlur={() => setEditingDateId(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditingDateId(null);
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        canEditFull && (
                          <button
                            onClick={() => setEditingDateId(o.id)}
                            className="text-xs opacity-60 hover:opacity-100 transition-opacity"
                            title="Cambiar fecha"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                          >
                            📅
                          </button>
                        )
                      )}
                    </div>
                   </td>
                  <td className="text-xs whitespace-nowrap">
                    {formatDatePY(o.created_at)}
                   </td>
                  <td className="text-xs font-bold">{o.order_number || o.id.slice(0, 8)}</td>
                  <td className="text-xs">
                    {canEditFull ? (
                      <select
                        className="app-input !w-auto !py-1 !px-2 text-xs min-w-[160px]"
                        value={o.city || ''}
                        onChange={e => updateOrderCity(o.id, e.target.value)}
                      >
                        <option value="">Seleccionar ciudad</option>
                        {clientPrices.map((cp: any) => (
                          <option key={cp.city} value={cp.city}>{cp.city}</option>
                        ))}
                        {o.city && !clientPrices.some((cp: any) => cp.city === o.city) && (
                          <option value={o.city}>{o.city}</option>
                        )}
                      </select>
                    ) : (
                      <span>{o.city || '—'}</span>
                    )}
                  </td>
                  <td className="text-xs">{o.customer_name}</td>
                  <td className="text-xs">
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      {getOrderPhone(o) ? (
                        <a
                          href={getWhatsAppUrl(o)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-bold text-green-600 hover:underline"
                          title="Abrir WhatsApp con mensaje y guía"
                        >
                          📱 {getOrderPhone(o)}
                        </a>
                      ) : (
                        <span>—</span>
                      )}

                      {canMarkContacted && getOrderPhone(o) && (
                        <button
                          type="button"
                          onClick={() => toggleContacted(o)}
                          disabled={updatingContactedIds.has(o.id)}
                          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                            o.contacted
                              ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                              : 'border-border bg-background text-muted-foreground hover:border-green-500 hover:text-green-600'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                          title={
                            o.contacted
                              ? `Contactado${o.contacted_by ? ` por ${o.contacted_by}` : ''}${o.contacted_at ? ` el ${new Date(o.contacted_at).toLocaleString('es-PY')}` : ''}. Clic para desmarcar.`
                              : 'Marcar que el cliente ya fue contactado'
                          }
                        >
                          {updatingContactedIds.has(o.id)
                            ? '…'
                            : o.contacted
                              ? '✓ Contactado'
                              : '✓ Contactar'}
                        </button>
                      )}
                    </div>
                  </td>
                  {canUseGuides && (
                    <td>
                      <button
                        type="button"
                        className="nav-btn !py-1 !px-2 text-[11px]"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(buildGuideText(o));
                            toast.success('Guía copiada');
                          } catch {
                            toast.error('No se pudo copiar la guía');
                          }
                        }}
                        title="Copiar guía completa"
                      >
                        📋 Copiar
                      </button>
                    </td>
                  )}
                  <td className="text-xs">{o.provider_email || '—'}</td>
                  <td className="text-xs min-w-[240px]">
                    {(() => {
                      const items = getOrderItems(o);

                      if (items.length === 0) {
                        return <span className="text-muted-foreground">Sin detalle de productos</span>;
                      }

                      return (
                        <div className="flex flex-col gap-1">
                          {items.map((item: any, index: number) => {
                            const productName =
                              item.title ||
                              item.name ||
                              item.product_name ||
                              item.sku ||
                              'Producto';

                            const quantity = Number(item.quantity ?? item.qty ?? 1);

                            return (
                              <div key={`${o.id}-product-${index}`} className="leading-tight">
                                <span className="font-bold">{productName}</span>
                                {quantity > 1 && (
                                  <span className="ml-1 text-muted-foreground">
                                    × {quantity}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="text-xs">
                    <div>
                      {canEditFull ? (
                        <select
                          className="app-input !w-auto !py-1 !px-2 text-xs min-w-[220px]"
                          value={o.assigned_delivery || ''}
                          onChange={e => updateAssignedDelivery(o.id, e.target.value)}
                        >
                          <option value="">Seleccionar delivery</option>
                          {deliveries.map((d: any) => (
                            <option key={d.email} value={d.email}>
                              {d.name || d.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="font-bold">
                          {(() => {
                            const found = deliveries.find(
                              (d: any) => d.email === o.assigned_delivery,
                            );
                            return found?.name || o.assigned_delivery || '—';
                          })()}
                        </div>
                      )}

                      {activeSection === 'orders' &&
                        o.delivery_owner &&
                        String(o.delivery_owner).trim().toLowerCase() !==
                          String(o.assigned_delivery || '').trim().toLowerCase() && (
                          <div className="mt-1 inline-flex items-center rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-bold text-violet-300">
                            👥 Miembro del equipo de: {getOrderTeamLeaderLabel(o)}
                          </div>
                        )}
                    </div>
                  </td>
                  <td className="text-right text-xs font-bold">{nf(Number(o.total_gs || 0))}</td>
                  {canViewNormalClosureFinancials && (
                    <>
                      <td
                        className="text-right text-xs"
                        title={
                          activeSection === 'teamClosures'
                            ? `Tarifa del delivery: ${o.assigned_delivery || '—'}`
                            : o.delivery_owner &&
                                String(o.delivery_owner).toLowerCase() !==
                                  String(o.assigned_delivery || '').toLowerCase()
                              ? `Tarifa del líder: ${o.delivery_owner}`
                              : `Tarifa del delivery: ${o.assigned_delivery || '—'}`
                        }
                      >
                        {nf(fee)}
                      </td>
                      <td className="text-right text-xs">{nf(net)}</td>
                    </>
                  )}
                  <td>
                    {canEditStatus1 ? (
                      <select 
                        className="app-input !w-auto !py-1 !px-2 text-xs"
                        value={o.status || 'PENDIENTE'}
                        onChange={e => updateStatus1(o.id, e.target.value)}
                        disabled={isVendedor}
                      >
                        {STATUS_1_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={`badge-status ${getStatusBadgeClass(o.status)}`}>{o.status}</span>
                    )}
                  </td>
                  <td>
                    {canEditFull ? (
                      <select className="app-input !w-auto !py-1 !px-2 text-xs" value={o.estado_retiro || ''}
                        onChange={e => updateRetiro(o.id, e.target.value)}>
                        {retiroOpts.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                      </select>
                    ) : <span className="text-xs">{o.estado_retiro || '—'}</span>}
                  </td>
                  <td>
                    {canEditFull ? (
                      <select className="app-input !w-auto !py-1 !px-2 text-xs" value={o.status2 || '--'}
                        onChange={e => updateStatus2(o.id, e.target.value)}>
                        {state2Opts.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : <span className="text-xs">{o.status2 || '—'}</span>}
                  </td>
                  <td>
                    <button
                      onClick={() => loadOrderHistory(o)}
                      className="nav-btn !py-1 !px-2 text-[11px] !bg-blue-600/20 hover:!bg-blue-600/40 text-blue-700"
                      title="Ver historial"
                    >
                      📜 Historial
                    </button>
                  </td>
                  {canManageRendicion && (
                    <td>
                      <div className="flex items-center gap-1">
                        {!isSettled && (o.status === 'ENTREGADO' || o.status === 'ENCOMIENDA ENTREGADA') && (
                          <button
                            onClick={() => markSingleRendido(o.id)}
                            className="nav-btn active !py-1 !px-2 text-[11px]"
                          >
                            RENDIDO
                          </button>
                        )}
                        {isSettled && (
                          <span className="text-xs font-bold" style={{ color: '#4ade80' }}>RENDIDO</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {displayedOrders.length === 0 && (
              <tr>
                <td colSpan={(canManageRendicion ? 16 : 15) + (canUseGuides ? 2 : 0)} className="text-center text-muted-foreground py-8">
                  {searchTerm ? 'No se encontraron resultados para tu búsqueda' : 'Sin resultados en este período'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      </div>
      </div>

      {/* Modal para solicitar comentario y captura */}
      <StatusChangeModal
        isOpen={statusChangeModal.isOpen}
        onClose={() => setStatusChangeModal({ isOpen: false, orderIds: [], newStatus: '' })}
        onConfirm={processStatusChangeWithData}
        newStatus={statusChangeModal.newStatus}
        uploading={uploadingFile}
        orderCount={statusChangeModal.orderIds.length}
      />

      {/* Modal de historial */}
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
