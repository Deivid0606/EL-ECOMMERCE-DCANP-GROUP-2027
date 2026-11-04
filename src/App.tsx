import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  HashRouter,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ProviderScopeProvider } from "@/lib/providerScope";
import NewPasswordModal from "./components/NewPasswordModal.tsx";
import ViewErrorBoundary from "./components/ViewErrorBoundary.tsx";

import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";

import AssignOrdersView from "./components/AssignOrdersView.tsx";
import QRScannerView from "./components/QRScannerView.tsx";
import ProductsView from "./components/ProductsView.tsx";
import PublicLandingPage from "./components/PublicLandingPage.tsx";

const queryClient = new QueryClient();

/**
 * Corrige URLs abiertas desde scanners QR externos en Android
 * para que funcionen con HashRouter.
 */
const normalizeExternalQRUrl = () => {
  const { pathname, search, hash } = window.location;

  if (
    !hash &&
    pathname.includes("/asignar-pedidos") &&
    search.includes("id=")
  ) {
    window.location.replace(
      `${window.location.origin}/#/asignar-pedidos${search}`,
    );
    return;
  }

  if (!hash && pathname.includes("/qr") && search.includes("id=")) {
    window.location.replace(
      `${window.location.origin}/#/asignar-pedidos${search}`,
    );
  }
};

normalizeExternalQRUrl();

function PublicLandingRoute() {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) {
    return <NotFound />;
  }

  return <PublicLandingPage slug={slug} />;
}

function PreviewLandingRoute() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <NotFound />;
  }

  return <PublicLandingPage pageId={id} preview />;
}

// Las rutas QR / productos son accesibles por URL directa. No pueden montar
// componentes que consultan datos hasta verificar aprobación vigente.
function PrivateRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading, signOut } = useAuth();
  if (loading) return <div className="p-6 text-sm">Verificando acceso…</div>;
  if (!user) return <div className="p-6 text-sm">Iniciá sesión para continuar.</div>;
  if (!profile || !profile.approved) {
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <h2 className="text-xl font-bold">Acceso desactivado o sin verificar</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Esta cuenta no tiene acceso autorizado. No se cargarán pedidos, productos ni datos privados.
        </p>
        <button type="button" className="nav-btn mt-5" onClick={() => void signOut()}>
          Cerrar sesión
        </button>
      </div>
    );
  }
  return <>{children}</>;
}

// El modal de contraseña también requiere un usuario con permisos vigentes.
function ApprovedPasswordModal() {
  const { user, profile, loading } = useAuth();
  if (loading || !user || !profile?.approved) return null;
  return <NewPasswordModal />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <ProviderScopeProvider>
        <Toaster />
        <Sonner />
        <ApprovedPasswordModal />

        <ViewErrorBoundary>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Index />} />

            <Route
              path="/asignar-pedidos"
              element={<PrivateRoute><AssignOrdersView /></PrivateRoute>}
            />

            <Route
              path="/qr"
              element={<PrivateRoute><QRScannerView /></PrivateRoute>}
            />

            <Route
              path="/products"
              element={<PrivateRoute><ProductsView /></PrivateRoute>}
            />

            <Route
              path="/p/:slug"
              element={<PublicLandingRoute />}
            />

            <Route
              path="/preview/:id"
              element={<PreviewLandingRoute />}
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </HashRouter>
        </ViewErrorBoundary>
              </ProviderScopeProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
