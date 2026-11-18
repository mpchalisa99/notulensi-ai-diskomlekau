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
import { WingCrestEmblem, KomlekOmegaEmblem } from './components/DiskomlekauEmblems';
import { AudioRecorder } from './components/AudioRecorder';
import {
  FullscreenCameraModal,
  CollapsibleDataCaptureTray,
} from './components/TacticalCameraAndTray';

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

  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccessBanner, setApiSuccessBanner] = useState<string | null>(null);
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const metadataRef = useRef<MeetingMetadata>(metadata);
  const capturedPhotosRef = useRef<CapturedPhotoItem[]>(capturedPhotos);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    capturedPhotosRef.current = capturedPhotos;
  }, [capturedPhotos]);

  // Live dynamic report text bound strictly to current metadata & current report.isiKegiatan
  const autoRenderedReportText = buildOfficialReportText(metadata, report.isiKegiatan);
  const displayedFullReportText =
    customFullText !== null ? customFullText : autoRenderedReportText;

  // Dynamically re-burn the bottom watermark ([JUDUL KEGIATAN] - [TANGGAL]) onto all LAMPIRAN photos whenever title/date changes
  useEffect(() => {
    let cancelled = false;
    const reburnAllLampiranWatermarks = async () => {
      const currentPhotos = capturedPhotosRef.current;
      const hasLampiran = currentPhotos.some(
        (p) => p.category === 'DOKUMENTASI_KEGIATAN'
      );
      if (!hasLampiran) return;

      const updated = await Promise.all(
        currentPhotos.map(async (photo) => {
          if (photo.category === 'DOKUMENTASI_KEGIATAN') {
            const watermarkedUrl = await burnTacticalBannerWatermark(
              photo.cleanSourceDataUrl,
              metadata.judulKegiatan,
              metadata.hariTanggal
            );
            return { ...photo, displayDataUrl: watermarkedUrl };
          }
          return photo;
        })
      );
      if (!cancelled) {
        setCapturedPhotos(updated);
      }
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
    // Clear manual full-text override so the report header immediately reflects the updated metadata field
    setCustomFullText(null);
    setMetadata((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Sesi Baru / Reset Data: Completely clears all previous audio, photos, OCR, and report state
  const handleResetSession = () => {
    const now = new Date();
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setApiError(null);
    setMetadata(createCleanSessionMetadata(now));
    setReport(createCleanSessionReport());
    setApiSuccessBanner(
      'Sesi Baru dimulai: Seluruh data rapat sebelumnya, rekaman audio, dan tangkapan foto telah di-reset bersih.'
    );
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

      // Pipeline C: DOKUMENTASI_KEGIATAN -> Burn watermark & queue for .docx
      if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
        setApiSuccessBanner(
          'Lampiran Dokumentasi: EXIF dihapus & Watermark [JUDUL - TANGGAL] disematkan.'
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

  // Zero-Friction Autonomous Capture
  const handleAutonomousPhotoCapture = async (rawDataUrls: string[]) => {
    setApiError(null);
    const timeLabel = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const rawUrl of rawDataUrls) {
      const cleanDataUrl = await stripExifAndNormalizeImage(rawUrl);
      const newId = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const placeholderItem: CapturedPhotoItem = {
        id: newId,
        category: 'DOKUMENTASI_KEGIATAN',
        cleanSourceDataUrl: cleanDataUrl,
        displayDataUrl: cleanDataUrl,
        capturedAt: `${timeLabel} WIB`,
        status: 'analyzing',
        confidenceReason: 'Mengklasifikasikan via Vision AI...',
      };

      setCapturedPhotos((prev) => [...prev, placeholderItem]);
      setSelectedPhotoId(newId);

      await routePhotoThroughVisionAI(newId, cleanDataUrl);
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

    setCapturedPhotos((prev) =>
      prev.map((p) =>
        p.id === photoId
          ? {
              ...p,
              category: nextCategory,
              displayDataUrl: updatedDisplayUrl,
              status: 'analyzing',
            }
          : p
      )
    );

    await routePhotoThroughVisionAI(photoId, target.cleanSourceDataUrl, nextCategory);
  };

  const handleRemovePhoto = (photoId: string) => {
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

  const handleClearChunks = () => {
    setChunks([]);
    setScreenFrames([]);
    setApiError(null);
  };

  const handleRemoveChunk = (id: string) => {
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
        capturedPhotos
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-[#0B1120] text-slate-100 flex flex-col justify-between">
      {/* Hidden Multi-Image Gallery Picker */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = e.target.files;
          if (!files || files.length === 0) return;
          const readers: Promise<string>[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('image/')) continue;
            readers.push(
              new Promise<string>((resolve) => {
                const r = new FileReader();
                r.onload = () =>
                  resolve(typeof r.result === 'string' ? r.result : '');
                r.readAsDataURL(file);
              })
            );
          }
          Promise.all(readers).then((urls) => {
            const valid = urls.filter(Boolean);
            if (valid.length > 0) handleAutonomousPhotoCapture(valid);
          });
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* True Fullscreen 100% Viewport Camera Modal (fixed inset-0 z-50 w-screen h-screen bg-black) */}
      <FullscreenCameraModal
        isOpen={isFullscreenCameraOpen}
        onClose={() => setIsFullscreenCameraOpen(false)}
        metadata={metadata}
        capturedCount={capturedPhotos.length}
        onAutonomousPhotoCapture={handleAutonomousPhotoCapture}
      />

      {/* Fullscreen Tactical Workspace Container */}
      <div className="w-full max-w-xl lg:max-w-5xl mx-auto flex-1 flex flex-col justify-between p-2 sm:p-3 space-y-2">
        {/* 1. AEGIS-BRIEF DISKOMLEKAU TACTICAL COMMAND HEADER */}
        <header className="bg-gradient-to-b from-[#162E4D] to-[#0F2138] border border-[#1E293B] rounded-xl px-3 py-2 shadow-lg flex items-center justify-between gap-2">
          <WingCrestEmblem className="w-10 h-10 sm:w-12 sm:h-12" />

          <div className="text-center min-w-0 flex-1">
            <h1 className="text-sm sm:text-lg font-extrabold tracking-wider text-white uppercase leading-tight truncate">
              AEGIS-BRIEF DISKOMLEKAU
            </h1>
            <p className="text-[10px] sm:text-xs font-medium text-[#38BDF8] tracking-wide truncate">
              Secure Tactical Meeting &amp; Field Documentation Suite
            </p>
          </div>

          <KomlekOmegaEmblem className="w-10 h-10 sm:w-12 sm:h-12" />
        </header>

        {/* Top Tactical Session Control Bar (Sesi Baru / Reset Data + Open Fullscreen Camera) */}
        <div className="flex items-center justify-between gap-2 bg-[#111827] border border-[#1E293B] rounded-xl px-2.5 py-1.5">
          <button
            type="button"
            onClick={handleResetSession}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/75 hover:bg-red-900 active:scale-95 border border-red-700/70 text-red-200 hover:text-white text-[11px] font-bold tracking-wide transition-all cursor-pointer"
            title="Hapus seluruh data sesi sebelumnya (Audio, Foto, OCR & Laporan) dan mulai sesi rapat baru"
          >
            <RotateCcw className="w-3.5 h-3.5 text-red-400" />
            <span>Sesi Baru / Reset Data</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreenCameraOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 border border-amber-300/80 text-slate-950 text-[11px] font-extrabold tracking-wide shadow cursor-pointer"
            title="Buka Kamera Fullscreen 100% Layar (Auto-OCR Undangan / Paparan / Lampiran)"
          >
            <Camera className="w-3.5 h-3.5 stroke-[2.3]" />
            <span>Ambil Foto (Fullscreen Cam)</span>
          </button>
        </div>

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
            {/* 2. METADATA RAPAT PANEL (Dynamically Synchronized with OCR & Report) */}
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl px-3 py-2 shadow-inner space-y-1.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h2 className="text-[11px] font-bold tracking-wider text-slate-200 uppercase">
                  METADATA RAPAT (LIVE SYNC)
                </h2>

                <button
                  type="button"
                  onClick={() => setShowExtraMetadata((prev) => !prev)}
                  className="inline-flex items-center gap-0.5 text-[10px] text-[#38BDF8] hover:text-sky-300 font-semibold cursor-pointer"
                >
                  <span>{showExtraMetadata ? 'Sembunyikan Detail' : 'Tempat, Peserta & Glosarium'}</span>
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

            {/* 3. ANALYZER & CONTROLS (Dual-Stream Audio Recorder) */}
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
            />
          </div>

          {/* 4. LIVE EDITABLE OFFICIAL REPORT PREVIEW (Unobstructed on Mobile & Tablet) */}
          <div className="lg:col-span-6 h-full">
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-2.5 sm:p-3 shadow-inner flex flex-col h-full space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider text-[#38BDF8] uppercase">
                  LAPORAN PELAKSANAAN KEGIATAN:
                </span>
                {customFullText !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomFullText(null)}
                    className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] hover:text-amber-300 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Sinkronkan Ulang Template
                  </button>
                )}
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

        {/* 5. COLLAPSIBLE / FOLDING DATA CAPTURE TRAY (Non-Obstructive Bottom Drawer) */}
        <CollapsibleDataCaptureTray
          photos={capturedPhotos}
          selectedPhotoId={selectedPhotoId}
          onSelectPhoto={setSelectedPhotoId}
          onCycleCategoryOverride={handleCycleCategoryOverride}
          onRemovePhoto={handleRemovePhoto}
          onOpenFullscreenCamera={() => setIsFullscreenCameraOpen(true)}
          onOpenGalleryPicker={() => galleryInputRef.current?.click()}
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
                  UNDUH WORD
                  <br />
                  (.docx)
                </>
              )}
            </span>
          </button>
        </footer>
      </div>
    </div>
  );
}
