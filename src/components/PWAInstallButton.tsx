import React, { useEffect, useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X, CheckCircle2 } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(isStandalone);
    };

    checkStandalone();

    const ua = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    triggerInstall,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-amber-950/90 border border-[#F59E0B]/70 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-amber-200">
      <WifiOff className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
      <span>Mode Offline — Antarmuka di-cache oleh Service Worker AEGIS-BRIEF.</span>
    </div>
  );
};

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  // Automatically hide once already running in installed standalone mode
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      await triggerInstall();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#38BDF8]/20 hover:bg-[#38BDF8]/30 active:scale-95 border border-[#38BDF8]/60 text-[#38BDF8] hover:text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer shrink-0"
        title="Instal AEGIS-BRIEF ke Layar Utama (Android / iPhone / iPad / Tablet)"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>

      {showGuideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#111827] border border-[#1E293B] rounded-2xl p-5 shadow-2xl space-y-4 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-[#38BDF8]" />
                <h3 className="text-sm font-extrabold tracking-wider uppercase text-white">
                  Instal AEGIS-BRIEF ke Layar Utama
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs leading-relaxed">
              {/* iOS / iPadOS Safari Guide */}
              <div
                className={`p-3 rounded-xl border ${
                  isIOS
                    ? 'bg-[#38BDF8]/10 border-[#38BDF8]/60'
                    : 'bg-[#0B1120] border-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-[#38BDF8] mb-1">
                  <Share className="w-3.5 h-3.5" />
                  <span>iPhone &amp; iPad (Safari):</span>
                </div>
                <p className="text-slate-200">
                  Untuk menginstal di iPhone/iPad: ketuk ikon{' '}
                  <strong className="text-white">Bagikan (Share ↑)</strong> di bawah
                  browser Safari, lalu pilih{' '}
                  <strong className="text-[#F59E0B]">
                    &apos;Tambah ke Layar Utama&apos; (Add to Home Screen)
                  </strong>
                  .
                </p>
              </div>

              {/* Android Phone & Tablet Guide */}
              <div
                className={`p-3 rounded-xl border ${
                  !isIOS
                    ? 'bg-[#10B981]/10 border-[#10B981]/60'
                    : 'bg-[#0B1120] border-slate-800'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold text-[#10B981] mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>HP Android &amp; Tablet (Chrome / Edge / Samsung):</span>
                </div>
                <p className="text-slate-200">
                  Buka halaman ini di tab penuh browser Chrome, ketuk ikon menu{' '}
                  <strong className="text-white">(⋮)</strong> di pojok kanan atas, lalu
                  pilih{' '}
                  <strong className="text-[#10B981]">
                    &apos;Instal aplikasi&apos; (Install app)
                  </strong>{' '}
                  atau{' '}
                  <strong className="text-[#10B981]">
                    &apos;Tambahkan ke Layar utama&apos;
                  </strong>
                  .
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 rounded-xl bg-gradient-to-b from-[#2E6DB4] to-[#1E4E87] hover:from-[#3579C4] hover:to-[#245A99] border border-[#38BDF8]/50 text-xs font-bold uppercase tracking-wider text-white cursor-pointer"
            >
              Mengerti / Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
};
