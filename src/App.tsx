/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  FileText,
  Check,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Camera,
  LogOut,
  ShieldAlert,
  PlayCircle,
  Archive,
  Zap,
  Lock,
  Loader2,
  ListChecks,
  BookOpen,
  GitCompare,
  Trash2,
  Globe,
  Settings,
  X,
} from 'lucide-react';
import type {
  AudioChunkItem,
  CapturedPhotoItem,
  GeminiFailureInfo,
  MeetingMetadata,
  MeetingReportResult,
  PhotoCaptureSource,
  VisionCategory,
  VisionRouterResponse,
  WaktuSalam,
} from './types';
import {
  blobToBase64,
  buildOfficialReportText,
  buildUnifiedSessionContext,
  createCleanSessionMetadata,
  createCleanSessionReport,
  detectCurrentTimeRange,
  detectWaktuSalam,
  formatIndonesianDate,
  getTodayIsoDate,
} from './utils/reportFormatter';
import { exportReportToDocx } from './utils/docxExport';
import {
  burnTacticalBannerWatermark,
  stripExifAndNormalizeImage,
} from './utils/tacticalWatermark';
import {
  clearAllActiveSessionVault,
  clearAudioVaultChunks,
  loadActiveSessionStateFromVault,
  loadAudioChunksFromVault,
  loadCapturedPhotosFromVault,
  removeAudioChunkFromVault,
  removeCapturedPhotoFromVault,
  saveActiveSessionStateToVault,
  saveAudioChunkToVault,
  saveCapturedPhotoToVault,
  saveSessionDraftToArchive,
  type ArchivedSessionRecord,
} from './utils/audioVaultDb';
import { WingCrestEmblem, KomlekOmegaEmblem } from './components/DiskomlekauEmblems';
import { AudioRecorder } from './components/AudioRecorder';
import {
  FullscreenCameraModal,
  CollapsibleDataCaptureTray,
} from './components/TacticalCameraAndTray';
import {
  PWAInstallButton,
  OfflineIndicator,
} from './components/PWAInstallButton';
import { GeminiFallbackPanel } from './components/GeminiFallbackPanel';

const CATEGORY_CYCLE: VisionCategory[] = [
  'OCR_UNDANGAN',
  'MATERI_PAPARAN',
  'DOKUMENTASI_KEGIATAN',
];

class ApiCallError extends Error {
  public readonly geminiFailed: boolean;
  public readonly failureReason?: string;
  public readonly model: string;
  public readonly attemptedKeySlots?: number;

  constructor(
    message: string,
    opts?: {
      geminiFailed?: boolean;
      failureReason?: string;
      model?: string;
      attemptedKeySlots?: number;
    }
  ) {
    super(message);
    this.name = 'ApiCallError';
    this.geminiFailed = Boolean(opts?.geminiFailed);
    this.failureReason = opts?.failureReason;
    this.model = opts?.model || 'gemini-3.1-pro-preview';
    this.attemptedKeySlots = opts?.attemptedKeySlots;
  }
}

