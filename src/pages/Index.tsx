import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLayoutMode } from '@/hooks/useLayoutMode';

import AppHeader from '@/components/AppHeader';
import { AppNav, type ViewName } from '@/components/AppNav';
import AuthView from '@/components/AuthView';

// Cada pantalla se descarga recién cuando se abre (la app inicial pesa mucho menos).
const DashboardView = lazy(() => import('@/components/DashboardView'));
const OrdersView = lazy(() => import('@/components/OrdersView'));
const NewsView = lazy(() => import('@/components/NewsView'));
const ProductsView = lazy(() => import('@/components/ProductsView'));
const ProfileView = lazy(() => import('@/components/ProfileView'));
const UsersView = lazy(() => import('@/components/UsersView'));
const CreateOrderView = lazy(() => import('@/components/CreateOrderView'));
const RatesView = lazy(() => import('@/components/RatesView'));
const CommissionsView = lazy(() => import('@/components/CommissionsView'));
const CommissionRequestsView = lazy(() => import('@/components/CommissionRequestsView'));
const ClosuresView = lazy(() => import('@/components/ClosuresView'));
const EarningsView = lazy(() => import('@/components/EarningsView'));
const ChatView = lazy(() => import('@/components/ChatView'));
const AssignOrdersView = lazy(() => import('@/components/AssignOrdersView'));
const RankingDeliveryView = lazy(() => import('@/components/RankingDeliveryView'));
const RendicionesPagadasView = lazy(() => import('@/components/RendicionesPagadasView'));
const WithGuidesView = lazy(() => import('@/components/WithGuidesView'));
const CounterView = lazy(() => import('@/components/CounterView'));
const MapView = lazy(() => import('@/components/MapView'));
const ShopifyInboxView = lazy(() => import('@/components/ShopifyInboxView'));
const ShopifyConnectionView = lazy(() => import('@/components/ShopifyConnectionView'));
const QRScannerView = lazy(() => import('@/components/QRScannerView'));
const StoreView = lazy(() => import('@/components/StoreView'));
const BotSkyImportBridge = lazy(() => import('@/components/BotSkyImportBridge'));
const TrackingPage = lazy(() => import('@/components/TrackingPage'));
const RoutePage = lazy(() => import('@/components/RoutePage'));
const LiveLocationSharer = lazy(() => import('@/components/LiveLocationSharer'));
const LocationDialogHost = lazy(() => import('@/components/LocationDialog'));
const StoreOrderTabBridge = lazy(() =>
  import('@/components/StoreOrdersView').then((m) => ({ default: m.StoreOrderTabBridge }))
);

function ViewFallback() {
  return (
    <div className="space-y-3 py-2" aria-busy="true">
      <div className="h-24 rounded-2xl bg-secondary/40 animate-pulse" />
      <div className="h-64 rounded-2xl bg-secondary/30 animate-pulse" />
    </div>
  );
}


// NUEVO: receptor de pedidos BOT SKY

export interface SheetPrefill {
  customer?: string;
  phone?: string;
  city?: string;
  street?: string;
  district?: string;
  email?: string;
  productTitle?: string;
  totalGs?: number;
  qty?: number;
  obs?: string;
}

function isBotSkyImportLink() {
  const params = new URLSearchParams(window.location.search);

  return params.get('view') === 'import-botsky';
}

function isCreateOrderLink() {
  const params = new URLSearchParams(window.location.search);

  return (
    params.get('view') === 'create-order' ||
    Boolean(
      params.get('store_order_ids') ||
      params.get('store_order_id')
    )
  );
}

function hasStoreOrderParams() {
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('store_order_ids') || params.get('store_order_id'));
}

const NOTIFICATION_VIEWS = ['chat', 'store', 'orders', 'products', 'profile'];

function isSpecialOrderLink() {
  return isBotSkyImportLink() || isCreateOrderLink();
}

