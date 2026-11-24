import type { CapacitorConfig } from '@capacitor/cli';

// The iPhone / Android app: the same Spannr app (built into dist/), packaged with native extras like Tap to Pay.
const config: CapacitorConfig = {
  appId: 'au.spannr.app',
  appName: 'Spannr',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  ios: {
    contentInset: 'never',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
