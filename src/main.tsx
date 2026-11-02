import "./lib/recoveryFlag";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installPyTimeZone } from "./lib/pyTime";
import { reloadForNewVersion } from "./components/ViewErrorBoundary";

// Toda la app muestra la hora de Paraguay, sin importar la zona del dispositivo.
installPyTimeZone();

// Después de publicar una versión nueva, los archivos de la vieja ya no existen:
// si una pestaña no puede cargarse, se recarga la app sola (una vez).
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("No se encontró el elemento #root");
}

createRoot(rootElement).render(<App />);
