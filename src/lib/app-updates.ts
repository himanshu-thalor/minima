import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export type AppRelease = { id: string; builtAt: string };
const versionPath = '/app-version.json';

async function fetchRelease(): Promise<AppRelease> {
  if (!navigator.onLine) throw new Error('Connect to the internet to check for an update.');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(versionPath + '?check=' + Date.now(), { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('The update server could not be reached. Try again.');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The update information is unavailable. Try again shortly.');
    let release: unknown;
    try { release = await response.json(); }
    catch { throw new Error('The update information is unavailable. Try again shortly.'); }
    if (!release || typeof release !== 'object' || !('id' in release) || typeof release.id !== 'string' || !release.id || !('builtAt' in release) || typeof release.builtAt !== 'string') {
      throw new Error('The update information is unavailable. Try again shortly.');
    }
    return { id: release.id, builtAt: release.builtAt };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw new Error('The update check timed out. Try again with a connection.');
    throw cause;
  } finally {
    window.clearTimeout(timer);
  }
}

function waitForWorker(worker: ServiceWorker, timeout: number): Promise<boolean> {
  if (worker.state === 'activated') return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (activated: boolean) => {
      window.clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      resolve(activated);
    };
    const changed = () => {
      if (worker.state === 'activated') finish(true);
      else if (worker.state === 'redundant') finish(false);
    };
    const timer = window.setTimeout(() => finish(false), timeout);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

async function waitForInstall(registration: ServiceWorkerRegistration): Promise<void> {
  if (!registration.installing) return;
  const worker = registration.installing;
  if (worker.state === 'installed' || worker.state === 'activated') return;
  await new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      resolve();
    };
    const changed = () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') finish();
    };
    const timer = window.setTimeout(finish, 6000);
    worker.addEventListener('statechange', changed);
    changed();
  });
}

export function useAppUpdates() {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const checkPromise = useRef<Promise<boolean> | null>(null);
  const lastBackgroundCheck = useRef(0);
  const forceInProgress = useRef(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const buildId = __MINIMA_BUILD_ID__;

  const registration = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registered) {
      registrationRef.current = registered;
      // Workbox's registration wrapper omits updateViaCache. Re-registering the
      // same worker scope changes that policy without replacing any app data.
      if (registered && registered.updateViaCache !== 'none') {
        void navigator.serviceWorker.register(swUrl, { scope: registered.scope, updateViaCache: 'none' })
          .then((fresh) => { registrationRef.current = fresh; return fresh.update(); })
          .catch(() => { /* The next online or resume check retries registration. */ });
      } else if (registered && navigator.onLine) {
        void registered.update().catch(() => {});
      }
    },
    // Another open Minima window can activate a waiting worker. Keep this
    // window's drafts on screen until its user chooses to refresh.
    onNeedReload() {},
  });
  const [needRefresh, setNeedRefresh] = registration.needRefresh;

  const checkForUpdates = useCallback((): Promise<boolean> => {
    if (checkPromise.current) return checkPromise.current;
    setChecking(true);
    setError('');
    const check = (async () => {
      try {
        const release = await fetchRelease();
        const activeRegistration = registrationRef.current ?? await navigator.serviceWorker?.getRegistration();
        if (activeRegistration && navigator.onLine) void activeRegistration.update().catch(() => {});
        const available = release.id !== buildId || Boolean(activeRegistration?.waiting);
        setNeedRefresh(available);
        setLastChecked(Date.now());
        return available;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'The update could not be checked. Try again.';
        setError(message);
        throw new Error(message);
      } finally {
        setChecking(false);
        checkPromise.current = null;
      }
    })();
    checkPromise.current = check;
    return check;
  }, [buildId, setNeedRefresh]);

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastBackgroundCheck.current < 15000) return;
      lastBackgroundCheck.current = Date.now();
      void checkForUpdates().catch(() => {});
    };
    check();
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    const interval = window.setInterval(check, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(interval);
    };
  }, [checkForUpdates]);

  const forceUpdate = useCallback(async () => {
    if (forceInProgress.current) return;
    forceInProgress.current = true;
    setUpdating(true);
    setError('');
    try {
      const release = await fetchRelease();
      // A unique query bypasses older workers' index precache keys. A fetch
      // request is not intercepted by their navigation-only SPA fallback.
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      let html: string;
      try {
        const response = await fetch('/index.html?minima-update=' + Date.now(), { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('The latest app files could not be downloaded.');
        html = await response.text();
      } finally {
        window.clearTimeout(timer);
      }
      const document = new DOMParser().parseFromString(html, 'text/html');
      if (document.querySelector('meta[name="minima-build"]')?.getAttribute('content') !== release.id) {
        throw new Error('The new release is still becoming available. Try again shortly.');
      }

      if ('serviceWorker' in navigator) {
        const registered = registrationRef.current ?? await navigator.serviceWorker.getRegistration(location.href);
        if (registered) {
          await Promise.race([registered.update().catch(() => {}), new Promise((resolve) => window.setTimeout(resolve, 5000))]);
          await waitForInstall(registered);
          const waiting = registered.waiting;
          let activated = false;
          if (waiting) {
            const activation = waitForWorker(waiting, 3500);
            waiting.postMessage({ type: 'SKIP_WAITING' });
            activated = await activation;
          }
          // This explicit action also recovers a stale registration when the
          // browser failed to install a waiting worker.
          if (!activated) await registered.unregister();
        }
      }
      const next = new URL(location.href);
      next.searchParams.set('_minima_release', release.id);
      next.searchParams.set('_minima_refresh', String(Date.now()));
      location.replace(next.href);
    } catch (cause) {
      const message = cause instanceof Error && cause.name === 'AbortError'
        ? 'Downloading the update timed out. Try again with a connection.'
        : cause instanceof Error ? cause.message : 'The app could not be refreshed. Try again.';
      setError(message);
      setUpdating(false);
      forceInProgress.current = false;
      throw new Error(message);
    }
  }, []);

  return {
    offlineReady: registration.offlineReady,
    needRefresh: [needRefresh, setNeedRefresh] as const,
    checkForUpdates,
    forceUpdate,
    checking,
    updating,
    error,
    lastChecked,
    buildId,
  };
}

