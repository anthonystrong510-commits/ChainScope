import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
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
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(detectIsStandalone);
  const [platform] = useState<MobilePlatform>(detectMobilePlatform);

  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const syncStandalone = () => {
      if (detectIsStandalone()) {
        setIsInstalled(true);
        setDeferredPrompt(null);
      }
    };

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    mq?.addEventListener?.('change', syncStandalone);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mq?.removeEventListener?.('change', syncStandalone);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'manual'> => {
    if (!deferredPrompt) return 'manual';
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
    return outcome;
  }, [deferredPrompt]);

  return {
    canNativeInstall: deferredPrompt !== null,
    isInstalled,
    platform,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
    promptInstall,
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
