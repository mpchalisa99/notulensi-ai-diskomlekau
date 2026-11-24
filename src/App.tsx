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
  Settings,
} from 'lucide-react';
import type {
  AudioChunkItem,
  CapturedPhotoItem,
  MeetingMetadata,
  MeetingReportResult,
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
  clearAudioVaultChunks,
  loadAudioChunksFromVault,
  removeAudioChunkFromVault,
  saveAudioChunkToVault,
  saveSessionDraftToArchive,
  saveMeetingBundle,
  loadAllMeetingBundles,
  deleteMeetingBundle,
  type ArchivedSessionRecord,
  type MeetingBundleRecord,
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

const CATEGORY_CYCLE: VisionCategory[] = [
  'OCR_UNDANGAN',
  'MATERI_PAPARAN',
  'DOKUMENTASI_KEGIATAN',
];

export interface BackupAiSettings {
  primaryProvider: 'gemini' | 'groq' | 'openai';
  groqApiKey: string;
  openaiApiKey: string;
  priorityMode: 'automatic' | 'force_groq' | 'force_openai';
}

const STORAGE_BACKUP_SETTINGS_KEY = 'aegis_ai_backup_settings_v1';

export default function App() {
  // Initialize with clean, non-stale session state bound to current system clock
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

  const [isFullscreenCameraOpen, setIsFullscreenCameraOpen] = useState(false);
  const [showExtraMetadata, setShowExtraMetadata] = useState(false);

  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState(false);
  const [isSessionExited, setIsSessionExited] = useState(false);
  const [lastArchivedSession, setLastArchivedSession] =
    useState<ArchivedSessionRecord | null>(null);

  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [isCrossModalSyncing, setIsCrossModalSyncing] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccessBanner, setApiSuccessBanner] = useState<string | null>(null);
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash');
  const [savedMeetingBundles, setSavedMeetingBundles] = useState<MeetingBundleRecord[]>([]);
  const [showSavedBundlesModal, setShowSavedBundlesModal] = useState(false);

  const [backupSettings, setBackupSettings] = useState<BackupAiSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_BACKUP_SETTINGS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      primaryProvider: 'gemini',
      groqApiKey: '',
      openaiApiKey: '',
      priorityMode: 'automatic',
    };
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_BACKUP_SETTINGS_KEY, JSON.stringify(backupSettings));
    } catch {}
  }, [backupSettings]);

  useEffect(() => {
    loadAllMeetingBundles().then(setSavedMeetingBundles).catch(() => {});
  }, []);

  const handleRetryBundleAnalysis = async (bundle: MeetingBundleRecord) => {
    setShowSavedBundlesModal(false);
    setMetadata(bundle.metadata);
    setCapturedPhotos(bundle.photos);
    const rehydratedChunks: AudioChunkItem[] = bundle.chunks.map((c) => ({
      id: c.id,
      index: c.index,
      blob: c.blob,
      mimeType: c.mimeType,
      timestampLabel: c.timestampLabel,
      durationSec: c.durationSec,
      sizeBytes: c.sizeBytes,
      status: 'ready',
    }));
    setChunks(rehydratedChunks);
    await handleProcessWithAI(rehydratedChunks);
  };

  const handleDownloadBundleFiles = async (bundle: MeetingBundleRecord) => {
    try {
      bundle.chunks.forEach((chunk, idx) => {
        const url = URL.createObjectURL(chunk.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bundle.metadata.judulKegiatan || 'rapat'}_audio_segmen_${idx + 1}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      bundle.photos.forEach((photo, idx) => {
        const a = document.createElement('a');
        a.href = photo.displayDataUrl;
        a.download = `${bundle.metadata.judulKegiatan || 'rapat'}_foto_${idx + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
      setApiSuccessBanner('Berhasil mengunduh seluruh file audio dan foto mentah dari rapat tersimpan.');
    } catch (err: any) {
      setApiError('Gagal mengunduh file rapat: ' + err?.message);
    }
  };

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const directLampiranInputRef = useRef<HTMLInputElement | null>(null);
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);

  const metadataRef = useRef<MeetingMetadata>(metadata);
  const capturedPhotosRef = useRef<CapturedPhotoItem[]>(capturedPhotos);
  const chunksRef = useRef<AudioChunkItem[]>(chunks);
  const isManualEditLockedRef = useRef<boolean>(isManualEditLocked);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  useEffect(() => {
    isManualEditLockedRef.current = isManualEditLocked;
  }, [isManualEditLocked]);

  // Always reset to a clean new session on app startup and drop old data
  useEffect(() => {
    clearAudioVaultChunks().catch(() => {});
    const now = new Date();
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setIsManualEditLocked(false);
    setApiError(null);
    setIsSessionExited(false);
    setMetadata(createCleanSessionMetadata(now));
    setReport(createCleanSessionReport());
  }, []);

  // Derived array of all LAMPIRAN / DOKUMENTASI_KEGIATAN photos (unlimited count: 2, 5, 10+)
  const attachmentPhotos = capturedPhotos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  // Count of synchronized audio segments and scanned images
  const syncedAudioCount = chunks.filter((c) => c.status === 'done').length;
  const scannedImageCount = capturedPhotos.filter((p) => p.status === 'done').length;

  // Live dynamic report text bound strictly to current metadata, report.isiKegiatan, and attachmentPhotos.length
  const autoRenderedReportText = buildOfficialReportText(
    metadata,
    report.isiKegiatan,
    attachmentPhotos.length
  );
  const displayedFullReportText =
    customFullText !== null ? customFullText : autoRenderedReportText;

  // Session Lock: Intercept accidental back-swipe (`popstate`) and tab closure (`beforeunload`) until explicit EXIT
  useEffect(() => {
    if (isSessionExited) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        isRecordingActive ||
        chunks.length > 0 ||
        capturedPhotos.length > 0 ||
        Boolean(metadata.judulKegiatan.trim())
      ) {
        e.preventDefault();
        e.returnValue =
          'Perekaman / Sesi Rapat sedang aktif. Gunakan tombol EXIT untuk menyimpan dan keluar.';
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
  }, [
    isSessionExited,
    isRecordingActive,
    chunks.length,
    capturedPhotos.length,
    metadata.judulKegiatan,
  ]);

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
        prev.map((photo) =>
          photo.category === 'DOKUMENTASI_KEGIATAN' && watermarkedMap[photo.id]
            ? { ...photo, displayDataUrl: watermarkedMap[photo.id] }
            : photo
        )
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

  // Sesi Baru / Reset Data: Completely clears all previous audio, IndexedDB vault, photos, OCR, and report state
  const handleResetSession = async () => {
    const now = new Date();
    await clearAudioVaultChunks();
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setIsManualEditLocked(false);
    setApiError(null);
    setIsSessionExited(false);
    setMetadata(createCleanSessionMetadata(now));
    setReport(createCleanSessionReport());
    setApiSuccessBanner(
      'Sesi Baru dimulai: Seluruh data rapat sebelumnya, brankas audio, dan tangkapan foto telah di-reset bersih.'
    );
  };

  // Explicit EXIT Handler: Stops MediaRecorder, releases WakeLock, clears MediaSession, archives draft, and exits session
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

    await clearAudioVaultChunks();
    setIsRecordingActive(false);
    setIsSessionExited(true);
  };

  const handleResumeOrStartNewAfterExit = () => {
    const now = new Date();
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setIsManualEditLocked(false);
    setApiError(null);
    setMetadata(createCleanSessionMetadata(now));
    setReport(createCleanSessionReport());
    setIsSessionExited(false);
  };

  const parseApiResponseSafe = async (response: Response, contextLabel: string) => {
    const rawText = await response.text();
    const trimmed = rawText.trim();

    if (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html')
    ) {
      throw new Error(
        `${contextLabel}: Server mengembalikan halaman HTML (HTTP ${response.status}). Silakan coba kembali.`
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        `${contextLabel}: Format respons server tidak valid (HTTP ${response.status}).`
      );
    }

    if (!response.ok || parsed?.error) {
      throw new Error(
        parsed?.error || `Gagal memproses ${contextLabel} (HTTP ${response.status})`
      );
    }

    return parsed;
  };

  /**
   * Cross-Modal Fusion & Real-Time Re-Synchronization Engine:
   * Combines ALL active session inputs (`buildUnifiedSessionContext`) and reconciles audio + OCR + slides.
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

      // Only invoke cross-modal fusion if there is at least one audio transcript or scanned OCR/Slide
      if (!hasAudioKnowledge && !hasOcrKnowledge && !hasSlideKnowledge) {
        return;
      }

      // If only OCR_UNDANGAN exists (no audio and no slide paparan yet), metadata is already synced directly
      if (!hasAudioKnowledge && !hasSlideKnowledge && hasOcrKnowledge && !forceUnlockManualEdit) {
        return;
      }

      setIsCrossModalSyncing(true);
      try {
        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            mode: 'cross_modal_fusion',
            unifiedContext,
            metadata: activeMeta,
            preferredModel: selectedModel,
            groqApiKey: backupSettings.groqApiKey,
            openaiApiKey: backupSettings.openaiApiKey,
            priorityMode: backupSettings.priorityMode,
          }),
        });

        const fused = (await parseApiResponseSafe(
          response,
          'Cross-Modal Fusion'
        )) as MeetingReportResult;

        const now = new Date();
        const currentIso = getTodayIsoDate(now);

        // Apply fused metadata & report unless manual edit lock is active
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
            actionItems:
              Array.isArray(fused.actionItems) && fused.actionItems.length > 0
                ? fused.actionItems
                : prev.actionItems,
            cleanTranscript:
              fused.cleanTranscript?.trim() || prev.cleanTranscript,
          }));
        }
      } catch (err: any) {
        console.warn('Cross-Modal Fusion background warning:', err?.message);
      } finally {
        setIsCrossModalSyncing(false);
      }
    },
    []
  );

  // Routes a newly captured photo through Gemini Vision using current session context & triggers Auto-Sync
  const routePhotoThroughVisionAI = async (
    photoId: string,
    cleanDataUrl: string,
    overrideCategory?: VisionCategory
  ) => {
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
          overrideCategory,
          paparanKnowledge: currentSessionPaparan,
          metadata: currentMeta,
          preferredModel: selectedModel,
          groqApiKey: backupSettings.groqApiKey,
          openaiApiKey: backupSettings.openaiApiKey,
          priorityMode: backupSettings.priorityMode,
        }),
      });

      const result = (await parseApiResponseSafe(
        response,
        'Autonomous Vision Router'
      )) as VisionRouterResponse;

      const resolvedCategory: VisionCategory =
        overrideCategory || result.category || 'DOKUMENTASI_KEGIATAN';

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

      // Pipeline A: OCR_UNDANGAN -> Immediately update metadata & trigger Cross-Modal Fusion if audio/slides exist
      if (resolvedCategory === 'OCR_UNDANGAN') {
        if (!isManualEditLockedRef.current) {
          setCustomFullText(null);
        }
        setMetadata(updatedMeta);
        setApiSuccessBanner(
          'OCR Undangan Selesai: Metadata & Ejaan Otoritatif otomatis disinkronkan!'
        );
      }

      // Pipeline B: MATERI_PAPARAN -> Synthesize slide knowledge into current session report
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
          'Materi Paparan Dianalisis: Melakukan Cross-Modal Fusion dengan transkrip suara & undangan...'
        );
      }

      // Pipeline C: DOKUMENTASI_KEGIATAN -> Burn watermark & queue in attachmentPhotos[] for .docx
      if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
        if (!isManualEditLockedRef.current) {
          setCustomFullText(null);
        }
        setApiSuccessBanner(
          'Lampiran Dokumentasi ditambahkan: Watermark [JUDUL - TANGGAL] disematkan & siap diekspor ke Word (.docx).'
        );
      }

      const updatedPhotoFields: Partial<CapturedPhotoItem> = {
        category: resolvedCategory,
        displayDataUrl: finalDisplayUrl,
        status: 'done',
        confidenceReason: result.confidenceReason || resolvedCategory,
        extractedText:
          result.extractedKnowledge ||
          result.judulKegiatan ||
          result.confidenceReason,
        isiKegiatanDraft: result.isiKegiatanDraft || '',
        extractedMetadata: {
          judulKegiatan: result.judulKegiatan,
          hariTanggal: result.hariTanggal,
          pukul: result.pukul,
          tempat: result.tempat,
          pimpinanRapat: result.pimpinanRapat,
          pesertaRapat: result.pesertaRapat,
        },
      };

      const nextPhotosSnapshot = capturedPhotosRef.current.map((p) =>
        p.id === photoId ? { ...p, ...updatedPhotoFields } : p
      );

      setCapturedPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, ...updatedPhotoFields } : p))
      );

      // Automatic Real-Time Re-Synchronization Trigger whenever OCR_UNDANGAN or MATERI_PAPARAN finishes scanning
      if (
        resolvedCategory === 'OCR_UNDANGAN' ||
        resolvedCategory === 'MATERI_PAPARAN'
      ) {
        await runCrossModalFusionSync(
          chunksRef.current,
          nextPhotosSnapshot,
          updatedMeta
        );
      }
    } catch (err: any) {
      const fallbackWatermarked = await burnTacticalBannerWatermark(
        cleanDataUrl,
        metadataRef.current.judulKegiatan,
        metadataRef.current.hariTanggal
      );
      if (!isManualEditLockedRef.current) {
        setCustomFullText(null);
      }
      setCapturedPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                category: overrideCategory || 'DOKUMENTASI_KEGIATAN',
                displayDataUrl: fallbackWatermarked,
                status: 'done',
                confidenceReason: 'Tersimpan dengan Watermark Taktis',
              }
            : p
        )
      );
      setApiError(
        err?.message || 'Gagal menjalankan klasifikasi AI; foto disimpan sebagai Lampiran.'
      );
    }
  };

  // Unlimited Multi-Photo Capture & Batch Addition without overwriting previous photos
  const handleAutonomousPhotoCapture = async (
    rawDataUrls: string[],
    forcedCategory?: VisionCategory
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
          cleanSourceDataUrl: cleanDataUrl,
          displayDataUrl: watermarkedDataUrl,
          capturedAt: `${timeLabel} WIB`,
          status: isDirectLampiran ? 'done' : 'analyzing',
          confidenceReason: isDirectLampiran
            ? 'Lampiran Dokumentasi Watermark (.docx)'
            : 'Mengklasifikasikan via Vision AI...',
        };
        return item;
      })
    );

    setCapturedPhotos((prev) => [...prev, ...preparedItems]);
    if (preparedItems.length > 0) {
      setSelectedPhotoId(preparedItems[preparedItems.length - 1].id);
    }

    if (forcedCategory === 'DOKUMENTASI_KEGIATAN') {
      setApiSuccessBanner(
        `${preparedItems.length} Foto Lampiran berhasil ditambahkan dengan Watermark otomatis ([JUDUL - TANGGAL])!`
      );
      return;
    }

    for (const item of preparedItems) {
      await routePhotoThroughVisionAI(
        item.id,
        item.cleanSourceDataUrl,
        forcedCategory
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
    setCapturedPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId
          ? {
              ...p,
              category: nextCategory,
              displayDataUrl: updatedDisplayUrl,
              status: nextCategory === 'DOKUMENTASI_KEGIATAN' ? 'done' : 'analyzing',
              confidenceReason:
                nextCategory === 'DOKUMENTASI_KEGIATAN'
                  ? 'Lampiran Dokumentasi Watermark (.docx)'
                  : 'Menganalisis ulang kategori...',
            }
          : p
      )
    );

    if (nextCategory !== 'DOKUMENTASI_KEGIATAN') {
      await routePhotoThroughVisionAI(photoId, target.cleanSourceDataUrl, nextCategory);
    }
  };

  const handleRemovePhoto = (photoId: string) => {
    if (!isManualEditLockedRef.current) {
      setCustomFullText(null);
    }
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
    handleAutonomousPhotoCapture([dataUrl]);
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

  /**
   * Multi-Modal Audio Transcription & Cross-Modal Fusion Engine:
   * Transcribes any unprocessed audio chunks using OCR_UNDANGAN + MATERI_PAPARAN as Visual Spelling Anchors,
   * then runs `runCrossModalFusionSync` across the unified session context.
   */
  const handleProcessWithAI = async (overrideChunks?: AudioChunkItem[]) => {
    const targetChunks = overrideChunks || chunksRef.current;
    if (targetChunks.length === 0) {
      // Even if there are 0 audio chunks, allow re-syncing scanned OCR + Slide images
      if (capturedPhotosRef.current.length > 0) {
        await runCrossModalFusionSync(
          chunksRef.current,
          capturedPhotosRef.current,
          metadataRef.current,
          true
        );
      }
      return;
    }

    setIsProcessingAI(true);
    setApiError(null);
    setApiSuccessBanner(null);

    const currentMeta = metadataRef.current;
    const meetingId = `meeting_${Date.now()}`;
    const bundleRecord: MeetingBundleRecord = {
      id: meetingId,
      savedAt: new Date().toISOString(),
      metadata: currentMeta,
      chunks: targetChunks.map((c) => ({
        id: c.id,
        index: c.index,
        blob: c.blob,
        mimeType: c.mimeType,
        timestampLabel: c.timestampLabel,
        durationSec: c.durationSec,
        sizeBytes: c.sizeBytes,
      })),
      photos: capturedPhotosRef.current,
      status: 'analyzing',
    };

    try {
      await saveMeetingBundle(bundleRecord);
      loadAllMeetingBundles().then(setSavedMeetingBundles).catch(() => {});

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

      const updatedChunksList: AudioChunkItem[] = [...targetChunks];

      for (let i = 0; i < updatedChunksList.length; i++) {
        const chunk = updatedChunksList[i];

        // If this chunk was already transcribed in this session, reuse its stored transcript & summary
        if (chunk.status === 'done' && chunk.transcript && chunk.isiKegiatanSummary) {
          continue;
        }

        setProcessingStatusText(
          `Transkripsi & Rekonsiliasi Ejaan Suara (#${i + 1}/${updatedChunksList.length})...`
        );

        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? { ...c, status: 'processing' } : c))
        );

        const audioBase64 = await blobToBase64(chunk.blob);
        const framesToSend = [
          ...currentSessionVisualFrames,
          ...(chunk.screenFrames && chunk.screenFrames.length > 0
            ? chunk.screenFrames.slice(-3)
            : screenFrames.slice(-3)),
        ].slice(0, 4);

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
            metadata: currentMeta,
            chunkIndex: i,
            totalChunks: updatedChunksList.length,
            preferredModel: selectedModel,
            groqApiKey: backupSettings.groqApiKey,
            openaiApiKey: backupSettings.openaiApiKey,
            priorityMode: backupSettings.priorityMode,
          }),
        });

        const data = (await parseApiResponseSafe(
          response,
          `Segmen Suara #${i + 1}`
        )) as MeetingReportResult;

        const enrichedChunk: AudioChunkItem = {
          ...chunk,
          status: 'done',
          transcript: data.cleanTranscript || '',
          isiKegiatanSummary: data.isiKegiatan || '',
          extractedActionItems: Array.isArray(data.actionItems)
            ? data.actionItems
            : [],
        };

        updatedChunksList[i] = enrichedChunk;
        saveAudioChunkToVault(enrichedChunk);

        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? enrichedChunk : c))
        );
      }

      // Now execute Unified Cross-Modal Fusion across all audio segments + OCR_UNDANGAN + MATERI_PAPARAN
      setProcessingStatusText(
        'Fusi Lintas-Modal (Suara + OCR Undangan + Slide Paparan)...'
      );

      const unifiedContext = buildUnifiedSessionContext(
        updatedChunksList,
        capturedPhotosRef.current,
        metadataRef.current
      );

      const fusionResponse = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          mode: 'cross_modal_fusion',
          unifiedContext,
          metadata: metadataRef.current,
          preferredModel: selectedModel,
          groqApiKey: backupSettings.groqApiKey,
          openaiApiKey: backupSettings.openaiApiKey,
          priorityMode: backupSettings.priorityMode,
        }),
      });

      const finalResult = (await parseApiResponseSafe(
        fusionResponse,
        'Cross-Modal Fusion'
      )) as MeetingReportResult;

      bundleRecord.status = 'completed';
      bundleRecord.report = finalResult;
      await saveMeetingBundle(bundleRecord);
      loadAllMeetingBundles().then(setSavedMeetingBundles).catch(() => {});

      const now = new Date();
      const currentIso = getTodayIsoDate(now);

      if (!isManualEditLockedRef.current) {
        setCustomFullText(null);
      }

      setMetadata((prev) => ({
        ...prev,
        waktuSalam: detectWaktuSalam(now),
        tanggalIso: currentIso,
        hariTanggal:
          finalResult.hariTanggal?.trim() ||
          prev.hariTanggal ||
          formatIndonesianDate(currentIso),
        pukul:
          finalResult.pukul?.trim() || prev.pukul || detectCurrentTimeRange(now),
        judulKegiatan:
          finalResult.judulKegiatan?.trim() || prev.judulKegiatan || '',
        pimpinanRapat:
          finalResult.pimpinanRapat?.trim() || prev.pimpinanRapat || '',
        pesertaRapat:
          finalResult.pesertaRapat?.trim() || prev.pesertaRapat || '',
        tempat:
          finalResult.tempat?.trim() ||
          prev.tempat ||
          (screenFrames.length > 0 ? 'Vicon Zoom Meeting' : ''),
      }));

      if (!isManualEditLockedRef.current) {
        setReport({
          judulKegiatan: finalResult.judulKegiatan,
          hariTanggal: finalResult.hariTanggal,
          pukul: finalResult.pukul,
          pimpinanRapat: finalResult.pimpinanRapat,
          pesertaRapat: finalResult.pesertaRapat,
          tempat: finalResult.tempat,
          isiKegiatan: finalResult.isiKegiatan || '',
          executiveSummary: finalResult.executiveSummary || '',
          actionItems: Array.isArray(finalResult.actionItems)
            ? finalResult.actionItems
            : [],
          cleanTranscript: finalResult.cleanTranscript || '',
        });
      }

      setApiSuccessBanner(
        `Fusi Lintas-Modal Selesai: ${updatedChunksList.length} Segmen Suara + ${
          capturedPhotosRef.current.filter((p) => p.status === 'done').length
        } Pindaian Gambar telah disinkronkan!`
      );
    } catch (err: any) {
      const errorMsg = err?.message || '503 High Demand / Server AI Sibuk';
      bundleRecord.status = 'failed_retryable';
      bundleRecord.lastError = errorMsg;
      try {
        await saveMeetingBundle(bundleRecord);
        loadAllMeetingBundles().then(setSavedMeetingBundles).catch(() => {});
      } catch {}

      setApiError(
        `Server AI mengalami lonjakan (503 / High Demand). Rapat telah tersimpan aman di Brankas Lokal (IndexedDB). Silakan buka menu "Rapat Tersimpan" untuk Coba Analisis Ulang atau ganti Model AI di atas.`
      );
      setChunks((prev) =>
        prev.map((c) => (c.status === 'processing' ? { ...c, status: 'error' } : c))
      );
    } finally {
      setIsProcessingAI(false);
      setProcessingStatusText('');
    }
  };

  // Toggle handler for "Kunci Edit Manual" / "Sinkron Ulang AI"
  const handleToggleManualLockOrResync = async () => {
    if (isManualEditLocked || customFullText !== null) {
      // Unlock manual edit mode and force a fresh Cross-Modal Fusion re-sync
      setIsManualEditLocked(false);
      setCustomFullText(null);
      if (chunksRef.current.some((c) => c.status !== 'done')) {
        await handleProcessWithAI(chunksRef.current);
      } else {
        await runCrossModalFusionSync(
          chunksRef.current,
          capturedPhotosRef.current,
          metadataRef.current,
          true
        );
      }
      setApiSuccessBanner(
        'Sinkron Ulang AI Aktif: Laporan diselaraskan kembali dengan seluruh Segmen Suara & Pindaian Gambar.'
      );
    } else {
      // Lock manual edit mode so background AI scans do not overwrite user's manual edits
      setIsManualEditLocked(true);
      setApiSuccessBanner(
        'Kunci Edit Manual Aktif: Sinkronisasi otomatis dijeda untuk melindungi suntingan manual Anda.'
      );
    }
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
        attachmentPhotos
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

  // Post-Exit Archived Screen when user explicitly confirms "Simpan & Keluar"
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
              Seluruh perekaman latar belakang (MediaRecorder, WakeLock, &amp;
              MediaSession) telah dihentikan dengan aman dan draf laporan disimpan ke
              Arsip Lokal.
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

          <button
            type="button"
            onClick={handleResumeOrStartNewAfterExit}
            className="w-full py-3 rounded-xl bg-gradient-to-b from-[#2E6DB4] to-[#1E4E87] hover:from-[#3579C4] hover:to-[#245A99] active:scale-98 border border-[#38BDF8]/60 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg cursor-pointer"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Buka Kembali / Mulai Sesi Rapat Baru</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-[#0B1120] text-slate-100 flex flex-col justify-between">
      {/* Hidden Multi-Image Gallery Picker (Autonomous Vision Router) */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          readFilesAsDataUrls(e.target.files).then((valid) => {
            if (valid.length > 0) handleAutonomousPhotoCapture(valid);
          });
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Hidden Direct Multi-Image Lampiran Picker (Unlimited Watermarked Attachments for Word .docx) */}
      <input
        ref={directLampiranInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          readFilesAsDataUrls(e.target.files).then((valid) => {
            if (valid.length > 0) {
              handleAutonomousPhotoCapture(valid, 'DOKUMENTASI_KEGIATAN');
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
                  Proteksi Perekaman Latar Belakang Aktif
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed font-medium">
              Akhiri sesi rapat &amp; hentikan perekaman latar belakang?
            </p>

            <div className="bg-[#0B1120] border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 space-y-1">
              <div>
                &bull; Status Rekaman:{' '}
                <strong className={isRecordingActive ? 'text-red-400' : 'text-slate-200'}>
                  {isRecordingActive ? 'SEDANG MEREKAM AKTIF' : 'Siaga'}
                </strong>
              </div>
              <div>
                &bull; Data Sesi:{' '}
                <strong className="text-slate-100">
                  {chunks.length} Segmen Suara &amp; {attachmentPhotos.length} Foto
                  Lampiran (.docx)
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
        {/* 1. AEGIS-BRIEF DISKOMLEKAU TACTICAL COMMAND HEADER WITH DEDICATED RED "EXIT" BUTTON */}
        <header className="bg-gradient-to-b from-[#162E4D] to-[#0F2138] border border-[#1E293B] rounded-xl px-2.5 sm:px-3 py-2 shadow-lg flex items-center justify-between gap-2">
          <WingCrestEmblem className="w-9 h-9 sm:w-11 sm:h-11 shrink-0" />

          <div className="text-center min-w-0 flex-1">
            <h1 className="text-xs sm:text-lg font-extrabold tracking-wider text-white uppercase leading-tight truncate">
              AEGIS-BRIEF DISKOMLEKAU
            </h1>
            <p className="text-[9px] sm:text-xs font-medium text-[#38BDF8] tracking-wide truncate">
              Secure Tactical Meeting &amp; Field Documentation Suite
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <KomlekOmegaEmblem className="hidden sm:block w-10 h-10" />

            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 hover:text-white border border-slate-700 cursor-pointer transition-all shadow"
              title="Pengaturan API Cadangan (Groq / OpenAI Failover)"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* Dedicated Tactical Red EXIT Button in Top-Right Header */}
            <button
              type="button"
              onClick={() => setShowExitConfirmModal(true)}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-95 border-2 border-red-400/90 text-white font-black text-[11px] sm:text-xs tracking-wider uppercase shadow-[0_0_14px_rgba(239,68,68,0.45)] cursor-pointer"
              title="Akhiri Sesi Rapat & Hentikan Perekaman Latar Belakang (EXIT)"
            >
              <LogOut className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>EXIT</span>
            </button>
          </div>
        </header>

        {/* Top Tactical Session Control Bar (Sesi Baru / Reset Data + Model AI Dropdown + Rapat Tersimpan + Install App PWA + Open Fullscreen Camera) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#111827] border border-[#1E293B] rounded-xl px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={handleResetSession}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/75 hover:bg-red-900 active:scale-95 border border-red-700/70 text-red-200 hover:text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer"
              title="Hapus seluruh data sesi sebelumnya (Audio, Foto, OCR & Laporan) dan mulai sesi rapat baru"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Sesi Baru / Reset</span>
            </button>

            <div className="flex items-center gap-1">
              <span className="text-[10px] text-slate-400 font-bold hidden sm:inline">Model AI:</span>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-amber-300 font-bold outline-none cursor-pointer"
                title="Pilih Model AI (Ganti model jika terjadi lonjakan 503 high demand)"
              >
                <option value="gemini-2.5-flash">gemini-2.5-flash (Default)</option>
                <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite (Ringan)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash (Stabil)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (Mendalam)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                loadAllMeetingBundles().then(setSavedMeetingBundles).catch(() => {});
                setShowSavedBundlesModal(true);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 border border-slate-700 text-sky-300 hover:text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer"
              title="Buka daftar rapat tersimpan di IndexedDB (Pemulihan darurat 503)"
            >
              <Archive className="w-3.5 h-3.5 text-sky-400" />
              <span>Rapat Tersimpan ({savedMeetingBundles.length})</span>
            </button>

            <PWAInstallButton />
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

        {/* Responsive Main Tactical Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start flex-1">
          <div className="lg:col-span-6 space-y-2">
            {/* 2. METADATA RAPAT PANEL (Dynamically Synchronized with OCR & Watermark) */}
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
                {/* Row 1: Judul */}
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

                {/* Row 2: Hari/Tgl + Pukul */}
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

                {/* Row 3: Pimpinan */}
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

                {/* Expandable Extra Rows: Tempat, Peserta, Waktu Salam, Custom Glossary */}
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

            {/* 3. ANALYZER & CONTROLS (Dual-Stream Audio Recorder with WakeLock + Keep-Alive + IndexedDB Vault) */}
            <AudioRecorder
              chunks={chunks}
              screenFrames={screenFrames}
              onAddScreenFrame={handleAddScreenFrame}
              onRemoveScreenFrame={handleRemoveScreenFrame}
              onAddChunk={handleAddChunk}
              onClearChunks={handleClearChunks}
              onRemoveChunk={handleRemoveChunk}
              onProcessWithAI={handleProcessWithAI}
              isProcessingAI={isProcessingAI}
              processingStatusText={processingStatusText}
              onRecordingStateChange={setIsRecordingActive}
              registerStopRecordingRef={stopRecordingRef}
            />
          </div>

          {/* 4. LIVE EDITABLE OFFICIAL REPORT PREVIEW WITH CROSS-MODAL AUTO-SYNC HEADER */}
          <div className="lg:col-span-6 h-full">
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-2.5 sm:p-3 shadow-inner flex flex-col h-full space-y-1.5">
              {/* Top Row: Title + Manual Lock / Re-Sync Toggle */}
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
                      ? 'Buka kunci manual & sinkronkan ulang laporan dengan seluruh Segmen Suara + Pindaian Gambar'
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

              {/* Second Row: Live Multi-Modal Cross-Reference Status Indicator */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 bg-[#0B1120] border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-mono">
                <div className="inline-flex items-center gap-1.5 text-emerald-300">
                  {isCrossModalSyncing || isProcessingAI ? (
                    <Loader2 className="w-3 h-3 text-[#38BDF8] animate-spin shrink-0" />
                  ) : (
                    <Zap className="w-3 h-3 text-[#F59E0B] shrink-0" />
                  )}
                  <span>
                    ⚡ Tersinkronisasi: {syncedAudioCount} Segmen Suara +{' '}
                    {scannedImageCount} Pindaian Gambar
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
                className="flex-1 w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded-lg p-2.5 text-xs text-slate-100 leading-relaxed resize-y font-sans"
              />

              {/* Synchronized Action Items (Tindak Lanjut) Cross-Checked from Audio + Slides */}
              {report.actionItems && report.actionItems.length > 0 && (
                <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-2 space-y-1">
                  <div className="flex items-center justify-between text-[10px] font-bold text-[#F59E0B] uppercase tracking-wider">
                    <span className="inline-flex items-center gap-1">
                      <ListChecks className="w-3.5 h-3.5" />
                      Tindak Lanjut Terpadu (Suara + Slide): {report.actionItems.length}
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

        {/* 5. COLLAPSIBLE / FOLDING DATA CAPTURE TRAY (Unlimited Multi-Photo Support) */}
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

        {/* 6. BOTTOM PRIMARY ACTION BAR (One-Handed Field Operation) */}
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

      {/* Saved Meeting Bundles Modal (IndexedDB Vault Recovery for 503 / High Demand) */}
      {showSavedBundlesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-b from-[#162E4D] to-[#0B1120] border-2 border-sky-500/60 rounded-2xl p-4 sm:p-6 w-full max-w-lg shadow-2xl text-white max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/80 mb-3">
              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm sm:text-base font-extrabold tracking-wider uppercase">
                  Brankas Rapat Tersimpan (IndexedDB Vault)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSavedBundlesModal(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-3">
              Seluruh rekaman audio dan foto sesi rapat disimpan secara lokal di perangkat sebelum dikirim ke AI. Jika terjadi lonjakan 503 (High Demand), data tidak akan hilang dan dapat dianalisis ulang kapan saja.
            </p>

            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {savedMeetingBundles.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs italic">
                  Belum ada rapat tersimpan di brankas lokal.
                </div>
              ) : (
                savedMeetingBundles.map((bundle) => (
                  <div
                    key={bundle.id}
                    className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 flex flex-col gap-2 shadow-inner"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-xs sm:text-sm font-extrabold text-amber-300 uppercase">
                          {bundle.metadata.judulKegiatan || 'Rapat Tanpa Judul'}
                        </h4>
                        <p className="text-[10px] text-slate-400">
                          {bundle.metadata.hariTanggal || new Date(bundle.savedAt).toLocaleString()} • {bundle.chunks.length} Segmen Audio • {bundle.photos.length} Foto
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                        bundle.status === 'completed'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                          : bundle.status === 'failed_retryable'
                          ? 'bg-red-950 text-red-300 border border-red-700 animate-pulse'
                          : 'bg-amber-950 text-amber-300 border border-amber-700'
                      }`}>
                        {bundle.status}
                      </span>
                    </div>

                    {bundle.lastError && (
                      <p className="text-[10px] text-red-300 bg-red-950/60 p-1.5 rounded border border-red-800/60 font-mono">
                        Error: {bundle.lastError}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRetryBundleAnalysis(bundle)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-[11px] font-extrabold tracking-wide cursor-pointer shadow"
                      >
                        <RefreshCw className="w-3 h-3 animate-spin-slow" />
                        <span>Coba Analisis Ulang</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadBundleFiles(bundle)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-white text-[11px] font-bold tracking-wide cursor-pointer border border-slate-600"
                      >
                        <FileText className="w-3 h-3" />
                        <span>Unduh Audio & Foto</span>
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          await deleteMeetingBundle(bundle.id);
                          const updated = await loadAllMeetingBundles();
                          setSavedMeetingBundles(updated);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-950/60 hover:bg-red-900 text-red-300 hover:text-white text-[11px] font-bold tracking-wide cursor-pointer ml-auto border border-red-900"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-700/80 mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSavedBundlesModal(false)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pengaturan API Cadangan Modal (Groq & OpenAI Failover Settings) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/85 backdrop-blur-sm animate-fadeIn">
          <div className="bg-gradient-to-b from-[#162E4D] to-[#0B1120] border-2 border-amber-500/60 rounded-2xl p-4 sm:p-6 w-full max-w-lg shadow-2xl text-white max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/80 mb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm sm:text-base font-extrabold tracking-wider uppercase">
                  Pengaturan API Cadangan (Groq / OpenAI Failover)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-4">
              Konfigurasikan kunci API cadangan (Groq atau OpenAI). Jika Gemini mengalami lonjakan 503 (High Demand), AEGIS-BRIEF akan secara otomatis mengalihkan proses transkripsi suara (Whisper) dan analisis teks ke mesin cadangan pilihan Anda.
            </p>

            <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
              <div>
                <label className="block text-xs font-bold text-amber-300 mb-1 uppercase tracking-wider">
                  Mode Prioritas &amp; Failover
                </label>
                <select
                  value={backupSettings.priorityMode}
                  onChange={(e) =>
                    setBackupSettings((prev) => ({
                      ...prev,
                      priorityMode: e.target.value as any,
                    }))
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none focus:border-amber-500 cursor-pointer"
                >
                  <option value="automatic">Otomatis (Gemini dulu, lalu Groq/OpenAI saat 503)</option>
                  <option value="force_groq">Paksa Langsung ke Groq (Llama 3.3 + Whisper)</option>
                  <option value="force_openai">Paksa Langsung ke OpenAI (GPT-4o-mini + Whisper)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Groq API Key (Opsional)
                </label>
                <input
                  type="password"
                  value={backupSettings.groqApiKey}
                  onChange={(e) =>
                    setBackupSettings((prev) => ({
                      ...prev,
                      groqApiKey: e.target.value,
                    }))
                  }
                  placeholder="gsk_..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Digunakan untuk transkripsi kilat whisper-large-v3-turbo dan analisis llama-3.3-70b-versatile.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  OpenAI API Key (Opsional)
                </label>
                <input
                  type="password"
                  value={backupSettings.openaiApiKey}
                  onChange={(e) =>
                    setBackupSettings((prev) => ({
                      ...prev,
                      openaiApiKey: e.target.value,
                    }))
                  }
                  placeholder="sk-proj-..."
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-slate-600 outline-none focus:border-amber-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Digunakan untuk transkripsi whisper-1 dan fusi multimodal gpt-4o-mini.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-700/80 mt-4 flex justify-between items-center">
              <span className="text-[10px] text-emerald-300 font-medium">
                {backupSettings.groqApiKey || backupSettings.openaiApiKey
                  ? '✓ Kunci cadangan aktif & tersimpan lokal'
                  : '⚠️ Belum ada kunci cadangan (mengandalkan Gemini)'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setApiSuccessBanner('Pengaturan API Cadangan berhasil disimpan.');
                  setShowSettingsModal(false);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 text-xs font-extrabold tracking-wider uppercase shadow cursor-pointer"
              >
                Simpan &amp; Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
