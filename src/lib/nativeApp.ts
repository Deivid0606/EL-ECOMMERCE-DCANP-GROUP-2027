import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * 📱 App «DCANP Delivery» (Android). La web es la misma; dentro de la app se usa
 * la ubicación en segundo plano (sigue con la pantalla apagada o usando otras apps).
 */

export const isNativeApp = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** Link para descargar la app (Android). */
export const ANDROID_APP_URL = '/dcanp-delivery.apk';

export const isAndroidBrowser = () => /android/i.test(navigator.userAgent) && !isNativeApp();

type BgLocation = { latitude: number; longitude: number; accuracy: number; time: number | null };
type BgError = { code?: string; message?: string };
type BgPlugin = {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgLocation, error?: BgError) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};

const BackgroundGeolocation = registerPlugin<BgPlugin>('BackgroundGeolocation');

/**
 * Empieza a seguir la ubicación con aviso fijo en el celular. Devuelve una función
 * para detenerlo. `onError('NOT_AUTHORIZED')` si el delivery no dio permiso.
 */
export async function startBackgroundLocation(
  onLocation: (p: { lat: number; lng: number; accuracy: number }) => void,
  onError: (code: string) => void,
): Promise<() => void> {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: '🛵 DCANP · compartiendo tu ubicación',
      backgroundMessage: 'Se apaga solo al tocar «Finalicé mi día».',
      requestPermissions: true,
      stale: false,
      distanceFilter: 15,
    },
    (position, error) => {
      if (error) {
        onError(String(error.code || error.message || 'ERROR'));
        return;
      }
      if (position) onLocation({ lat: position.latitude, lng: position.longitude, accuracy: position.accuracy });
    },
  );
  return () => {
    void BackgroundGeolocation.removeWatcher({ id });
  };
}

export const openAppSettings = () => BackgroundGeolocation.openSettings();

/**
 * Dentro de la app no hay pestañas: los links a WhatsApp, Google Maps, Waze, etc.
 * se abren en su propia app. `window.open('', '_blank')` (pestaña que se completa
 * después) devuelve un objeto cuyo `location.href` abre el link.
 */
export function installNativeLinkHandling() {
  if (!isNativeApp()) return;
  const go = (url: string) => {
    if (url) window.location.href = url;
  };
  window.open = ((url?: string | URL) => {
    const target = url ? String(url) : '';
    if (target && target !== 'about:blank') {
      go(target);
      return null;
    }
    const fake: any = { closed: false, close() {}, focus() {}, document: { write() {}, close() {} } };
    fake.location = {
      set href(v: string) {
        go(v);
      },
      get href() {
        return '';
      },
      assign: go,
      replace: go,
    };
    return fake as Window;
  }) as typeof window.open;
}
