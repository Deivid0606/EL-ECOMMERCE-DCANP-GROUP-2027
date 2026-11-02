import "./lib/recoveryFlag";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installPyTimeZone } from "./lib/pyTime";

// Toda la app muestra la hora de Paraguay, sin importar la zona del dispositivo.
installPyTimeZone();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("No se encontró el elemento #root");
}

createRoot(rootElement).render(<App />);
