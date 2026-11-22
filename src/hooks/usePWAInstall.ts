import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __chainscopeDeferredPrompt?: BeforeInstallPromptEvent | null;
  }
}

export type MobilePlatform = 'ios' | 'android' | 'desktop';

function detectMobilePlatform(): MobilePlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  const isIPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (/iPad|iPhone|iPod/i.test(ua) || isIPadOs) return 'ios';
  return 'desktop';
}

function detectIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mqStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const navStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return Boolean(mqStandalone || navStandalone);
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window !== 'undefined' && window.__chainscopeDeferredPrompt) {
      return window.__chainscopeDeferredPrompt;
    }
    return null;
  });
  const [isInstalled, setIsInstalled] = useState<boolean>(detectIsStandalone);
  const [platform] = useState<MobilePlatform>(detectMobilePlatform);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__chainscopeDeferredPrompt && !deferredPrompt) {
      setDeferredPrompt(window.__chainscopeDeferredPrompt);
    }

    const mq = window.matchMedia?.('(display-mode: standalone)');
    const syncStandalone = () => {
      if (detectIsStandalone()) {
        setIsInstalled(true);
        setDeferredPrompt(null);
        window.__chainscopeDeferredPrompt = null;
      }
    };

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      window.__chainscopeDeferredPrompt = ev;
      setDeferredPrompt(ev);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      window.__chainscopeDeferredPrompt = null;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    mq?.addEventListener?.('change', syncStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mq?.removeEventListener?.('change', syncStandalone);
    };
  }, [deferredPrompt]);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual'> => {
    const activePrompt =
      deferredPrompt ||
      (typeof window !== 'undefined' ? window.__chainscopeDeferredPrompt : null);
    if (!activePrompt) return 'manual';
    await activePrompt.prompt();
    const { outcome } = await activePrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      if (typeof window !== 'undefined') {
        window.__chainscopeDeferredPrompt = null;
      }
    }
    return outcome;
  }, [deferredPrompt]);

  const triggerDirectIosShortcut = useCallback(async (): Promise<'shared' | 'profile'> => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'ChainScope',
          text: 'ChainScope Wallet & Scanner',
          url: window.location.origin,
        });
        return 'shared';
      } catch {
        // User cancelled share or browser blocked share; fall back to direct WebClip download
      }
    }
    window.location.assign('/api/pwa/ios-shortcut.mobileconfig');
    return 'profile';
  }, []);

  const triggerDirectAndroidFallback = useCallback(async (): Promise<'shared' | 'chrome'> => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'ChainScope',
          text: 'Install ChainScope Shortcut',
          url: window.location.origin,
        });
        return 'shared';
      } catch {
        // Fallback to direct Chrome intent
      }
    }
    const hostAndPath = `${window.location.host}${window.location.pathname}`;
    window.location.assign(
      `intent://${hostAndPath}#Intent;scheme=https;package=com.android.chrome;end`
    );
    return 'chrome';
  }, []);

  return {
    canNativeInstall:
      deferredPrompt !== null ||
      (typeof window !== 'undefined' && Boolean(window.__chainscopeDeferredPrompt)),
    isInstalled,
    platform,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    promptInstall,
    triggerDirectIosShortcut,
    triggerDirectAndroidFallback,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}
