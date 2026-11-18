/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
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

const CATEGORY_CYCLE: VisionCategory[] = [
  'OCR_UNDANGAN',
  'MATERI_PAPARAN',
  'DOKUMENTASI_KEGIATAN',
];

export default function App() {
  // Initialize with clean, non-stale session state bound to current system clock
  const [metadata, setMetadata] = useState<MeetingMetadata>(() =>
    createCleanSessionMetadata(new Date())
  );
  const [report, setReport] = useState<MeetingReportResult>(() =>
    createCleanSessionReport()
  );
  const [customFullText, setCustomFullText] = useState<string | null>(null);
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
  const [processingStatusText, setProcessingStatusText] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccessBanner, setApiSuccessBanner] = useState<string | null>(null);
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const directLampiranInputRef = useRef<HTMLInputElement | null>(null);
  const stopRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const metadataRef = useRef<MeetingMetadata>(metadata);
  const capturedPhotosRef = useRef<CapturedPhotoItem[]>(capturedPhotos);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  // Restore any persisted audio chunks from IndexedDB (`aegis_audio_vault`) if OS recovered from memory pressure
  useEffect(() => {
    loadAudioChunksFromVault().then((persisted) => {
      if (persisted && persisted.length > 0) {
        setChunks((prev) => (prev.length === 0 ? persisted : prev));
      }
    });
  }, []);

  // Derived array of all LAMPIRAN / DOKUMENTASI_KEGIATAN photos (unlimited count: 2, 5, 10+)
  const attachmentPhotos = capturedPhotos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

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
      // Re-push history state to block accidental back-swipe navigation
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

      // Functional update ensures newly added photos are never overwritten
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
    setCustomFullText(null);
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

  // Routes a newly captured photo through Gemini Vision using ONLY current session context
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

      // Pipeline A: OCR_UNDANGAN -> Immediately update metadata & re-render report header
      if (resolvedCategory === 'OCR_UNDANGAN') {
        setCustomFullText(null);
        setMetadata((prev) => ({
          ...prev,
          judulKegiatan: result.judulKegiatan?.trim() || prev.judulKegiatan,
          hariTanggal: result.hariTanggal?.trim() || prev.hariTanggal,
          pukul: result.pukul?.trim() || prev.pukul,
          tempat: result.tempat?.trim() || prev.tempat,
          pimpinanRapat: result.pimpinanRapat?.trim() || prev.pimpinanRapat,
          pesertaRapat: result.pesertaRapat?.trim() || prev.pesertaRapat,
        }));
        setApiSuccessBanner(
          'OCR Undangan Selesai: Judul, Tanggal, Jam, Tempat, Pimpinan & Peserta otomatis diperbarui!'
        );
      }

      // Pipeline B: MATERI_PAPARAN -> Synthesize slide knowledge into current session report
      if (resolvedCategory === 'MATERI_PAPARAN') {
        setCustomFullText(null);
        if (result.judulKegiatan?.trim() && !metadataRef.current.judulKegiatan) {
          setMetadata((prev) => ({
            ...prev,
            judulKegiatan: result.judulKegiatan!.trim(),
          }));
        }
        if (result.isiKegiatanDraft?.trim()) {
          setReport((prev) => ({
            ...prev,
            isiKegiatan: result.isiKegiatanDraft!.trim(),
          }));
        }
        setApiSuccessBanner(
          'Materi Paparan Dianalisis: Poin slide telah diintegrasikan ke dalam Laporan Kegiatan sesi ini!'
        );
      }

      // Pipeline C: DOKUMENTASI_KEGIATAN -> Burn watermark & queue in attachmentPhotos[] for .docx
      if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
        setCustomFullText(null);
        setApiSuccessBanner(
          'Lampiran Dokumentasi ditambahkan: Watermark [JUDUL - TANGGAL] disematkan & siap diekspor ke Word (.docx).'
        );
      }

      setCapturedPhotos((prev) =>
        prev.map((p) =>
          p.id === photoId
            ? {
                ...p,
                category: resolvedCategory,
                displayDataUrl: finalDisplayUrl,
                status: 'done',
                confidenceReason: result.confidenceReason || resolvedCategory,
                extractedText:
                  result.extractedKnowledge ||
                  result.judulKegiatan ||
                  result.confidenceReason,
              }
            : p
        )
      );
    } catch (err: any) {
      const fallbackWatermarked = await burnTacticalBannerWatermark(
        cleanDataUrl,
        metadataRef.current.judulKegiatan,
        metadataRef.current.hariTanggal
      );
      setCustomFullText(null);
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
    setCustomFullText(null);

    const timeLabel = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    // Normalize and burn initial watermark on all uploaded/captured photos immediately
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

    // Append all new photos to capturedPhotos state in a single atomic functional update
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

    // Route each photo through Vision AI without blocking or overwriting others
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

    setCustomFullText(null);
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
    setCustomFullText(null);
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

  // Multi-Modal Synthesis: Strictly synthesizes ONLY current session audio chunks + current session MATERI_PAPARAN photos
  const handleProcessWithAI = async (overrideChunks?: AudioChunkItem[]) => {
    const targetChunks = overrideChunks || chunks;
    if (targetChunks.length === 0) return;

    setIsProcessingAI(true);
    setApiError(null);
    setApiSuccessBanner(null);

    try {
      const partialSummaries: MeetingReportResult[] = [];
      const currentMeta = metadataRef.current;

      const currentSessionPaparanKnowledge = capturedPhotosRef.current
        .filter((p) => p.category === 'MATERI_PAPARAN' && p.extractedText)
        .map((p) => p.extractedText!);

      const currentSessionVisualFrames = capturedPhotosRef.current
        .filter((p) => p.cleanSourceDataUrl.startsWith('data:image/'))
        .map((p) => p.cleanSourceDataUrl);

      for (let i = 0; i < targetChunks.length; i++) {
        const chunk = targetChunks[i];
        setProcessingStatusText(`Sintesis Audio & Slide Sesi Ini (#${i + 1})...`);

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
            metadata: currentMeta,
            chunkIndex: i,
            totalChunks: targetChunks.length,
          }),
        });

        const data = await parseApiResponseSafe(response, `Chunk #${i + 1}`);
        partialSummaries.push(data as MeetingReportResult);

        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? { ...c, status: 'done' } : c))
        );
      }

      let finalResult: MeetingReportResult = partialSummaries[0];

      if (partialSummaries.length > 1) {
        setProcessingStatusText('Menyintesiskan Laporan Sesi Ini...');
        const synthResponse = await fetch('/api/summarize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            mode: 'synthesize',
            metadata: currentMeta,
            paparanKnowledge: currentSessionPaparanKnowledge,
            previousSummaries: partialSummaries,
          }),
        });

        const synthData = await parseApiResponseSafe(synthResponse, 'Sintesis Laporan');
        finalResult = synthData as MeetingReportResult;
      }

      const now = new Date();
      const currentIso = getTodayIsoDate(now);

      setCustomFullText(null);
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

      setReport({
        judulKegiatan: finalResult.judulKegiatan,
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

      setApiSuccessBanner(
        'Sintesis Selesai: Laporan kegiatan telah diperbarui dari rekaman suara & tangkapan foto sesi ini.'
      );
    } catch (err: any) {
      setApiError(err?.message || 'Gagal memproses rekaman rapat.');
      setChunks((prev) =>
        prev.map((c) => (c.status === 'processing' ? { ...c, status: 'error' } : c))
      );
    } finally {
      setIsProcessingAI(false);
      setProcessingStatusText('');
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
                  {chunks.length} Chunk Audio &amp; {attachmentPhotos.length} Foto
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

        {/* Top Tactical Session Control Bar (Sesi Baru / Reset Data + Install App PWA + Open Fullscreen Camera) */}
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

          {/* 4. LIVE EDITABLE OFFICIAL REPORT PREVIEW (Unobstructed on Mobile & Tablet) */}
          <div className="lg:col-span-6 h-full">
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-2.5 sm:p-3 shadow-inner flex flex-col h-full space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold tracking-wider text-[#38BDF8] uppercase">
                  LAPORAN PELAKSANAAN KEGIATAN:
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-emerald-300">
                    Lampiran: {attachmentPhotos.length} Foto
                  </span>
                  {customFullText !== null && (
                    <button
                      type="button"
                      onClick={() => setCustomFullText(null)}
                      className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] hover:text-amber-300 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Sinkronkan Ulang
                    </button>
                  )}
                </div>
              </div>
              <textarea
                rows={10}
                value={displayedFullReportText}
                onChange={(e) => setCustomFullText(e.target.value)}
                className="flex-1 w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded-lg p-2.5 text-xs text-slate-100 leading-relaxed resize-y font-sans"
              />
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
    </div>
  );
}
