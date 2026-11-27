import { Capacitor } from '@capacitor/core';

/** Running inside the iPhone / Android app (not a browser). */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';

/**
 * The public web address of Spannr. Links sent to customers and team members, and sign-in emails,
 * must always point here – inside the native app, window.location is the app itself.
 */
export const APP_URL = isNative ? 'https://app.spannr.au' : window.location.origin;

// Inside the iPhone/Android app there's no pinch-to-zoom (like any native app), so the view can't get stuck zoomed in.
if (isNative) {
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
  );
}
