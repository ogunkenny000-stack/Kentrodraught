import { initializeInstallPrompt } from './lib/pwaInstall';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
import { APP_BUILD } from "./lib/constants";
import './index.css';
import './kentro-design.css';

initializeInstallPrompt();

console.log(`%cKentro Draught build ${APP_BUILD}`, "color:#f59e0b;font-weight:bold");

// Register the service worker in production only.
// In development, explicitly unregister all service workers and purge caches
// to avoid stale module cache poisoning and React dispatcher mismatch errors.
if ("serviceWorker" in navigator) {
  const isDevHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname.includes("-dev-") ||
    import.meta.env.DEV;

  if (!isDevHost) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("Service worker registration failed:", err);
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister();
      }
    });
    if ("caches" in window) {
      caches.keys().then((keys) => {
        for (const key of keys) {
          caches.delete(key);
        }
      });
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

