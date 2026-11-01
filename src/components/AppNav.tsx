import { useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import type { EffectiveLayout } from '@/hooks/useLayoutMode';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export type ViewName =
  | 'auth'
  | 'dashboard'
  | 'news'
  | 'chat'
  | 'products'
  | 'store'
  | 'earnings'
  | 'order'
  | 'orders'
  | 'rates'
  | 'commissions'
  | 'commissionRequests'
  | 'counter'
  | 'closures'
  | 'rendicionesPagadas'
  | 'profile'
  | 'users'
  | 'assignOrders'
  | 'rankingDelivery'
  | 'withGuides'
  | 'shopifyInbox'
  | 'shopifyConnection'
  | 'mapa'
  | 'qrScanner';

interface NavItem {
  id: ViewName;
  label: string;
  roles?: string[];
  excludeRoles?: string[];
}

const navItems: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    excludeRoles: ['DESPACHANTE', 'DELIVERY'],
  },
  { id: 'news', label: 'Novedades' },
  { id: 'chat', label: 'Chat' },
  {
    id: 'withGuides',
    label: 'Pedidos con guías',
    roles: ['ADMIN', 'DESPACHANTE', 'PROVEEDOR'],
  },
  {
    id: 'rankingDelivery',
    label: '🏆 Ranking Delivery',
    roles: ['ADMIN', 'DESPACHANTE', 'PROVEEDOR', 'DELIVERY'],
  },
  {
    id: 'products',
    label: 'Productos',
    roles: ['ADMIN', 'PROVEEDOR', 'DELIVERY', 'VENDEDOR', 'DESPACHANTE'],
  },

  // ✅ NUEVO
  {
    id: 'store',
    label: '🛍 Mi Tienda',
    roles: ['ADMIN', 'VENDEDOR'],
  },

  {
    id: 'earnings',
    label: 'Ganancias',
    roles: ['ADMIN', 'PROVEEDOR'],
  },
  {
    id: 'order',
    label: 'Cargar pedido',
    roles: ['VENDEDOR'],
  },
  { id: 'orders', label: 'Pedidos' },
  {
    id: 'shopifyInbox',
    label: 'Pedidos Shopify',
    roles: ['ADMIN', 'VENDEDOR'],
  },
  {
    id: 'shopifyConnection',
    label: '🔗 Conexión Shopify',
    roles: ['ADMIN'],
  },
  {
    id: 'assignOrders',
    label: 'Asignar Pedidos',
    roles: ['ADMIN', 'PROVEEDOR', 'DELIVERY'],
  },
  {
    id: 'mapa',
    label: 'Mapa',
    roles: ['ADMIN', 'PROVEEDOR', 'DELIVERY'],
  },
  {
    id: 'qrScanner',
    label: '📷 QR Delivery',
    roles: ['ADMIN', 'PROVEEDOR', 'DELIVERY'],
  },
  {
    id: 'rates',
    label: 'Costos delivery',
    excludeRoles: ['DESPACHANTE', 'DELIVERY', 'VENDEDOR'],
  },
  {
    id: 'commissions',
    label: 'Pago de comisiones',
    roles: ['ADMIN', 'PROVEEDOR', 'VENDEDOR'],
  },
  {
    id: 'commissionRequests',
    label: 'Solicitud de comisiones',
    roles: ['ADMIN', 'PROVEEDOR', 'VENDEDOR'],
  },
  {
    id: 'counter',
    label: 'Actualizar contador',
    roles: ['ADMIN'],
  },
  {
    id: 'closures',
    label: 'Cierres',
    roles: ['ADMIN', 'PROVEEDOR', 'DELIVERY'],
  },
  {
    id: 'rendicionesPagadas',
    label: 'Rendiciones pagadas',
    roles: ['ADMIN', 'PROVEEDOR'],
  },
  {
    id: 'profile',
    label: 'Perfil',
    excludeRoles: ['DESPACHANTE'],
  },
  {
    id: 'users',
    label: '👥 Usuarios',
    roles: ['ADMIN'],
  },
];

interface AppNavProps {
  currentView: ViewName;
  onNavigate: (view: ViewName) => void;
  layout?: EffectiveLayout;
}

/**
 * Export nombrado + export default.
 * Así funciona tanto:
 * import AppNav from ...
 * como:
 * import { AppNav } from ...
 */
export function AppNav({
  currentView,
  onNavigate,
  layout = 'pc',
}: AppNavProps) {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const [menuOpen, setMenuOpen] = useState(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const visibleItems = navItems.filter((item) => {
    if (item.roles && !item.roles.includes(role)) return false;
    if (item.excludeRoles && item.excludeRoles.includes(role)) return false;
    return true;
  });

  const current = visibleItems.find((item) => item.id === currentView);

  // Tablet: la sección activa siempre queda a la vista en la fila deslizable.
  useEffect(() => {
    if (layout === 'tablet') activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [layout, currentView]);

  // CELULAR: barra con la sección actual y panel lateral con todas las secciones.
  if (layout === 'mobile') {
    return (
      <>
        <div className="sticky top-0 z-30 -mx-3 mb-3 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <button
            type="button"
            className="nav-btn inline-flex items-center gap-2 !px-3 !py-2"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
            Menú
          </button>
          <span className="min-w-0 truncate text-sm font-extrabold">{current?.label || ''}</span>
          {role && <span className="chip ml-auto shrink-0 !px-2 !py-1 !text-[10px]">{role}</span>}
        </div>

        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="w-[86vw] max-w-sm overflow-y-auto p-4">
            <SheetHeader className="mb-3 text-left">
              <SheetTitle>DCANP GROUP</SheetTitle>
              <p className="truncate text-xs text-muted-foreground">
                {profile?.email} · {role}
              </p>
            </SheetHeader>
            <div className="grid grid-cols-2 gap-1.5">
              {visibleItems.map((item) => (
                <button
                  key={item.id}
                  className={`nav-btn w-full !py-3 text-left !text-[13px] leading-tight ${currentView === item.id ? 'active' : ''}`}
                  onClick={() => {
                    onNavigate(item.id);
                    setMenuOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // TABLET: una sola fila que se desliza con el dedo.
  if (layout === 'tablet') {
    return (
      <nav className="-mx-4 mb-3 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleItems.map((item) => (
          <button
            key={item.id}
            ref={currentView === item.id ? activeRef : undefined}
            className={`nav-btn shrink-0 whitespace-nowrap ${currentView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
        {role && <span className="chip shrink-0">{role}</span>}
      </nav>
    );
  }

  // PC: todas las secciones a la vista.
  return (
    <nav className="mb-3 flex flex-wrap items-center gap-2">
      {visibleItems.map((item) => (
        <button
          key={item.id}
          className={`nav-btn ${currentView === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}

      {role && <span className="chip">{role}</span>}
    </nav>
  );
}

export default AppNav;
