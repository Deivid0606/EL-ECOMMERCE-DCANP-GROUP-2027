import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

const nf = (n: number) => new Intl.NumberFormat('es-PY').format(n);

export default function QRScannerView() {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const userEmail = profile?.email || '';

  const [orderData, setOrderData] = useState<any>(null);
  const [deliveryUsers, setDeliveryUsers] = useState<any[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [idFromUrl, setIdFromUrl] = useState<string | null>(null);

  useEffect(() => {
    console.log('=== QRScannerView CARGADO ===');
    console.log('URL completa:', window.location.href);
    console.log('Hash:', window.location.hash);

    const hash = window.location.hash;
    const match = hash.match(/[?&]id=([^&]+)/);

    if (match && match[1]) {
      const orderId = decodeURIComponent(match[1])
        .trim()
        .replace(/\s+/g, '');
      console.log('✅ ID encontrado en URL:', orderId);
      setIdFromUrl(orderId);
      loadOrderByNumber(orderId);
    } else {
      console.log('❌ No se encontró ID en la URL');
      setError('No se encontró número de pedido en el QR. Asegúrate de escanear el QR de Delivery.');
    }
  }, []);

  const loadOrderByNumber = async (orderNumber: string) => {
    setLoading(true);
    setError('');

    const cleanOrderNumber = decodeURIComponent(orderNumber || '')
      .trim()
      .replace(/\s+/g, '');

    console.log('🔍 QR ORIGINAL:', orderNumber);
    console.log('🔍 QR LIMPIO:', cleanOrderNumber);

    try {
      let foundOrder = null;

      const exact = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', cleanOrderNumber)
        .maybeSingle();

      if (exact.data) {
        foundOrder = exact.data;
      }

      if (!foundOrder) {
        const insensitive = await supabase
          .from('orders')
          .select('*')
          .ilike('order_number', cleanOrderNumber)
          .maybeSingle();

        if (insensitive.data) {
          foundOrder = insensitive.data;
        }
      }

      if (!foundOrder) {
        setError(`Pedido ${cleanOrderNumber} no encontrado`);
        return;
      }

      console.log('✅ Pedido encontrado:', foundOrder);
      setOrderData(foundOrder);

    } catch (err) {
      console.error(err);
      setError('Error al cargar el pedido');
    } finally {
      setLoading(false);
    }
  };

  const loadDeliveryUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('role', 'DELIVERY')
      .eq('approved', true)
      .eq('active', true);

    if (!error && data) {
      setDeliveryUsers(data || []);
    }
  };

  const assignOrder = async () => {
    if (!orderData) return;

    console.log('📦 Asignando pedido:', orderData.order_number);

    if (role === 'DELIVERY') {
      const { error } = await supabase
        .from('orders')
        .update({
          assigned_delivery: userEmail,
          assigned_at: new Date().toISOString(),
          status: 'EN RUTA',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderData.id);

      if (error) {
        console.error('❌ Error al asignar:', error);
        toast.error('Error al asignar pedido');
      } else {
        console.log('✅ Pedido asignado exitosamente');
        toast.success('✅ Pedido asignado y Estado 1 cambiado a EN RUTA');
        setTimeout(() => {
          window.location.href = '#/cierres';
        }, 1500);
      }
    } else if (role === 'ADMIN' || role === 'PROVEEDOR') {
      if (!selectedDelivery) {
        toast.error('Selecciona un repartidor');
        return;
      }

      const { error } = await supabase
        .from('orders')
        .update({
          assigned_delivery: selectedDelivery,
          assigned_at: new Date().toISOString(),
          status: 'EN RUTA',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderData.id);

      if (error) {
        console.error('❌ Error al asignar:', error);
        toast.error('Error al asignar pedido');
      } else {
        console.log('✅ Pedido asignado exitosamente a:', selectedDelivery);
        toast.success(`✅ Pedido asignado a ${selectedDelivery} y Estado 1 cambiado a EN RUTA`);
        setTimeout(() => {
          window.location.href = '#/cierres';
        }, 1500);
      }
    }
  };

  useEffect(() => {
    if (role === 'ADMIN' || role === 'PROVEEDOR') {
      loadDeliveryUsers();
    }
  }, [role]);

  const renderGuideDetails = (order: any) => {
    const items =
      typeof order.items_json === 'string'
        ? JSON.parse(order.items_json || '[]')
        : order.items_json || [];

    return (
      <div className="space-y-3">
        <div className="border-b pb-2">
          <h3 className="font-bold text-xl">📋 GUÍA DE ENVÍO — {order.order_number}</h3>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <p><span className="font-semibold">Cliente:</span> {order.customer_name}</p>
          <p><span className="font-semibold">Teléfono:</span> {order.phone}</p>
          <p><span className="font-semibold">Email:</span> {order.email || '—'}</p>
          <p><span className="font-semibold">Departamento:</span> {order.departamento || '—'}</p>
          <p><span className="font-semibold">Ciudad:</span> {order.city || '—'}</p>
          <p>
            <span className="font-semibold">Dirección:</span> {order.street || ''}{' '}
            {order.district ? `- ${order.district}` : ''}
          </p>
        </div>

        <div className="border-t pt-2">
          <p className="font-semibold">📦 Productos:</p>
          {items.map((item: any, idx: number) => (
            <p key={idx} className="text-sm pl-2">
              {idx + 1}. {item.title || item.sku} x{item.qty} — Gs{' '}
              {nf(Number(item.sale_gs || 0) * Number(item.qty || 1))}
            </p>
          ))}
        </div>

        <div className="border-t pt-2">
          <p className="font-semibold">💰 Total: Gs {nf(Number(order.total_gs || 0))}</p>
        </div>

        <div className="border-t pt-2 text-sm">
          <p><span className="font-semibold">👤 Vendedor:</span> {order.created_by || '—'}</p>
          <p>
            <span className="font-semibold">🏢 Proveedor:</span>{' '}
            {order.provider_emails_list || order.provider_email || '—'}
          </p>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
          <p className="mt-2 text-gray-500">Cargando pedido...</p>
        </div>
      </div>
    );
  }

  if (error && !orderData) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-6 text-center">
            <div className="text-red-500 text-6xl mb-4">❌</div>
            <h2 className="text-xl font-bold mb-2">Error</h2>
            <p className="text-gray-600 mb-4">{error}</p>
            <p className="text-sm text-gray-500 mb-4">
              ID detectado: {idFromUrl || 'ninguno'}
            </p>
            <button
              className="bg-purple-500 text-white px-4 py-2 rounded-lg"
              onClick={() => window.location.href = '#/pedidos'}
            >
              Volver a Pedidos
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (orderData) {
    return (
      <div className="min-h-screen bg-gray-100 p-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold text-center mb-6">🚚 Asignar Pedido</h2>

            <div className="border-2 border-purple-300 rounded-lg p-4 bg-purple-50">
              {renderGuideDetails(orderData)}

              <div className="mt-4">
                {role === 'DELIVERY' ? (
                  <button
                    className="w-full bg-green-500 text-white py-3 rounded-lg font-bold hover:bg-green-600 transition"
                    onClick={assignOrder}
                  >
                    ✅ Asignarme este pedido
                  </button>
                ) : (role === 'ADMIN' || role === 'PROVEEDOR') && (
                  <>
                    <select
                      className="w-full p-2 border rounded-lg mb-2"
                      value={selectedDelivery}
                      onChange={(e) => setSelectedDelivery(e.target.value)}
                    >
                      <option value="">Seleccionar repartidor...</option>
                      {deliveryUsers.map(user => (
                        <option key={user.email} value={user.email}>
                          {user.full_name || user.email}
                        </option>
                      ))}
                    </select>

                    <button
                      className="w-full bg-green-500 text-white py-3 rounded-lg font-bold hover:bg-green-600 transition"
                      onClick={assignOrder}
                    >
                      🚚 Asignar pedido
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500">Inicializando...</p>
      </div>
    </div>
  );
}