export default function Index() {
  const {
    user,
    profile,
    loading,
    signOut,
    refreshProfile,
  } = useAuth();

  const { mode: layoutMode, setMode: setLayoutMode, effective: layout } = useLayoutMode();

  const [currentView, setCurrentView] = useState<ViewName>(
    () => (isCreateOrderLink() ? 'order' : 'auth')
  );

  const [lastUpdate, setLastUpdate] = useState(
    () => new Date().toLocaleString('es-PY')
  );

  const [preSelectedSku, setPreSelectedSku] =
    useState<string | null>(null);

  const [sheetPrefill, setSheetPrefill] =
    useState<SheetPrefill | null>(null);

  useEffect(() => {
    if (!user || !profile) return;

    // BOT SKY tiene su propia pantalla de importación.
    if (isBotSkyImportLink()) {
      return;
    }

    if (isCreateOrderLink()) {
      setCurrentView('order');
      return;
    }

    if (currentView === 'auth') {
      // Enlace desde una notificación push (?go=chat, ?go=store, ...).
      const go = new URLSearchParams(window.location.search).get('go');
      if (go && NOTIFICATION_VIEWS.includes(go)) {
        const url = new URL(window.location.href);
        url.searchParams.delete('go');
        window.history.replaceState(null, '', url.toString());
        setCurrentView(go as ViewName);
        return;
      }

      const defaultView =
        profile.role === 'DESPACHANTE' ||
        profile.role === 'DELIVERY'
          ? 'orders'
          : 'dashboard';

      setCurrentView(defaultView as ViewName);
    }
  }, [user, profile, currentView]);

  const handleLoadProduct = (sku: string) => {
    setPreSelectedSku(sku);
    setSheetPrefill(null);
    setCurrentView('order');
  };

  const handleSheetConfirm = useCallback(
    (prefill: SheetPrefill) => {
      setPreSelectedSku(null);
      setSheetPrefill(prefill);
      setCurrentView('order');
    },
    []
  );

  const handleAuthSuccess = () => {
    setCurrentView(
      isCreateOrderLink() ? 'order' : 'dashboard'
    );
  };

  const handleRefresh = () => {
    setLastUpdate(
      new Date().toLocaleString('es-PY')
    );
  };

  // ==========================================
  // CARGANDO SESIÓN
  // ==========================================

  // Página pública de seguimiento para el cliente (no requiere sesión).
  const trackingToken = new URLSearchParams(window.location.search).get('seguimiento');
  const routeToken = new URLSearchParams(window.location.search).get('ruta');
  if (routeToken) {
    return (
      <Suspense fallback={<ViewFallback />}>
        <RoutePage token={routeToken} />
      </Suspense>
    );
  }
  if (trackingToken) {
    return (
      <Suspense fallback={<ViewFallback />}>
        <TrackingPage token={trackingToken} />
      </Suspense>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3">
          <span className="btn-spinner !h-6 !w-6 !border-brand !border-t-brand-glow" />
          <span className="text-muted-foreground">
            Cargando...
          </span>
        </div>
      </div>
    );
  }

  // ==========================================
  // INICIO DE SESIÓN
  // ==========================================

  if (!user || !profile) {
    if (isSpecialOrderLink()) {
      localStorage.setItem(
        'pending_order_url',
        window.location.href
      );
    }

    return <AuthView onSuccess={handleAuthSuccess} />;
  }

  // ==========================================
  // CUENTA PENDIENTE DE APROBACIÓN
  // ==========================================

  if (!profile.approved) {
    return (
      <div className="mx-auto max-w-full px-6 py-5">
        <AppHeader
          onRefresh={handleRefresh}
          lastUpdate={lastUpdate}
        />

        <div className="app-card py-12 text-center">
          <h3 className="mb-3 text-xl font-extrabold">
            Cuenta pendiente de aprobación
          </h3>

          <p className="mb-2 text-muted-foreground">
            Tu cuenta fue creada exitosamente pero necesita
            ser aprobada por un administrador.
          </p>

          <p className="mb-4 text-sm text-muted-foreground">
            Una vez aprobada, podrás acceder al sistema
            con tu rol asignado.
          </p>

          <p className="mb-6 text-sm">
            Favor pasar correo y contraseña creada al{' '}
            <a
              href="https://wa.me/595974278352"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-[#25D366] hover:underline"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-current"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              0974 278 352
            </a>
          </p>

          <div className="flex justify-center gap-2">
            <button
              className="nav-btn"
              onClick={() => {
                refreshProfile();
                handleRefresh();
              }}
            >
              Verificar estado
            </button>

            <button
              className="nav-btn"
              onClick={signOut}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // NUEVO: PANTALLA EXCLUSIVA BOT SKY
  // ==========================================

  if (isBotSkyImportLink()) {
    return (
      <div className="min-h-screen bg-background px-4 py-8">
        <div className="mx-auto max-w-3xl space-y-4">

          <div className="rounded-xl border bg-card p-5">
            <h1 className="text-xl font-bold">
              📦 Importación de pedidos BOT SKY
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Sesión iniciada correctamente.
              Conectando con BOT SKY para recibir
              los pedidos seleccionados.
            </p>
          </div>

          <Suspense fallback={<ViewFallback />}>
            <BotSkyImportBridge />
          </Suspense>

        </div>
      </div>
    );
  }

  // ==========================================
  // SECCIONES ORIGINALES
  // ==========================================

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;

      case 'orders':
        return <OrdersView />;

      case 'news':
        return <NewsView />;

      case 'products':
        return (
          <ProductsView
            onLoadProduct={handleLoadProduct}
          />
        );

      case 'store':
        return (
          <StoreView
            onLoadOrder={handleSheetConfirm}
          />
        );

      case 'profile':
        return <ProfileView />;

      case 'users':
        return <UsersView />;

      case 'order':
        return (
          <CreateOrderView
            initialSku={preSelectedSku}
            onSkuConsumed={() =>
              setPreSelectedSku(null)
            }
            sheetPrefill={sheetPrefill}
            onPrefillConsumed={() =>
              setSheetPrefill(null)
            }
          />
        );

      case 'rates':
        return <RatesView />;

      case 'commissions':
        return <CommissionsView />;

      case 'commissionRequests':
        return <CommissionRequestsView />;

      case 'closures':
        return <ClosuresView />;

      case 'earnings':
        return <EarningsView />;

      case 'chat':
        return <ChatView />;

      case 'assignOrders':
        return <AssignOrdersView />;

      case 'rankingDelivery':
        return <RankingDeliveryView />;

      case 'rendicionesPagadas':
        return <RendicionesPagadasView />;

      case 'withGuides':
        return <WithGuidesView />;

      case 'counter':
        return <CounterView />;

      case 'mapa':
        return <MapView />;

      case 'shopifyInbox':
        return (
          <ShopifyInboxView
            onSheetConfirm={handleSheetConfirm}
          />
        );

      case 'shopifyConnection':
        return <ShopifyConnectionView />;

      case 'qrScanner':
        return <QRScannerView />;

      default:
        return <DashboardView />;
    }
  };

  // ==========================================
  // APLICACIÓN NORMAL
  // ==========================================

  const pagePadding =
    layout === 'mobile' ? 'px-3 py-3' : layout === 'tablet' ? 'px-4 py-4' : 'px-6 py-5';

  return (
    <div className={`mx-auto max-w-full ${pagePadding}`}>

      <AppHeader
        onRefresh={handleRefresh}
        lastUpdate={lastUpdate}
        layout={layout}
        mode={layoutMode}
        onModeChange={setLayoutMode}
      />

      <AppNav
        currentView={currentView}
        onNavigate={(view) => {
          setCurrentView(view);
          window.scrollTo({ top: 0 });
        }}
        layout={layout}
      />

      {/* Integración original de la tienda (sólo se descarga si hay pedidos en la URL) */}
      {hasStoreOrderParams() && (
        <Suspense fallback={null}>
          <StoreOrderTabBridge
            onLoadOrder={handleSheetConfirm}
          />
        </Suspense>
      )}

      {/* Comparte la ubicación mientras haya links de seguimiento activos a su nombre
          (el delivery, o admin / proveedor que eligieron ser la 🛵) */}
      {['DELIVERY', 'ADMIN', 'PROVEEDOR'].includes(String(profile.role || '')) && (
        <Suspense fallback={null}>
          <LiveLocationSharer />
        </Suspense>
      )}

      {/* Diálogo para cargar / cambiar / borrar la ubicación del cliente */}
      <Suspense fallback={null}>
        <LocationDialogHost />
      </Suspense>

      {/* Todas las secciones originales */}
      <Suspense fallback={<ViewFallback />}>
        {renderView()}
      </Suspense>

    </div>
  );
}
