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
import { AuthProvider } from "@/hooks/useAuth";
import NewPasswordModal from "./components/NewPasswordModal.tsx";

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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <NewPasswordModal />

        <HashRouter>
          <Routes>
            <Route path="/" element={<Index />} />

            <Route
              path="/asignar-pedidos"
              element={<AssignOrdersView />}
            />

            <Route
              path="/qr"
              element={<QRScannerView />}
            />

            <Route
              path="/products"
              element={<ProductsView />}
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
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