export default function App() {
  const [metadata, setMetadata] = useState<MeetingMetadata>(() =>
    createCleanSessionMetadata(new Date())
  );
  const [report, setReport] = useState<MeetingReportResult>(() =>
    createCleanSessionReport()
  );
  const [customFullText, setCustomFullText] = useState<string | null>(null);
  const [isManualEditLocked, setIsManualEditLocked] = useState(false);

  const [chunks, setChunks] = useState<AudioChunkItem[]>([]);
  const [screenFrames, setScreenFrames] = useState<string[]>([]);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhotoItem[]>([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [isVaultHydrated, setIsVaultHydrated] = useState(false);

  const [isFullscreenCameraOpen, setIsFullscreenCameraOpen] = useState(false);
  const [showExtraMetadata, setShowExtraMetadata] = useState(false);
  const [showDetailedResumeDrawer, setShowDetailedResumeDrawer] = useState(true);

  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isSessionExited, setIsSessionExited] = useState(false);
  const [lastArchivedSession, setLastArchivedSession] =
    useState<ArchivedSessionRecord | null>(null);

  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [backgroundChunkIds, setBackgroundChunkIds] = useState<string[]>([]);
  const [isCrossModalSyncing, setIsCrossModalSyncing] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccessBanner, setApiSuccessBanner] = useState<string | null>(null);
  const [geminiFailure, setGeminiFailure] = useState<GeminiFailureInfo | null>(null);
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const getGeminiKey = () => {
    return (
      localStorage.getItem('aegis_custom_gemini_key') ||
      import.meta.env.VITE_GEMINI_API_KEY ||
      (typeof process !== 'undefined' && (process as any).env ? ((process as any).env.GEMINI_API_KEY || (process as any).env.API_KEY || (process as any).env.VITE_GEMINI_API_KEY) : '') ||
      ''
    ).trim();
  };

  const getGroqKey = () => {
    return (
      localStorage.getItem('aegis_groq_api_key') ||
      import.meta.env.VITE_GROQ_API_KEY ||
      (typeof process !== 'undefined' && (process as any).env ? ((process as any).env.GROQ_API_KEY || (process as any).env.VITE_GROQ_API_KEY) : '') ||
      ''
    ).trim();
  };

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [groqApiKeySetting, setGroqApiKeySetting] = useState(getGroqKey);
  const [customGeminiApiKeySetting, setCustomGeminiApiKeySetting] = useState(getGeminiKey);
  const [aiModeSetting, setAiModeSetting] = useState<'auto' | 'groq'>(() => (localStorage.getItem('aegis_ai_mode') as any) || 'auto');

  const getStoredApiSettings = () => ({
    customGeminiApiKey: getGeminiKey(),
    groqApiKey: getGroqKey(),
    aiMode: localStorage.getItem('aegis_ai_mode') || 'auto',
  });

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const directLampiranInputRef = useRef<HTMLInputElement | null>(null);
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const inFlightChunkPromisesRef = useRef<Map<string, Promise<AudioChunkItem>>>(
    new Map()
  );

  const metadataRef = useRef<MeetingMetadata>(metadata);
  const reportRef = useRef<MeetingReportResult>(report);
  const customFullTextRef = useRef<string | null>(customFullText);
  const capturedPhotosRef = useRef<CapturedPhotoItem[]>(capturedPhotos);
  const chunksRef = useRef<AudioChunkItem[]>(chunks);
  const screenFramesRef = useRef<string[]>(screenFrames);
  const isManualEditLockedRef = useRef<boolean>(isManualEditLocked);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    customFullTextRef.current = customFullText;
  }, [customFullText]);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    screenFramesRef.current = screenFrames;
  }, [screenFrames]);

  useEffect(() => {
    isManualEditLockedRef.current = isManualEditLocked;
  }, [isManualEditLocked]);

  // Restore ALL persisted session data (chunks, camera/upload photos, metadata, report) until deleted by user
  useEffect(() => {
    let cancelled = false;
    const hydrateVault = async () => {
      const [persistedChunks, persistedPhotos, persistedSession] = await Promise.all([
        loadAudioChunksFromVault(),
        loadCapturedPhotosFromVault(),
        loadActiveSessionStateFromVault(),
      ]);
      if (cancelled) return;

      if (persistedChunks.length > 0) {
        setChunks((prev) => (prev.length === 0 ? persistedChunks : prev));
      }
      if (persistedPhotos.length > 0) {
        setCapturedPhotos((prev) => (prev.length === 0 ? persistedPhotos : prev));
        setSelectedPhotoId((prev) => prev || persistedPhotos[persistedPhotos.length - 1].id);
      }
      if (persistedSession) {
        if (persistedSession.metadata) setMetadata(persistedSession.metadata);
        if (persistedSession.report) setReport(persistedSession.report);
        if (persistedSession.customFullText !== undefined) {
          setCustomFullText(persistedSession.customFullText);
        }
        if (typeof persistedSession.isManualEditLocked === 'boolean') {
          setIsManualEditLocked(persistedSession.isManualEditLocked);
        }
        if (Array.isArray(persistedSession.screenFrames)) {
          setScreenFrames(persistedSession.screenFrames);
        }
      }
      setIsVaultHydrated(true);
    };

    hydrateVault();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-persist active session state (metadata, report, detailedResume, correlationAnalysis, manual edits)
  useEffect(() => {
    if (!isVaultHydrated) return;
    const timer = window.setTimeout(() => {
      saveActiveSessionStateToVault({
        metadata,
        report,
        customFullText,
        isManualEditLocked,
        screenFrames,
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    isVaultHydrated,
    metadata,
    report,
    customFullText,
    isManualEditLocked,
    screenFrames,
  ]);

  const attachmentPhotos = capturedPhotos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  const syncedAudioCount = chunks.filter((c) => c.status === 'done').length;
  const scannedImageCount = capturedPhotos.filter((p) => p.status === 'done').length;

  const autoRenderedReportText = buildOfficialReportText(
    metadata,
    report.isiKegiatan,
    attachmentPhotos.length
  );
  const displayedFullReportText =
    customFullText !== null ? customFullText : autoRenderedReportText;

  // Session Lock: Intercept accidental back-swipe and tab closure until explicit EXIT
  useEffect(() => {
    if (isSessionExited) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRecordingActive) {
        e.preventDefault();
        e.returnValue =
          'Perekaman Rapat sedang aktif. Gunakan tombol EXIT untuk berhenti dan menyimpan.';
        return e.returnValue;
      }
    };

    window.history.pushState({ aegisSessionGuard: true }, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState({ aegisSessionGuard: true }, '', window.location.href);
      setApiSuccessBanner(
        'Sesi Rapat Terkunci agar rekaman tidak terputus. Tekan tombol merah EXIT di kanan atas jika ingin mengakhiri sesi.'
      );
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSessionExited, isRecordingActive]);

  // Dynamically re-burn the bottom watermark ([JUDUL KEGIATAN] - [TANGGAL]) onto ALL attachmentPhotos whenever title/date changes
  useEffect(() => {
    let cancelled = false;
    const reburnAllLampiranWatermarks = async () => {
      const snapshot = capturedPhotosRef.current.filter(
        (p) => p.category === 'DOKUMENTASI_KEGIATAN'
      );
      if (snapshot.length === 0) return;

      const watermarkedPairs = await Promise.all(
        snapshot.map(async (photo) => {
          const watermarkedUrl = await burnTacticalBannerWatermark(
            photo.cleanSourceDataUrl,
            metadata.judulKegiatan,
            metadata.hariTanggal
          );
          return [photo.id, watermarkedUrl] as const;
        })
      );

      if (cancelled) return;

      const watermarkedMap: Record<string, string> = {};
      for (const [id, url] of watermarkedPairs) {
        watermarkedMap[id] = url;
      }

      setCapturedPhotos((prev) =>
        prev.map((photo) => {
          if (photo.category === 'DOKUMENTASI_KEGIATAN' && watermarkedMap[photo.id]) {
            const updated = { ...photo, displayDataUrl: watermarkedMap[photo.id] };
            saveCapturedPhotoToVault(updated);
            return updated;
          }
          return photo;
        })
      );
    };

    reburnAllLampiranWatermarks();
    return () => {
      cancelled = true;
    };
  }, [metadata.judulKegiatan, metadata.hariTanggal]);

  const handleFieldChange = <K extends keyof MeetingMetadata>(
    key: K,
    value: MeetingMetadata[K]
  ) => {
    if (!isManualEditLocked) {
      setCustomFullText(null);
    }
    setMetadata((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Explicit permanent delete / reset (only triggered when user confirms deletion)
  const executePermanentResetSession = async () => {
    setShowResetConfirmModal(false);
    const now = new Date();
    await clearAllActiveSessionVault();
    inFlightChunkPromisesRef.current.clear();
    setBackgroundChunkIds([]);
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setIsManualEditLocked(false);
    setApiError(null);
    setGeminiFailure(null);
    setIsSessionExited(false);
    setMetadata(createCleanSessionMetadata(now));
    setReport(createCleanSessionReport());
    setApiSuccessBanner(
      'Data Sesi Dihapus: Seluruh chunk rekaman, foto kamera/upload, dan laporan sebelumnya telah dihapus bersih.'
    );
  };

  // Explicit EXIT Handler: Stops MediaRecorder & archives draft WITHOUT wiping vault data (kept until user deletes)
  const handleConfirmSaveAndExit = async () => {
    setShowExitConfirmModal(false);

    if (stopRecordingRef.current) {
      await stopRecordingRef.current();
    }

    const archived = await saveSessionDraftToArchive(
      metadata,
      report,
      displayedFullReportText,
      chunks,
      capturedPhotos
    );
    setLastArchivedSession(archived);

    setIsRecordingActive(false);
    setIsSessionExited(true);
  };

  const handleResumeSavedSessionAfterExit = () => {
    setIsSessionExited(false);
    setApiSuccessBanner(
      'Sesi tersimpan dibuka kembali. Semua chunk rekaman dan gambar tetap aman.'
    );
  };

  const triggerGeminiFailureAlert = useCallback(
    (err: any, contextLabel: string) => {
      const message =
        err?.message ||
        `Gagal memproses ${contextLabel} melalui Gemini (gemini-3.1-pro-preview).`;
      setApiError(message);
      setGeminiFailure({
        occurred: true,
        message,
        failureReason: err?.failureReason || 'GEMINI_ERROR',
        model: err?.model || 'gemini-3.1-pro-preview',
        attemptedKeySlots: err?.attemptedKeySlots,
        timestamp: new Date().toLocaleTimeString('id-ID'),
      });
    },
    []
  );

  const parseApiResponseSafe = async (response: Response, contextLabel: string) => {
    const rawText = await response.text();
    const trimmed = rawText.trim();

    if (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html')
    ) {
      throw new ApiCallError(
        `${contextLabel}: Server mengembalikan halaman HTML (HTTP ${response.status}).`,
        { geminiFailed: true, failureReason: 'SERVER_HTML_ERROR' }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new ApiCallError(
        `${contextLabel}: Format respons server tidak valid (HTTP ${response.status}).`,
        { geminiFailed: true, failureReason: 'INVALID_JSON' }
      );
    }

    if (!response.ok || parsed?.error) {
      throw new ApiCallError(
        parsed?.error || `Gagal memproses ${contextLabel} (HTTP ${response.status})`,
        {
          geminiFailed: Boolean(parsed?.geminiFailed ?? true),
          failureReason: parsed?.failureReason,
          model: parsed?.model,
          attemptedKeySlots: parsed?.attemptedKeySlots,
        }
      );
    }

    return parsed;
  };

  /**
   * Routes a captured or manually uploaded photo through Gemini 3.1 Pro Vision.
   * When `preserveCategory` is true (e.g. direct DOKUMENTASI_KEGIATAN correlation scan),
   * extracts visual observations without changing the photo's category.
   */
  const routePhotoThroughVisionAI = useCallback(
    async (
      photoId: string,
      cleanDataUrl: string,
      overrideCategory?: VisionCategory,
      captureSource: PhotoCaptureSource = 'camera',
      preserveCategory: boolean = false,
      skipAutoFusionSync: boolean = false
    ): Promise<CapturedPhotoItem | null> => {
      try {
        const currentMeta = metadataRef.current;
        const currentSessionPaparan = capturedPhotosRef.current
          .filter(
            (p) => p.id !== photoId && p.category === 'MATERI_PAPARAN' && p.extractedText
          )
          .map((p) => p.extractedText!);

        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            mode: 'autonomous_vision',
            imageDataUrl: cleanDataUrl,
            captureSource,
            overrideCategory,
            preserveCategory,
            paparanKnowledge: currentSessionPaparan,
            metadata: currentMeta,
            ...getStoredApiSettings(),
          }),
        });

        const result = (await parseApiResponseSafe(
          response,
          'Autonomous Vision Router'
        )) as VisionRouterResponse & { failoverStatus?: string; failoverTriggered?: boolean };

        if (result.failoverStatus || result.failoverTriggered) {
          setApiSuccessBanner(result.failoverStatus || 'Server Gemini sedang padat. Mengalihkan otomatis ke Groq...');
        }

        setGeminiFailure(null);

        const resolvedCategory: VisionCategory = preserveCategory
          ? overrideCategory || 'DOKUMENTASI_KEGIATAN'
          : overrideCategory || result.category || 'DOKUMENTASI_KEGIATAN';

        const nextTitle =
          result.judulKegiatan?.trim() || metadataRef.current.judulKegiatan;
        const nextDate =
          result.hariTanggal?.trim() || metadataRef.current.hariTanggal;

        let finalDisplayUrl = cleanDataUrl;
        if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
          finalDisplayUrl = await burnTacticalBannerWatermark(
            cleanDataUrl,
            nextTitle,
            nextDate
          );
        }

        const updatedMeta: MeetingMetadata = {
          ...metadataRef.current,
          judulKegiatan:
            result.judulKegiatan?.trim() || metadataRef.current.judulKegiatan,
          hariTanggal:
            result.hariTanggal?.trim() || metadataRef.current.hariTanggal,
          pukul: result.pukul?.trim() || metadataRef.current.pukul,
          tempat: result.tempat?.trim() || metadataRef.current.tempat,
          pimpinanRapat:
            result.pimpinanRapat?.trim() || metadataRef.current.pimpinanRapat,
          pesertaRapat:
            result.pesertaRapat?.trim() || metadataRef.current.pesertaRapat,
        };

        if (resolvedCategory === 'OCR_UNDANGAN') {
          if (!isManualEditLockedRef.current) {
            setCustomFullText(null);
          }
          setMetadata(updatedMeta);
          setApiSuccessBanner(
            `OCR Undangan Selesai (${result.modelUsed || 'gemini-3.1-pro-preview'}${
              result.failoverTriggered ? ` • Failover Key #${result.keySlotUsed}` : ''
            }): Metadata otomatis disinkronkan!`
          );
        }

        if (resolvedCategory === 'MATERI_PAPARAN') {
          if (!isManualEditLockedRef.current) {
            setCustomFullText(null);
          }
          if (result.judulKegiatan?.trim() && !metadataRef.current.judulKegiatan) {
            setMetadata((prev) => ({
              ...prev,
              judulKegiatan: result.judulKegiatan!.trim(),
            }));
          }
          if (result.isiKegiatanDraft?.trim() && !isManualEditLockedRef.current) {
            setReport((prev) => ({
              ...prev,
              isiKegiatan: result.isiKegiatanDraft!.trim(),
            }));
          }
          setApiSuccessBanner(
            `Materi Paparan Dianalisa (${result.modelUsed || 'gemini-3.1-pro-preview'}).`
          );
        }

        const existingItem = capturedPhotosRef.current.find((p) => p.id === photoId);
        const updatedPhoto: CapturedPhotoItem = {
          ...(existingItem || {
            id: photoId,
            cleanSourceDataUrl: cleanDataUrl,
            capturedAt: new Date().toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            captureSource,
          }),
          category: resolvedCategory,
          displayDataUrl: finalDisplayUrl,
          status: 'done',
          confidenceReason: result.confidenceReason || resolvedCategory,
          extractedText:
            result.extractedKnowledge ||
            result.judulKegiatan ||
            result.confidenceReason,
          visualCorrelationNote:
            result.visualCorrelationNote || result.extractedKnowledge || '',
          isiKegiatanDraft: result.isiKegiatanDraft || '',
          extractedMetadata: {
            judulKegiatan: result.judulKegiatan,
            hariTanggal: result.hariTanggal,
            pukul: result.pukul,
            tempat: result.tempat,
            pimpinanRapat: result.pimpinanRapat,
            pesertaRapat: result.pesertaRapat,
          },
          errorMessage: undefined,
        };

        await saveCapturedPhotoToVault(updatedPhoto);

        const nextPhotosSnapshot = capturedPhotosRef.current.map((p) =>
          p.id === photoId ? updatedPhoto : p
        );
        setCapturedPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? updatedPhoto : p))
        );

        if (
          !skipAutoFusionSync &&
          (resolvedCategory === 'OCR_UNDANGAN' || resolvedCategory === 'MATERI_PAPARAN')
        ) {
          await runCrossModalFusionSync(
            chunksRef.current,
            nextPhotosSnapshot,
            updatedMeta
          );
        }

        return updatedPhoto;
      } catch (err: any) {
        const fallbackWatermarked = await burnTacticalBannerWatermark(
          cleanDataUrl,
          metadataRef.current.judulKegiatan,
          metadataRef.current.hariTanggal
        );
        const existingItem = capturedPhotosRef.current.find((p) => p.id === photoId);
        const erroredPhoto: CapturedPhotoItem = {
          ...(existingItem || {
            id: photoId,
            cleanSourceDataUrl: cleanDataUrl,
            capturedAt: new Date().toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            captureSource,
          }),
          category: overrideCategory || 'DOKUMENTASI_KEGIATAN',
          displayDataUrl: fallbackWatermarked,
          status: 'done',
          confidenceReason: 'Tersimpan dengan Watermark (Menunggu Analisa AI)',
          errorMessage: err?.message,
        };
        await saveCapturedPhotoToVault(erroredPhoto);
        setCapturedPhotos((prev) =>
          prev.map((p) => (p.id === photoId ? erroredPhoto : p))
        );
        triggerGeminiFailureAlert(err, 'Analisa Gambar Vision');
        return null;
      }
    },
    [triggerGeminiFailureAlert]
  );

  /**
   * Cross-Modal Correlation & Detailed Resume Engine:
   * Combines ALL 5-minute audio chunk extractions + ALL camera & uploaded images,
   * correlates both modalities, and produces a detailed meeting resume.
   */
  const runCrossModalFusionSync = useCallback(
    async (
      latestChunks?: AudioChunkItem[],
      latestPhotos?: CapturedPhotoItem[],
      latestMeta?: MeetingMetadata,
      forceUnlockManualEdit: boolean = false
    ) => {
      const activeChunks = latestChunks || chunksRef.current;
      const activePhotos = latestPhotos || capturedPhotosRef.current;
      const activeMeta = latestMeta || metadataRef.current;

      const unifiedContext = buildUnifiedSessionContext(
        activeChunks,
        activePhotos,
        activeMeta
      );

      const hasAudioKnowledge = unifiedContext.audioStreamData.length > 0;
      const hasOcrKnowledge = unifiedContext.ocrUndanganData.length > 0;
      const hasSlideKnowledge = unifiedContext.materiPaparanData.length > 0;
      const hasDocObservations =
        unifiedContext.dokumentasiKegiatanData.visualObservations.length > 0 ||
        activePhotos.length > 0;

      if (!hasAudioKnowledge && !hasOcrKnowledge && !hasSlideKnowledge && !hasDocObservations) {
        return;
      }

      if (
        !hasAudioKnowledge &&
        !hasSlideKnowledge &&
        !hasDocObservations &&
        hasOcrKnowledge &&
        !forceUnlockManualEdit
      ) {
        return;
      }

      setIsCrossModalSyncing(true);
      try {
        // Send up to 4 compact representative images (preferring slides, OCR, and field camera/upload docs)
        const visualImagesForFusion = activePhotos
          .filter((p) => p.cleanSourceDataUrl.startsWith('data:image/'))
          .slice(0, 4)
          .map((p, idx) => ({
            label: `${p.category} (${p.captureSource === 'upload' ? 'Upload Manual' : 'Kamera'} #${idx + 1})`,
            dataUrl: p.cleanSourceDataUrl,
          }));

        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            mode: 'cross_modal_fusion',
            unifiedContext,
            visualImagesForFusion,
            metadata: activeMeta,
            ...getStoredApiSettings(),
          }),
        });

        const fused = (await parseApiResponseSafe(
          response,
          'Korelasi & Resume Detil'
        )) as MeetingReportResult & { failoverStatus?: string; failoverTriggered?: boolean };

        if (fused.failoverStatus || fused.failoverTriggered) {
          setApiSuccessBanner(fused.failoverStatus || 'Server Gemini sedang padat. Mengalihkan otomatis ke Groq...');
        }

        setGeminiFailure(null);

        const now = new Date();
        const currentIso = getTodayIsoDate(now);

        if (!isManualEditLockedRef.current || forceUnlockManualEdit) {
          setCustomFullText(null);
        }

        setMetadata((prev) => ({
          ...prev,
          waktuSalam: detectWaktuSalam(now),
          tanggalIso: currentIso,
          judulKegiatan:
            fused.judulKegiatan?.trim() || prev.judulKegiatan || '',
          hariTanggal:
            fused.hariTanggal?.trim() ||
            prev.hariTanggal ||
            formatIndonesianDate(currentIso),
          pukul:
            fused.pukul?.trim() || prev.pukul || detectCurrentTimeRange(now),
          pimpinanRapat:
            fused.pimpinanRapat?.trim() || prev.pimpinanRapat || '',
          pesertaRapat:
            fused.pesertaRapat?.trim() || prev.pesertaRapat || '',
          tempat: fused.tempat?.trim() || prev.tempat || '',
        }));

        if (!isManualEditLockedRef.current || forceUnlockManualEdit) {
          setReport((prev) => ({
            judulKegiatan: fused.judulKegiatan || prev.judulKegiatan,
            hariTanggal: fused.hariTanggal || prev.hariTanggal,
            pukul: fused.pukul || prev.pukul,
            pimpinanRapat: fused.pimpinanRapat || prev.pimpinanRapat,
            pesertaRapat: fused.pesertaRapat || prev.pesertaRapat,
            tempat: fused.tempat || prev.tempat,
            isiKegiatan: fused.isiKegiatan?.trim() || prev.isiKegiatan,
            executiveSummary:
              fused.executiveSummary?.trim() || prev.executiveSummary,
            correlationAnalysis:
              fused.correlationAnalysis?.trim() || prev.correlationAnalysis,
            detailedResume:
              fused.detailedResume?.trim() || prev.detailedResume,
            actionItems:
              Array.isArray(fused.actionItems) && fused.actionItems.length > 0
                ? fused.actionItems
                : prev.actionItems,
            cleanTranscript:
              fused.cleanTranscript?.trim() || prev.cleanTranscript,
            modelUsed: fused.modelUsed,
            keySlotUsed: fused.keySlotUsed,
            failoverTriggered: fused.failoverTriggered,
          }));
        }
      } catch (err: any) {
        triggerGeminiFailureAlert(err, 'Korelasi Audio-Visual & Resume');
      } finally {
        setIsCrossModalSyncing(false);
      }
    },
    [triggerGeminiFailureAlert]
  );

  /**
   * Analyzes a single 5-minute audio chunk via Gemini 3.1 Pro (with automatic key failover),
   * persists transcript & summary into IndexedDB (`aegis_audio_vault`), and tracks in-flight status.
   */
  const analyzeSingleChunk = useCallback(
    async (chunk: AudioChunkItem, totalChunksCount: number): Promise<AudioChunkItem> => {
      const existingPromise = inFlightChunkPromisesRef.current.get(chunk.id);
      if (existingPromise) {
        return existingPromise;
      }

      const taskPromise = (async () => {
        setBackgroundChunkIds((prev) =>
          prev.includes(chunk.id) ? prev : [...prev, chunk.id]
        );
        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? { ...c, status: 'processing', errorMessage: undefined } : c))
        );

        try {
          const currentMeta = metadataRef.current;
          const currentSessionPaparanKnowledge = capturedPhotosRef.current
            .filter((p) => p.category === 'MATERI_PAPARAN' && p.extractedText)
            .map((p) => p.extractedText!);

          const currentSessionOcrKnowledge = capturedPhotosRef.current
            .filter((p) => p.category === 'OCR_UNDANGAN')
            .map((p) =>
              JSON.stringify({
                judulKegiatan: p.extractedMetadata?.judulKegiatan,
                hariTanggal: p.extractedMetadata?.hariTanggal,
                pukul: p.extractedMetadata?.pukul,
                tempat: p.extractedMetadata?.tempat,
                pimpinanRapat: p.extractedMetadata?.pimpinanRapat,
                pesertaRapat: p.extractedMetadata?.pesertaRapat,
                extractedText: p.extractedText,
              })
            );

          const currentSessionVisualFrames = capturedPhotosRef.current
            .filter((p) => p.cleanSourceDataUrl.startsWith('data:image/'))
            .map((p) => p.cleanSourceDataUrl);

          const audioBase64 = await blobToBase64(chunk.blob);
          const framesToSend = [
            ...currentSessionVisualFrames,
            ...(chunk.screenFrames && chunk.screenFrames.length > 0
              ? chunk.screenFrames.slice(-3)
              : screenFramesRef.current.slice(-3)),
          ].slice(0, 4);

          const currentSessionTranscribeKnowledge = chunksRef.current
            .filter((c) => c.status === 'done' && c.transcript)
            .map((c) => c.transcript);

          const response = await fetch('/api/summarize', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              mode: 'single',
              audioBase64,
              mimeType: chunk.mimeType,
              screenFrames: framesToSend,
              paparanKnowledge: currentSessionPaparanKnowledge,
              ocrKnowledge: currentSessionOcrKnowledge,
              transcribeKnowledge: currentSessionTranscribeKnowledge,
              metadata: currentMeta,
              chunkIndex: chunk.index,
              totalChunks: Math.max(totalChunksCount, chunk.index + 1),
              ...getStoredApiSettings(),
            }),
          });

          const data = (await parseApiResponseSafe(
            response,
            `Chunk Rekaman #${chunk.index + 1}`
          )) as MeetingReportResult & { failoverStatus?: string; failoverTriggered?: boolean };

          if (data.failoverStatus || data.failoverTriggered) {
            setApiSuccessBanner(data.failoverStatus || 'Server Gemini sedang padat. Mengalihkan otomatis ke Groq...');
          }

          setGeminiFailure(null);

          const enrichedChunk: AudioChunkItem = {
            ...chunk,
            status: 'done',
            transcript: data.cleanTranscript || '',
            isiKegiatanSummary: data.isiKegiatan || '',
            extractedActionItems: Array.isArray(data.actionItems)
              ? data.actionItems
              : [],
            analyzedAt: new Date().toLocaleTimeString('id-ID'),
            errorMessage: undefined,
          };

          await saveAudioChunkToVault(enrichedChunk);
          setChunks((prev) =>
            prev.map((c) => (c.id === chunk.id ? enrichedChunk : c))
          );

          return enrichedChunk;
        } catch (err: any) {
          const erroredChunk: AudioChunkItem = {
            ...chunk,
            status: 'error',
            errorMessage: err?.message || 'Gagal menganalisa chunk rekaman.',
          };
          await saveAudioChunkToVault(erroredChunk);
          setChunks((prev) =>
            prev.map((c) => (c.id === chunk.id ? erroredChunk : c))
          );
          triggerGeminiFailureAlert(err, `Chunk #${chunk.index + 1}`);
          return erroredChunk;
        } finally {
          inFlightChunkPromisesRef.current.delete(chunk.id);
          setBackgroundChunkIds((prev) => prev.filter((id) => id !== chunk.id));
        }
      })();

      inFlightChunkPromisesRef.current.set(chunk.id, taskPromise);
      return taskPromise;
    },
    [triggerGeminiFailureAlert]
  );

  // Called automatically every 5 minutes while recording continues seamlessly!
  const handleRotateChunkReady = useCallback(
    (completedChunk: AudioChunkItem) => {
      setApiSuccessBanner(
        `Chunk 5 Menit #${completedChunk.index + 1} (${completedChunk.timestampLabel}) tersimpan & sedang dianalisa paralel sambil melanjutkan rekaman Chunk #${
          completedChunk.index + 2
        }...`
      );
      analyzeSingleChunk(completedChunk, chunksRef.current.length + 1);
    },
    [analyzeSingleChunk]
  );

  /**
   * Full End-of-Recording & Manual Synthesis Pipeline:
   * 1. Wait for any in-flight 5-minute background chunk analyses
   * 2. Analyze any unanalyzed audio chunks (including the final chunk)
   * 3. Analyze ALL camera & manually uploaded images that lack visual analysis
   * 4. Correlate ALL audio + ALL visual findings and produce the detailed resume
   */
  const handleProcessWithAI = useCallback(
    async (overrideChunks?: AudioChunkItem[]) => {
      setIsProcessingAI(true);
      setApiError(null);
      setApiSuccessBanner(null);

      try {
        // 1. Wait for any currently running background 5-min chunk jobs
        if (inFlightChunkPromisesRef.current.size > 0) {
          setProcessingStatusText(
            `Menunggu ${inFlightChunkPromisesRef.current.size} analisa chunk latar belakang selesai...`
          );
          await Promise.allSettled(Array.from(inFlightChunkPromisesRef.current.values()));
        }

        const currentChunksSnapshot = overrideChunks || [...chunksRef.current];
        const updatedChunksList: AudioChunkItem[] = [...currentChunksSnapshot];

        // 2. Analyze any remaining ready/error chunks sequentially
        for (let i = 0; i < updatedChunksList.length; i++) {
          const latestChunkState =
            chunksRef.current.find((c) => c.id === updatedChunksList[i].id) ||
            updatedChunksList[i];

          if (latestChunkState.status === 'done' && latestChunkState.transcript) {
            updatedChunksList[i] = latestChunkState;
            continue;
          }

          setProcessingStatusText(
            `Menganalisa Chunk Rekaman #${i + 1}/${updatedChunksList.length} (gemini-3.1-pro-preview)...`
          );
          const analyzed = await analyzeSingleChunk(
            latestChunkState,
            updatedChunksList.length
          );
          updatedChunksList[i] = analyzed;
        }

        // 3. Analyze ALL camera & manually uploaded images that don't have visual correlation notes yet
        const photosSnapshot = [...capturedPhotosRef.current];
        const photosNeedingAnalysis = photosSnapshot.filter(
          (p) => !p.visualCorrelationNote && !p.extractedText
        );

        for (let idx = 0; idx < photosNeedingAnalysis.length; idx++) {
          const photo = photosNeedingAnalysis[idx];
          setProcessingStatusText(
            `Menganalisa Gambar ${
              photo.captureSource === 'upload' ? 'Upload Manual' : 'Kamera'
            } (${idx + 1}/${photosNeedingAnalysis.length})...`
          );
          await routePhotoThroughVisionAI(
            photo.id,
            photo.cleanSourceDataUrl,
            photo.category,
            photo.captureSource || 'camera',
            photo.category === 'DOKUMENTASI_KEGIATAN',
            true
          );
        }

        // 4. Combine ALL data & run Cross-Modal Correlation + Detailed Resume synthesis
        const finalPhotos = [...capturedPhotosRef.current];
        const hasAnyAudioDone = updatedChunksList.some(
          (c) => c.status === 'done' && (c.transcript || c.isiKegiatanSummary)
        );
        const hasAnyPhotoDone = finalPhotos.some((p) => p.status === 'done');

        if (!hasAnyAudioDone && !hasAnyPhotoDone) {
          if (updatedChunksList.some((c) => c.status === 'error')) {
            return;
          }
          setApiError('Belum ada data rekaman atau gambar yang siap dianalisa.');
          return;
        }

        setProcessingStatusText(
          'Menggabungkan Semua Chunk + Gambar & Menyusun Resume Detil...'
        );
        await runCrossModalFusionSync(
          updatedChunksList,
          finalPhotos,
          metadataRef.current,
          !isManualEditLockedRef.current
        );

        const doneAudioCount = updatedChunksList.filter((c) => c.status === 'done').length;
        const doneImgCount = finalPhotos.filter((p) => p.status === 'done').length;
        if (doneAudioCount > 0 || doneImgCount > 0) {
          setApiSuccessBanner(
            `Korelasi & Resume Detil Selesai (${
              reportRef.current.modelUsed || 'gemini-3.1-pro-preview'
            }${
              reportRef.current.failoverTriggered
                ? ` • Failover Key #${reportRef.current.keySlotUsed}`
                : ''
            }): ${doneAudioCount} Chunk Rekaman + ${doneImgCount} Gambar Kamera/Upload digabungkan!`
          );
        }
      } catch (err: any) {
        triggerGeminiFailureAlert(err, 'Penggabungan & Resume Detil');
      } finally {
        setIsProcessingAI(false);
        setProcessingStatusText('');
      }
    },
    [
      analyzeSingleChunk,
      routePhotoThroughVisionAI,
      runCrossModalFusionSync,
      triggerGeminiFailureAlert,
    ]
  );

  // Called when recording stops (Wait briefly for state update then run full end-of-recording correlation)
  const handleFinalStopReady = useCallback(
    (finalChunk: AudioChunkItem | null) => {
      setTimeout(() => {
        const snapshot = [...chunksRef.current];
        if (finalChunk && !snapshot.some((c) => c.id === finalChunk.id)) {
          snapshot.push(finalChunk);
        }
        handleProcessWithAI(snapshot);
      }, 150);
    },
    [handleProcessWithAI]
  );

  const handleRetrySingleChunk = useCallback(
    async (chunkId: string) => {
      const target = chunksRef.current.find((c) => c.id === chunkId);
      if (!target) return;
      const result = await analyzeSingleChunk(target, chunksRef.current.length);
      if (result.status === 'done') {
        await runCrossModalFusionSync(
          chunksRef.current.map((c) => (c.id === chunkId ? result : c)),
          capturedPhotosRef.current,
          metadataRef.current
        );
      }
    },
    [analyzeSingleChunk, runCrossModalFusionSync]
  );

  // Unlimited Multi-Photo Capture & Upload without overwriting previous photos (persisted to IndexedDB)
  const handleAutonomousPhotoCapture = async (
    rawDataUrls: string[],
    forcedCategory?: VisionCategory,
    captureSource: PhotoCaptureSource = 'camera'
  ) => {
    if (!rawDataUrls || rawDataUrls.length === 0) return;
    setApiError(null);
    if (!isManualEditLockedRef.current) {
      setCustomFullText(null);
    }

    const timeLabel = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const preparedItems = await Promise.all(
      rawDataUrls.map(async (rawUrl, idx) => {
        const cleanDataUrl = await stripExifAndNormalizeImage(rawUrl);
        const watermarkedDataUrl = await burnTacticalBannerWatermark(
          cleanDataUrl,
          metadataRef.current.judulKegiatan,
          metadataRef.current.hariTanggal
        );
        const newId = `photo-${Date.now()}-${idx}-${Math.random()
          .toString(36)
          .slice(2, 7)}`;

        const isDirectLampiran = forcedCategory === 'DOKUMENTASI_KEGIATAN';

        const item: CapturedPhotoItem = {
          id: newId,
          category: forcedCategory || 'DOKUMENTASI_KEGIATAN',
          captureSource,
          cleanSourceDataUrl: cleanDataUrl,
          displayDataUrl: watermarkedDataUrl,
          capturedAt: `${timeLabel} WIB`,
          status: isDirectLampiran ? 'done' : 'analyzing',
          confidenceReason: isDirectLampiran
            ? 'Lampiran Dokumentasi Watermark (.docx)'
            : 'Mengklasifikasikan via Vision AI...',
        };
        await saveCapturedPhotoToVault(item, Date.now() + idx);
        return item;
      })
    );

    setCapturedPhotos((prev) => [...prev, ...preparedItems]);
    if (preparedItems.length > 0) {
      setSelectedPhotoId(preparedItems[preparedItems.length - 1].id);
    }

    if (forcedCategory === 'DOKUMENTASI_KEGIATAN') {
      setApiSuccessBanner(
        `${preparedItems.length} Foto Lampiran (${
          captureSource === 'upload' ? 'Upload Manual' : 'Kamera'
        }) disimpan dengan Watermark otomatis & siap dikorelasikan!`
      );
      return;
    }

    for (const item of preparedItems) {
      await routePhotoThroughVisionAI(
        item.id,
        item.cleanSourceDataUrl,
        forcedCategory,
        captureSource,
        false,
        false
      );
    }
  };

  const handleCycleCategoryOverride = async (photoId: string) => {
    const target = capturedPhotos.find((p) => p.id === photoId);
    if (!target) return;

    const currentIdx = CATEGORY_CYCLE.indexOf(target.category);
    const nextCategory = CATEGORY_CYCLE[(currentIdx + 1) % CATEGORY_CYCLE.length];

    let updatedDisplayUrl = target.cleanSourceDataUrl;
    if (nextCategory === 'DOKUMENTASI_KEGIATAN') {
      updatedDisplayUrl = await burnTacticalBannerWatermark(
        target.cleanSourceDataUrl,
        metadata.judulKegiatan,
        metadata.hariTanggal
      );
    }

    if (!isManualEditLockedRef.current) {
      setCustomFullText(null);
    }

    const updatedTarget: CapturedPhotoItem = {
      ...target,
      category: nextCategory,
      displayDataUrl: updatedDisplayUrl,
      status: nextCategory === 'DOKUMENTASI_KEGIATAN' ? 'done' : 'analyzing',
      confidenceReason:
        nextCategory === 'DOKUMENTASI_KEGIATAN'
          ? 'Lampiran Dokumentasi Watermark (.docx)'
          : 'Menganalisis ulang kategori...',
    };
    await saveCapturedPhotoToVault(updatedTarget);

    setCapturedPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? updatedTarget : p))
    );

    if (nextCategory !== 'DOKUMENTASI_KEGIATAN') {
      await routePhotoThroughVisionAI(
        photoId,
        target.cleanSourceDataUrl,
        nextCategory,
        target.captureSource || 'camera',
        false,
        false
      );
    }
  };

  const handleRemovePhoto = async (photoId: string) => {
    if (!isManualEditLockedRef.current) {
      setCustomFullText(null);
    }
    await removeCapturedPhotoFromVault(photoId);
    setCapturedPhotos((prev) => {
      const remaining = prev.filter((p) => p.id !== photoId);
      if (selectedPhotoId === photoId) {
        setSelectedPhotoId(remaining[0]?.id || null);
      }
      return remaining;
    });
  };

  const handleAddScreenFrame = (dataUrl: string) => {
    setScreenFrames((prev) => [...prev.slice(-11), dataUrl]);
    handleAutonomousPhotoCapture([dataUrl], undefined, 'screen');
  };

  const handleRemoveScreenFrame = (idx: number) => {
    setScreenFrames((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddChunk = (newChunk: AudioChunkItem) => {
    setChunks((prev) => [...prev, newChunk]);
  };

  const handleClearChunks = async () => {
    await clearAudioVaultChunks();
    setChunks([]);
    setScreenFrames([]);
    setApiError(null);
  };

  const handleRemoveChunk = async (id: string) => {
    await removeAudioChunkFromVault(id);
    setChunks((prev) => prev.filter((c) => c.id !== id));
  };

  const handleToggleManualLockOrResync = async () => {
    if (isManualEditLocked || customFullText !== null) {
      setIsManualEditLocked(false);
      setCustomFullText(null);
      await handleProcessWithAI(chunksRef.current);
      setApiSuccessBanner(
        'Sinkron Ulang AI Aktif: Laporan & Resume Detil diselaraskan ulang dengan seluruh Chunk Suara + Gambar.'
      );
    } else {
      setIsManualEditLocked(true);
      setApiSuccessBanner(
        'Kunci Edit Manual Aktif: Sinkronisasi otomatis dijeda untuk melindungi suntingan manual Anda.'
      );
    }
  };

  const handleApplyExternalFallbackResult = (pastedText: string) => {
    setCustomFullText(pastedText);
    setIsManualEditLocked(true);
    setReport((prev) => ({
      ...prev,
      detailedResume: pastedText,
    }));
    setApiSuccessBanner(
      'Hasil dari Web AI Alternatif berhasil diterapkan ke Laporan & siap disalin ke WA atau diunduh ke Word (.docx)!'
    );
  };

  const handleCopyWhatsApp = async () => {
    try {
      await navigator.clipboard.writeText(displayedFullReportText);
      setCopiedWA(true);
      setTimeout(() => setCopiedWA(false), 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = displayedFullReportText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedWA(true);
      setTimeout(() => setCopiedWA(false), 2500);
    }
  };

  const handleExportDocx = async () => {
    setIsExportingDocx(true);
    try {
      await exportReportToDocx(
        displayedFullReportText,
        metadata,
        report.executiveSummary,
        report.actionItems,
        attachmentPhotos,
        report.correlationAnalysis,
        report.detailedResume
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  const readFilesAsDataUrls = (files: FileList | null): Promise<string[]> => {
    if (!files || files.length === 0) return Promise.resolve([]);
    const readers: Promise<string>[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      readers.push(
        new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
          r.readAsDataURL(file);
        })
      );
    }
    return Promise.all(readers).then((urls) => urls.filter(Boolean));
  };

  // Post-Exit Screen when user explicitly clicks EXIT
  if (isSessionExited) {
    return (
      <div className="min-h-dvh w-full bg-[#0B1120] text-slate-100 flex items-center justify-center p-4 pt-safe-top pb-safe-bottom">
        <div className="w-full max-w-md bg-[#111827] border border-[#1E293B] rounded-2xl p-6 shadow-2xl space-y-5 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-950/80 border border-[#10B981]/60 flex items-center justify-center shadow-lg">
              <Archive className="w-8 h-8 text-[#10B981]" />
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-base sm:text-lg font-extrabold tracking-wider uppercase text-white">
              Sesi Rapat Telah Diakhiri &amp; Disimpan
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Seluruh perekaman latar belakang telah dihentikan dengan aman. Data chunk rekaman
              (per 5 menit), gambar kamera/upload, dan laporan tetap tersimpan di brankas lokal
              sampai Anda hapus.
            </p>
          </div>

          {lastArchivedSession && (
            <div className="bg-[#0B1120] border border-slate-800 rounded-xl p-3 text-left text-xs space-y-1">
              <div className="text-[10px] font-mono text-[#38BDF8] uppercase">
                Arsip Terakhir ({lastArchivedSession.savedAt})
              </div>
              <div className="font-bold text-slate-100 truncate">
                {lastArchivedSession.metadata.judulKegiatan ||
                  'Laporan Kegiatan DISKOMLEKAU'}
              </div>
              <div className="text-[11px] text-slate-400">
                {lastArchivedSession.chunkCount} Chunk Audio &bull;{' '}
                {lastArchivedSession.attachmentCount} Foto Lampiran Watermark
              </div>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleResumeSavedSessionAfterExit}
              className="w-full py-3 rounded-xl bg-gradient-to-b from-[#2E6DB4] to-[#1E4E87] hover:from-[#3579C4] hover:to-[#245A99] active:scale-98 border border-[#38BDF8]/60 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Buka Kembali Sesi Tersimpan</span>
            </button>

            <button
              type="button"
              onClick={executePermanentResetSession}
              className="w-full py-2.5 rounded-xl bg-red-950/70 hover:bg-red-900 border border-red-700/70 text-red-200 hover:text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Hapus Semua Data &amp; Mulai Sesi Baru</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-[#0B1120] text-slate-100 flex flex-col justify-between">
      {/* Hidden Multi-Image Gallery Picker (Manual Upload -> Autonomous Vision Router) */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          readFilesAsDataUrls(e.target.files).then((valid) => {
            if (valid.length > 0) handleAutonomousPhotoCapture(valid, undefined, 'upload');
          });
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Hidden Direct Multi-Image Lampiran Picker (Manual Upload -> Watermarked Attachments) */}
      <input
        ref={directLampiranInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          readFilesAsDataUrls(e.target.files).then((valid) => {
            if (valid.length > 0) {
              handleAutonomousPhotoCapture(valid, 'DOKUMENTASI_KEGIATAN', 'upload');
            }
          });
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* True Fullscreen 100% Viewport Camera Modal */}
      <FullscreenCameraModal
        isOpen={isFullscreenCameraOpen}
        onClose={() => setIsFullscreenCameraOpen(false)}
        metadata={metadata}
        capturedCount={capturedPhotos.length}
        attachmentCount={attachmentPhotos.length}
        onAutonomousPhotoCapture={handleAutonomousPhotoCapture}
      />

      {/* Explicit Reset Confirmation Modal (Prevents accidental deletion of saved chunks/images) */}
      {showResetConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4"
          onClick={() => setShowResetConfirmModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#111827] border-2 border-red-600/80 rounded-2xl p-5 shadow-2xl space-y-4 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500/70 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold tracking-wider uppercase text-white">
                  Hapus Seluruh Data Tersimpan?
                </h3>
                <p className="text-[11px] text-red-300 font-medium">
                  Data tetap tersimpan sampai Anda hapus
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-200 leading-relaxed">
              Tindakan ini akan menghapus permanen{' '}
              <strong>{chunks.length} Chunk Rekaman Audio</strong>,{' '}
              <strong>{capturedPhotos.length} Gambar (Kamera/Upload)</strong>, serta hasil
              resume rapat saat ini dari brankas lokal.
            </p>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={executePermanentResetSession}
                className="py-2.5 px-3 rounded-xl bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border border-red-400 text-xs font-extrabold uppercase tracking-wider text-white shadow-lg cursor-pointer"
              >
                Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit EXIT Confirmation Modal */}
      {showExitConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4"
          onClick={() => setShowExitConfirmModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#111827] border-2 border-red-600/80 rounded-2xl p-5 shadow-2xl space-y-4 text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-red-950 border border-red-500/70 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold tracking-wider uppercase text-white">
                  Konfirmasi Keluar Sesi (EXIT)
                </h3>
                <p className="text-[11px] text-red-300 font-medium">
                  Proteksi Perekaman &amp; Penyimpanan Data Aktif
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
              Akhiri sesi rapat &amp; simpan arsip? Data chunk &amp; foto tetap tersimpan aman
              sampai Anda hapus.
            </p>

            <div className="bg-[#0B1120] border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 space-y-1">
              <div>
                &bull; Status Rekaman:{' '}
                <strong className={isRecordingActive ? 'text-red-400' : 'text-slate-200'}>
                  {isRecordingActive ? 'SEDANG MEREKAM AKTIF' : 'Siaga'}
                </strong>
              </div>
              <div>
                &bull; Data Sesi Tersimpan:{' '}
                <strong className="text-slate-100">
                  {chunks.length} Chunk Suara &amp; {capturedPhotos.length} Foto (
                  {attachmentPhotos.length} Lampiran .docx)
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowExitConfirmModal(false)}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-200 cursor-pointer"
              >
                Batal
              </button>

              <button
                type="button"
                onClick={handleConfirmSaveAndExit}
                className="py-2.5 px-3 rounded-xl bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border border-red-400 text-xs font-extrabold uppercase tracking-wider text-white shadow-lg cursor-pointer"
              >
                Simpan &amp; Keluar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Tactical Workspace Container with Safe-Area Insets */}
      <div className="w-full max-w-xl lg:max-w-5xl mx-auto flex-1 flex flex-col justify-between px-2 sm:px-3 pt-safe-top pb-safe-bottom space-y-2">
        {/* 1. AEGIS-BRIEF DISKOMLEKAU TACTICAL COMMAND HEADER */}
        <header className="bg-gradient-to-b from-[#162E4D] to-[#0F2138] border border-[#1E293B] rounded-xl px-2.5 sm:px-3 py-2 shadow-lg flex items-center justify-between gap-2">
          <WingCrestEmblem className="w-9 h-9 sm:w-11 sm:h-11 shrink-0" />

          <div className="text-center min-w-0 flex-1">
            <h1 className="text-xs sm:text-lg font-extrabold tracking-wider text-white uppercase leading-tight truncate">
              AEGIS-BRIEF DISKOMLEKAU
            </h1>
            <p className="text-[9px] sm:text-xs font-medium text-[#38BDF8] tracking-wide truncate">
              gemini-3.1-pro-preview &bull; Auto Key Failover &bull; 5-Min Chunk Correlation
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <KomlekOmegaEmblem className="hidden sm:block w-10 h-10" />

            <button
              type="button"
              onClick={() => {
                setGroqApiKeySetting(localStorage.getItem('aegis_groq_api_key') || '');
                setCustomGeminiApiKeySetting(localStorage.getItem('aegis_custom_gemini_key') || '');
                setAiModeSetting((localStorage.getItem('aegis_ai_mode') as any) || 'auto');
                setShowSettingsModal(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-600 text-slate-200 font-bold text-[11px] sm:text-xs tracking-wider uppercase shadow cursor-pointer"
              title="Pengaturan AI & API Key (Settings)"
            >
              <Settings className="w-3.5 h-3.5 text-[#38BDF8]" />
              <span className="hidden sm:inline">Settings</span>
            </button>

            <button
              type="button"
              onClick={() => setShowExitConfirmModal(true)}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-95 border-2 border-red-400/90 text-white font-black text-[11px] sm:text-xs tracking-wider uppercase shadow-[0_0_14px_rgba(239,68,68,0.45)] cursor-pointer"
              title="Akhiri Sesi Rapat & Simpan Arsip (EXIT)"
            >
              <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>EXIT</span>
            </button>
          </div>
        </header>

        {/* Top Tactical Session Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#111827] border border-[#1E293B] rounded-xl px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowResetConfirmModal(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/75 hover:bg-red-900 active:scale-95 border border-red-700/70 text-red-200 hover:text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer"
              title="Hapus seluruh data sesi tersimpan (Chunk Audio, Foto & Laporan) dan mulai sesi rapat baru"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Sesi Baru / Hapus Data</span>
            </button>

            <PWAInstallButton />

            {!geminiFailure && (
              <button
                type="button"
                onClick={() =>
                  setGeminiFailure({
                    occurred: true,
                    message:
                      'Mode Alternatif Web AI Gratis dibuka manual oleh operator.',
                    failureReason: 'MANUAL_OPEN',
                    model: 'gemini-3.1-pro-preview',
                    timestamp: new Date().toLocaleTimeString('id-ID'),
                  })
                }
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-amber-300 text-[10px] font-semibold cursor-pointer"
                title="Buka daftar situs AI gratis pengganti Gemini kapan saja"
              >
                <Globe className="w-3 h-3 text-[#F59E0B]" />
                <span>Web AI Alternatif</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreenCameraOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 border border-amber-300/80 text-slate-950 text-[11px] font-extrabold tracking-wide shadow cursor-pointer"
            title="Buka Kamera Fullscreen 100% Layar (Multi-Shot Auto-OCR / Paparan / Lampiran)"
          >
            <Camera className="w-3.5 h-3.5 stroke-[2.3]" />
            <span>Ambil Foto (Fullscreen Cam)</span>
          </button>
        </div>

        <OfflineIndicator />

        {/* Status Alerts */}
        {apiError && (
          <div className="flex items-center justify-between gap-2 bg-red-950/85 border border-red-700 rounded-lg px-2.5 py-1.5 text-[11px] text-red-200">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span>{apiError}</span>
            </div>
            <button
              type="button"
              onClick={() => setApiError(null)}
              className="text-red-300 hover:text-white font-bold cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {apiSuccessBanner && (
          <div className="flex items-center justify-between gap-2 bg-emerald-950/85 border border-[#10B981]/60 rounded-lg px-2.5 py-1.5 text-[11px] text-emerald-200">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
              <span>{apiSuccessBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setApiSuccessBanner(null)}
              className="text-emerald-300 hover:text-white font-bold cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* Free Web AI Alternatives Panel (Automatically appears whenever Gemini fails) */}
        {geminiFailure && (
          <GeminiFallbackPanel
            failureInfo={geminiFailure}
            chunks={chunks}
            capturedPhotos={capturedPhotos}
            metadata={metadata}
            onDismiss={() => setGeminiFailure(null)}
            onApplyExternalResult={handleApplyExternalFallbackResult}
            onRetryGemini={() => {
              setGeminiFailure(null);
              handleProcessWithAI(chunksRef.current);
            }}
          />
        )}

        {/* Responsive Main Tactical Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start flex-1">
          <div className="lg:col-span-6 space-y-2">
            {/* 2. METADATA RAPAT PANEL */}
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl px-3 py-2 shadow-inner space-y-1.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h2 className="text-[11px] font-bold tracking-wider text-slate-200 uppercase">
                  METADATA RAPAT (LIVE SYNC &amp; WATERMARK)
                </h2>

                <button
                  type="button"
                  onClick={() => setShowExtraMetadata((prev) => !prev)}
                  className="inline-flex items-center gap-0.5 text-[10px] text-[#38BDF8] hover:text-sky-300 font-semibold cursor-pointer"
                >
                  <span>
                    {showExtraMetadata
                      ? 'Sembunyikan Detail'
                      : 'Tempat, Peserta & Glosarium'}
                  </span>
                  {showExtraMetadata ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="grid grid-cols-12 items-center gap-1">
                  <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                    <span>Judul</span>
                    <span>:</span>
                  </label>
                  <div className="col-span-9 sm:col-span-10">
                    <input
                      type="text"
                      value={metadata.judulKegiatan}
                      onChange={(e) => handleFieldChange('judulKegiatan', e.target.value)}
                      placeholder="Ketik judul atau ambil foto Undangan (OCR)..."
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-100 font-medium placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 items-center gap-1">
                  <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                    <span>Hari/Tgl</span>
                    <span>:</span>
                  </label>
                  <div className="col-span-5 sm:col-span-6">
                    <input
                      type="text"
                      value={metadata.hariTanggal}
                      onChange={(e) => handleFieldChange('hariTanggal', e.target.value)}
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-100"
                    />
                  </div>
                  <label className="col-span-1 sm:col-span-1 text-slate-300 font-medium text-right">
                    Jam
                  </label>
                  <div className="col-span-3 sm:col-span-3">
                    <input
                      type="text"
                      value={metadata.pukul}
                      onChange={(e) => handleFieldChange('pukul', e.target.value)}
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-1.5 py-1 text-[11px] text-slate-100 text-center"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-12 items-center gap-1">
                  <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                    <span>Pimpinan</span>
                    <span>:</span>
                  </label>
                  <div className="col-span-9 sm:col-span-10">
                    <input
                      type="text"
                      value={metadata.pimpinanRapat}
                      onChange={(e) => handleFieldChange('pimpinanRapat', e.target.value)}
                      placeholder="Nama / Jabatan Pimpinan Rapat..."
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
                    />
                  </div>
                </div>

                {showExtraMetadata && (
                  <div className="pt-1 space-y-1 border-t border-slate-800/80">
                    <div className="grid grid-cols-12 items-center gap-1">
                      <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                        <span>Tempat</span>
                        <span>:</span>
                      </label>
                      <div className="col-span-5 sm:col-span-6">
                        <input
                          type="text"
                          value={metadata.tempat}
                          onChange={(e) => handleFieldChange('tempat', e.target.value)}
                          placeholder="Ruang Rapat / Vicon Zoom..."
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
                        />
                      </div>
                      <label className="col-span-2 sm:col-span-2 text-slate-300 font-medium text-right">
                        Salam:
                      </label>
                      <div className="col-span-2 sm:col-span-2">
                        <select
                          value={metadata.waktuSalam}
                          onChange={(e) =>
                            handleFieldChange('waktuSalam', e.target.value as WaktuSalam)
                          }
                          className="w-full bg-[#0B1120] border border-slate-700/90 rounded px-1 py-1 text-[11px] text-slate-100"
                        >
                          <option value="pagi">pagi</option>
                          <option value="siang">siang</option>
                          <option value="malam">malam</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-12 items-center gap-1">
                      <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                        <span>Peserta</span>
                        <span>:</span>
                      </label>
                      <div className="col-span-9 sm:col-span-10">
                        <input
                          type="text"
                          value={metadata.pesertaRapat}
                          onChange={(e) => handleFieldChange('pesertaRapat', e.target.value)}
                          placeholder="Daftar peserta / satuan..."
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-12 items-center gap-1">
                      <label className="col-span-3 sm:col-span-2 text-slate-300 font-medium flex justify-between">
                        <span>Glosarium</span>
                        <span>:</span>
                      </label>
                      <div className="col-span-9 sm:col-span-10">
                        <input
                          type="text"
                          value={metadata.customGlossary}
                          onChange={(e) => handleFieldChange('customGlossary', e.target.value)}
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-1 text-[11px] text-slate-300"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 3. ANALYZER & CONTROLS (5-Minute Chunking + Background Parallel Analysis + Persistent Vault) */}
            <AudioRecorder
              chunks={chunks}
              screenFrames={screenFrames}
              onAddScreenFrame={handleAddScreenFrame}
              onRemoveScreenFrame={handleRemoveScreenFrame}
              onAddChunk={handleAddChunk}
              onRotateChunkReady={handleRotateChunkReady}
              onFinalStopReady={handleFinalStopReady}
              onClearChunks={handleClearChunks}
              onRemoveChunk={handleRemoveChunk}
              onRetryChunkAnalysis={handleRetrySingleChunk}
              onProcessWithAI={handleProcessWithAI}
              isProcessingAI={isProcessingAI}
              backgroundProcessingCount={backgroundChunkIds.length}
              processingStatusText={processingStatusText}
              onRecordingStateChange={setIsRecordingActive}
              registerStopRecordingRef={stopRecordingRef}
            />
          </div>

          {/* 4. LIVE EDITABLE OFFICIAL REPORT + AUDIO-VISUAL CORRELATION + DETAILED RESUME */}
          <div className="lg:col-span-6 h-full space-y-2">
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-2.5 sm:p-3 shadow-inner flex flex-col space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold tracking-wider text-[#38BDF8] uppercase">
                  LAPORAN PELAKSANAAN KEGIATAN:
                </span>

                <button
                  type="button"
                  onClick={handleToggleManualLockOrResync}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide border transition-colors cursor-pointer ${
                    isManualEditLocked || customFullText !== null
                      ? 'bg-[#F59E0B]/20 hover:bg-[#F59E0B]/30 border-[#F59E0B] text-amber-300'
                      : 'bg-slate-800/90 hover:bg-slate-700 border-slate-600 text-slate-200'
                  }`}
                  title={
                    isManualEditLocked || customFullText !== null
                      ? 'Buka kunci manual & sinkronkan ulang laporan dengan seluruh Chunk Suara + Gambar'
                      : 'Kunci suntingan manual agar tidak ditimpa otomatis oleh Auto-Sync AI'
                  }
                >
                  {isManualEditLocked || customFullText !== null ? (
                    <>
                      <RefreshCw className="w-3 h-3 text-[#F59E0B]" />
                      <span>Sinkron Ulang AI</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3 h-3 text-slate-300" />
                      <span>Kunci Edit Manual</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#0B1120] border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono">
                <div className="inline-flex items-center gap-1.5 text-emerald-300">
                  {isCrossModalSyncing || isProcessingAI || backgroundChunkIds.length > 0 ? (
                    <Loader2 className="w-3 h-3 text-[#38BDF8] animate-spin shrink-0" />
                  ) : (
                    <Zap className="w-3 h-3 text-[#F59E0B] shrink-0" />
                  )}
                  <span>
                    Tersinkronisasi: {syncedAudioCount}/{chunks.length} Chunk 5m +{' '}
                    {scannedImageCount} Gambar
                  </span>
                </div>

                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded ${
                    isManualEditLocked || customFullText !== null
                      ? 'bg-amber-950/90 text-amber-300 border border-amber-700/60'
                      : 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/50'
                  }`}
                >
                  {isManualEditLocked || customFullText !== null
                    ? 'EDIT MANUAL TERKUNCI'
                    : 'AUTO-SYNC AKTIF'}
                </span>
              </div>

              <textarea
                rows={10}
                value={displayedFullReportText}
                onChange={(e) => {
                  setCustomFullText(e.target.value);
                  setIsManualEditLocked(true);
                }}
                className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded-lg p-2.5 text-xs text-slate-100 leading-relaxed resize-y font-sans"
              />

              {/* Correlation & Detailed Resume Panel */}
              {(report.correlationAnalysis || report.detailedResume) && (
                <div className="bg-[#0B1120] border border-[#38BDF8]/40 rounded-lg p-2.5 space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowDetailedResumeDrawer((p) => !p)}
                    className="w-full flex items-center justify-between text-[11px] font-bold text-[#38BDF8] uppercase tracking-wider cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-[#F59E0B]" />
                      Korelasi Audio-Visual &amp; Resume Detil
                    </span>
                    {showDetailedResumeDrawer ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  {showDetailedResumeDrawer && (
                    <div className="space-y-2 pt-1 border-t border-slate-800 max-h-60 overflow-y-auto pr-1 text-[11px]">
                      {report.correlationAnalysis && (
                        <div className="space-y-1">
                          <div className="inline-flex items-center gap-1 text-[10px] font-bold text-[#F59E0B] uppercase">
                            <GitCompare className="w-3 h-3" />
                            <span>Korelasi Audio (5-Menit Chunks) vs Gambar Kamera/Upload:</span>
                          </div>
                          <p className="text-slate-200 leading-relaxed whitespace-pre-line">
                            {report.correlationAnalysis}
                          </p>
                        </div>
                      )}

                      {report.detailedResume && (
                        <div className="space-y-1 pt-1 border-t border-slate-800/80">
                          <div className="text-[10px] font-bold text-emerald-300 uppercase">
                            Resume Detil Rapat:
                          </div>
                          <p className="text-slate-200 leading-relaxed whitespace-pre-line">
                            {report.detailedResume}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Synchronized Action Items */}
              {report.actionItems && report.actionItems.length > 0 && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-2 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#F59E0B] uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="w-3.5 h-3.5" />
                      Tindak Lanjut Terpadu (Suara + Gambar): {report.actionItems.length}
                    </span>
                    <span className="text-[9px] font-mono text-slate-400">
                      Otomatis masuk Tabel Word (.docx)
                    </span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                    {report.actionItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="text-[10px] bg-[#111827] border border-slate-800/90 rounded px-2 py-1 flex flex-wrap items-center justify-between gap-1"
                      >
                        <span className="text-slate-100 font-medium">
                          {idx + 1}. {item.task}
                        </span>
                        <span className="font-mono text-[9px] text-[#38BDF8]">
                          PIC: {item.pic || '-'} | Target: {item.deadline || '-'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* 5. COLLAPSIBLE / FOLDING DATA CAPTURE TRAY */}
        <CollapsibleDataCaptureTray
          photos={capturedPhotos}
          selectedPhotoId={selectedPhotoId}
          onSelectPhoto={setSelectedPhotoId}
          onCycleCategoryOverride={handleCycleCategoryOverride}
          onRemovePhoto={handleRemovePhoto}
          onOpenFullscreenCamera={() => setIsFullscreenCameraOpen(true)}
          onOpenGalleryPicker={() => galleryInputRef.current?.click()}
          onOpenDirectLampiranPicker={() => directLampiranInputRef.current?.click()}
        />

        {/* 6. BOTTOM PRIMARY ACTION BAR */}
        <footer className="grid grid-cols-2 gap-2.5 pt-0.5 pb-1">
          <button
            type="button"
            onClick={handleCopyWhatsApp}
            className="min-h-[46px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-b from-[#2E6DB4] to-[#1E4E87] hover:from-[#3579C4] hover:to-[#245A99] active:scale-[0.99] border border-[#38BDF8]/60 text-white font-bold text-xs tracking-wide shadow-md transition-all cursor-pointer"
          >
            {copiedWA ? (
              <>
                <Check className="w-4 h-4 text-emerald-300 shrink-0" />
                <span className="leading-tight text-left">
                  BERHASIL
                  <br />
                  DISALIN!
                </span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4 shrink-0" />
                <span className="leading-tight text-center">
                  SALIN LAPORAN
                  <br />
                  (WA)
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleExportDocx}
            disabled={isExportingDocx}
            className="min-h-[46px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gradient-to-b from-[#4B8346] to-[#356131] hover:from-[#569450] hover:to-[#3E7039] active:scale-[0.99] border border-[#10B981]/60 text-white font-bold text-xs tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-50"
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span className="leading-tight text-center">
              {isExportingDocx ? (
                'MENYIAPKAN...'
              ) : (
                <>
                  UNDUH WORD (.docx)
                  <br />
                  <span className="text-[10px] font-mono text-emerald-200">
                    ({attachmentPhotos.length} Foto Lampiran)
                  </span>
                </>
              )}
            </span>
          </button>
        </footer>
      </div>
    </div>
  );
}
