import type { CapacitorConfig } from '@capacitor/cli';

// 📱 App «DCANP Delivery» (Android): abre el mismo sistema web de siempre, con la
// ubicación en segundo plano para que el delivery siga en el mapa aunque bloquee
// el celular o use otras apps (WhatsApp, Waze). Cada cambio de la web se ve al
// instante en la app: no hace falta reinstalarla.
const config: CapacitorConfig = {
  appId: 'com.dcanpgroup.delivery',
  appName: 'DCANP Delivery',
  webDir: 'dist',
  server: {
    url: 'https://www.el-ecommercedcanpgroup.com',
    androidScheme: 'https',
  },
  android: {
    // La ubicación se manda aunque la pantalla esté apagada.
    useLegacyBridge: true,
  },
};

export default config;
