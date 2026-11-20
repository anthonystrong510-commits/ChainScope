import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  MoreVertical,
  PlusSquare,
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
  const { canNativeInstall, isInstalled, isIOS, isAndroid, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [activeOsTab, setActiveOsTab] = useState<'ios' | 'android'>(() =>
    isIOS ? 'ios' : 'android'
  );
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canNativeInstall) {
      const outcome = await promptInstall();
      if (outcome !== 'accepted') {
        setActiveOsTab(isIOS ? 'ios' : 'android');
        setShowGuide(true);
      }
      return;
    }
    setActiveOsTab(isIOS ? 'ios' : 'android');
    setShowGuide(true);
  };

  const handleCopyAppUrl = async () => {
    if (typeof window === 'undefined') return;
    await navigator.clipboard.writeText(window.location.href);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <button
          type="button"
          onClick={() => void handleClick()}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/15 text-xs font-medium text-blue-600 dark:text-blue-400 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Smartphone className="w-3.5 h-3.5 shrink-0" />
            <span>Add Phone Shortcut</span>
          </span>
          <span className="text-[10px] font-mono uppercase">
            {isIOS ? 'iOS' : isAndroid ? 'Android' : 'App'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void handleClick()}
          title="Install ChainScope shortcut on Android or iPhone"
          className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-blue-500" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Shortcut</span>
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add ChainScope Home Screen Shortcut"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src="/pwa-192x192.png"
                  alt="ChainScope icon"
                  className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0"
                />
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Add ChainScope Shortcut
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Launch full-screen on your phone home screen
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Platform Switcher */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0B0F17] text-xs">
              <button
                type="button"
                onClick={() => setActiveOsTab('ios')}
                className={`py-2 rounded-md font-medium transition-colors ${
                  activeOsTab === 'ios'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                iPhone / iPad (iOS)
              </button>
              <button
                type="button"
                onClick={() => setActiveOsTab('android')}
                className={`py-2 rounded-md font-medium transition-colors ${
                  activeOsTab === 'android'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Android Phone
              </button>
            </div>

            {activeOsTab === 'ios' ? (
              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <div>
                      Open this page in <strong>Safari</strong> on your iPhone or iPad, then tap the{' '}
                      <span className="inline-flex items-center gap-1 font-semibold text-blue-500">
                        <Share className="w-3.5 h-3.5" /> Share
                      </span>{' '}
                      button at the bottom bar.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <div>
                      Scroll down the share sheet and tap{' '}
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100">
                        <PlusSquare className="w-3.5 h-3.5" /> Add to Home Screen
                      </span>
                      .
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <div>
                      Tap <strong>Add</strong> in the top-right corner. ChainScope now opens like a
                      native iOS app with its own home-screen icon.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-xs text-slate-700 dark:text-slate-300">
                {canNativeInstall && (
                  <button
                    type="button"
                    onClick={() => void promptInstall().then((o) => o === 'accepted' && setShowGuide(false))}
                    className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Install ChainScope Shortcut Now
                  </button>
                )}

                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F17] space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <div>
                      Open ChainScope in <strong>Chrome</strong> (or Brave / Edge / Samsung
                      Internet) on Android and tap the{' '}
                      <span className="inline-flex items-center gap-0.5 font-semibold text-blue-500">
                        <MoreVertical className="w-3.5 h-3.5" /> menu
                      </span>{' '}
                      in the top-right corner.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <div>
                      Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <div>
                      Confirm <strong>Install</strong> to place the ChainScope shortcut icon on your
                      Android launcher.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleCopyAppUrl()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
              >
                {copiedUrl ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedUrl ? 'Link Copied' : 'Copy App Link'}
              </button>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold"
              >
                Done
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
