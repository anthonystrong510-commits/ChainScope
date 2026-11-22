import { useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar';
}

export function PWAInstallButton({ variant = 'header' }: PWAInstallButtonProps) {
  const {
    canNativeInstall,
    isInstalled,
    isIOS,
    isAndroid,
    promptInstall,
    triggerDirectIosShortcut,
    triggerDirectAndroidFallback,
  } = usePWAInstall();

  const [showDirectMenu, setShowDirectMenu] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  if (isInstalled) return null;

  const handleDirectInstall = async () => {
    setStatusNotice(null);

    // 1. Direct native Chromium / Android install prompt
    if (canNativeInstall) {
      const outcome = await promptInstall();
      if (outcome === 'accepted') {
        setShowDirectMenu(false);
        return;
      }
    }

    // 2. Direct iOS action (native share sheet or .mobileconfig direct shortcut)
    if (isIOS) {
      const mode = await triggerDirectIosShortcut();
      if (mode === 'profile') {
        setStatusNotice('Shortcut profile downloaded — tap Allow to add ChainScope.');
      }
      return;
    }

    // 3. Direct Android fallback (Chrome intent / share) or Desktop direct action sheet
    if (isAndroid) {
      await triggerDirectAndroidFallback();
      return;
    }

    setShowDirectMenu(true);
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={() => void handleDirectInstall()}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/15 text-xs font-medium text-blue-600 dark:text-blue-400 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Direct Install Shortcut</span>
          </span>
          <span className="text-[10px] font-mono uppercase">
            {isIOS ? 'iOS' : isAndroid ? 'Android' : '1-Tap'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleDirectInstall()}
          title="1-tap shortcut install for iOS & Android"
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden sm:inline">Install Shortcut</span>
          <span className="sm:hidden">Install</span>
        </button>
      )}

      {statusNotice && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-emerald-500/30 bg-slate-900 text-white px-3.5 py-2.5 text-xs flex items-center gap-2 shadow-lg">
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>{statusNotice}</span>
        </div>
      )}

      {showDirectMenu && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Direct Shortcut Installer"
        >
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="ChainScope icon"
                  className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0"
                />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Direct Phone Shortcut
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Tap a button below to trigger native install directly
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDirectMenu(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <a
                href="/api/pwa/ios-shortcut.mobileconfig"
                onClick={() => {
                  setStatusNotice('Downloading iOS Shortcut profile...');
                  setShowDirectMenu(false);
                }}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Smartphone className="w-4 h-4" />
                  iPhone / iPad Direct Shortcut Profile
                </span>
                <Download className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={() =>
                  void triggerDirectIosShortcut().then(() => setShowDirectMenu(false))
                }
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Share className="w-4 h-4 text-blue-500" />
                  Launch Native iOS Share Sheet
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (canNativeInstall) {
                    void promptInstall().then((o) => o === 'accepted' && setShowDirectMenu(false));
                  } else {
                    void triggerDirectAndroidFallback().then(() => setShowDirectMenu(false));
                  }
                }}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-500" />
                  Android Direct Chrome Install
                </span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-center gap-2">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Offline mode — cached portfolio & UI ready. Live RPC & trades resume when online.</span>
    </div>
  );
}
