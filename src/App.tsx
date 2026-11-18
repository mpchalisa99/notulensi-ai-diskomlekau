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
  Eye,
  ShieldAlert,
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
  INITIAL_SAMPLE_REPORT,
  blobToBase64,
  buildOfficialReportText,
  detectCurrentTimeRange,
  detectWaktuSalam,
  formatIndonesianDate,
  getTodayIsoDate,
} from './utils/reportFormatter';
import { exportReportToDocx } from './utils/docxExport';
import {
  INITIAL_CAPTURED_PHOTOS,
  burnTacticalBannerWatermark,
  stripExifAndNormalizeImage,
} from './utils/tacticalWatermark';
import { WingCrestEmblem, KomlekOmegaEmblem } from './components/DiskomlekauEmblems';
import { AudioRecorder } from './components/AudioRecorder';
import {
  TacticalCameraPreview,
  AutonomousDataCaptureTray,
} from './components/TacticalCameraAndTray';

const CATEGORY_CYCLE: VisionCategory[] = [
  'OCR_UNDANGAN',
  'MATERI_PAPARAN',
  'DOKUMENTASI_KEGIATAN',
];

export default function App() {
  const todayIso = getTodayIsoDate();

  const [metadata, setMetadata] = useState<MeetingMetadata>({
    waktuSalam: detectWaktuSalam(),
    judulKegiatan: 'Rapat Ops Komunikasi',
    tanggalIso: todayIso,
    hariTanggal: formatIndonesianDate(todayIso),
    pukul: '20.00 WIB s.d. selesai',
    tempat: 'Posko Utama Diskomlekau',
    pimpinanRapat: 'Kadiskomlekau',
    pesertaRapat: INITIAL_SAMPLE_REPORT.pesertaRapat || '',
    customGlossary:
      'Kadiskomlekau, Sesdiskomlekau, Diskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Satrad 421 Teluk Naga, Armor Personel Carrier, PT Tabel Aero, Kemhan, Mabesau, TNI AU, Vicon',
  });

  const [report, setReport] = useState<MeetingReportResult>(INITIAL_SAMPLE_REPORT);
  const [customFullText, setCustomFullText] = useState<string | null>(null);
  const [chunks, setChunks] = useState<AudioChunkItem[]>([]);
  const [screenFrames, setScreenFrames] = useState<string[]>([]);

  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhotoItem[]>(
    INITIAL_CAPTURED_PHOTOS
  );
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(
    INITIAL_CAPTURED_PHOTOS[2]?.id || null
  );

  const [showExtraMetadata, setShowExtraMetadata] = useState(false);
  const [showDraftEditor, setShowDraftEditor] = useState(false);

  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiSuccessBanner, setApiSuccessBanner] = useState<string | null>(null);
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);

  const trayMultiInputRef = useRef<HTMLInputElement | null>(null);

  const autoRenderedReportText = buildOfficialReportText(metadata, report.isiKegiatan);
  const displayedFullReportText =
    customFullText !== null ? customFullText : autoRenderedReportText;

  // Dynamically re-burn the high-contrast watermark on all non-sample DOKUMENTASI_KEGIATAN photos when title/date changes
  useEffect(() => {
    let cancelled = false;
    const updateWatermarks = async () => {
      const updated = await Promise.all(
        capturedPhotos.map(async (photo) => {
          if (photo.category === 'DOKUMENTASI_KEGIATAN' && !photo.isSample) {
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
    updateWatermarks();
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

  // Sends an image to the Autonomous Vision Router (or re-processes with manual override category)
  const routePhotoThroughVisionAI = async (
    photoId: string,
    cleanDataUrl: string,
    overrideCategory?: VisionCategory
  ) => {
    try {
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
          metadata,
          currentIsiKegiatan: report.isiKegiatan,
        }),
      });

      const result = (await parseApiResponseSafe(
        response,
        'Autonomous Vision Router'
      )) as VisionRouterResponse;

      const resolvedCategory: VisionCategory =
        overrideCategory || result.category || 'DOKUMENTASI_KEGIATAN';

      let finalDisplayUrl = cleanDataUrl;
      if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
        finalDisplayUrl = await burnTacticalBannerWatermark(
          cleanDataUrl,
          result.judulKegiatan?.trim() || metadata.judulKegiatan,
          result.hariTanggal?.trim() || metadata.hariTanggal
        );
      }

      // Pipeline A: OCR_UNDANGAN -> Auto-populate metadata fields
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
          'Autonomous Vision [OCR UNDANGAN]: Metadata rapat berhasil diekstrak otomatis!'
        );
      }

      // Pipeline B: MATERI_PAPARAN -> Integrate slide points & specs into report draft
      if (resolvedCategory === 'MATERI_PAPARAN') {
        if (result.isiKegiatanDraft?.trim()) {
          setCustomFullText(null);
          setReport((prev) => ({
            ...prev,
            isiKegiatan: result.isiKegiatanDraft!.trim(),
          }));
        }
        setApiSuccessBanner(
          'Autonomous Vision [MATERI PAPARAN]: Poin slide & spesifikasi teknis terintegrasi ke draf laporan!'
        );
      }

      // Pipeline C: DOKUMENTASI_KEGIATAN -> Burn watermark & queue for .docx
      if (resolvedCategory === 'DOKUMENTASI_KEGIATAN') {
        setApiSuccessBanner(
          'Autonomous Vision [LAMPIRAN]: EXIF dihapus & Watermark Taktis disematkan untuk lampiran Word (.docx).'
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
                isSample: false,
              }
            : p
        )
      );
    } catch (err: any) {
      // Fallback: if offline/error, watermark as DOKUMENTASI_KEGIATAN so field photo is never lost
      const fallbackWatermarked = await burnTacticalBannerWatermark(
        cleanDataUrl,
        metadata.judulKegiatan,
        metadata.hariTanggal
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
                isSample: false,
              }
            : p
        )
      );
      setApiError(err?.message || 'Gagal menjalankan klasifikasi AI; foto disimpan sebagai Lampiran.');
    }
  };

  // Zero-Friction Autonomous Capture: processes any number of photos automatically
  const handleAutonomousPhotoCapture = async (rawDataUrls: string[]) => {
    setApiError(null);
    const timeLabel = new Date().toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const rawUrl of rawDataUrls) {
      // 1. Strip sensitive EXIF camera metadata immediately via HTML5 Canvas
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
        isSample: false,
      };

      // Replace default sample items once operator captures real field photos
      setCapturedPhotos((prev) => {
        const nonSamples = prev.filter((item) => !item.isSample);
        return [...nonSamples, placeholderItem];
      });
      setSelectedPhotoId(newId);

      // 2. Route autonomously through Gemini Vision API
      await routePhotoThroughVisionAI(newId, cleanDataUrl);
    }
  };

  // Manual override toggle on any thumbnail
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
              status: p.isSample ? 'done' : 'analyzing',
            }
          : p
      )
    );

    if (!target.isSample) {
      await routePhotoThroughVisionAI(photoId, target.cleanSourceDataUrl, nextCategory);
    }
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

  // Panic Wipe / Clear Session Security Button
  const handlePanicWipe = () => {
    const now = new Date();
    const iso = getTodayIsoDate();
    setChunks([]);
    setScreenFrames([]);
    setCapturedPhotos([]);
    setSelectedPhotoId(null);
    setCustomFullText(null);
    setApiError(null);
    setMetadata({
      waktuSalam: detectWaktuSalam(now),
      judulKegiatan: '',
      tanggalIso: iso,
      hariTanggal: formatIndonesianDate(iso),
      pukul: detectCurrentTimeRange(now),
      tempat: '',
      pimpinanRapat: '',
      pesertaRapat: '',
      customGlossary: metadata.customGlossary,
    });
    setReport({
      isiKegiatan:
        '1. Dasar / Latar Belakang: -\n\n2. Jalannya Rapat / Pokok Pembahasan: -\n\n3. Hasil Rapat : -\n\n4. Kesimpulan: -',
      executiveSummary: '',
      actionItems: [],
      cleanTranscript: '',
    });
    setApiSuccessBanner('PANIC WIPE: Seluruh sesi audio, foto, dan metadata telah dihapus bersih.');
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

  // Multi-Modal Synthesis: Combines recorded audio chunks + extracted MATERI_PAPARAN knowledge
  const handleProcessWithAI = async (overrideChunks?: AudioChunkItem[]) => {
    const targetChunks = overrideChunks || chunks;
    if (targetChunks.length === 0) return;

    setIsProcessingAI(true);
    setApiError(null);
    setApiSuccessBanner(null);

    try {
      const partialSummaries: MeetingReportResult[] = [];

      const paparanKnowledge = capturedPhotos
        .filter((p) => p.category === 'MATERI_PAPARAN' && p.extractedText)
        .map((p) => p.extractedText!);

      const visualFrames = capturedPhotos
        .filter((p) => !p.isSample && p.cleanSourceDataUrl.startsWith('data:image/'))
        .map((p) => p.cleanSourceDataUrl);

      for (let i = 0; i < targetChunks.length; i++) {
        const chunk = targetChunks[i];
        setProcessingStatusText(`Sintesis Audio & Slide Chunk #${i + 1}...`);

        setChunks((prev) =>
          prev.map((c) => (c.id === chunk.id ? { ...c, status: 'processing' } : c))
        );

        const audioBase64 = await blobToBase64(chunk.blob);
        const framesToSend = [
          ...visualFrames,
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
            paparanKnowledge,
            metadata,
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
        setProcessingStatusText('Menyintesiskan Laporan Akhir...');
        const synthResponse = await fetch('/api/summarize', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            mode: 'synthesize',
            metadata,
            paparanKnowledge,
            previousSummaries: partialSummaries,
          }),
        });

        const synthData = await parseApiResponseSafe(synthResponse, 'Sintesis Laporan');
        finalResult = synthData as MeetingReportResult;
      }

      const now = new Date();
      const currentIso = getTodayIsoDate();
      setMetadata((prev) => ({
        ...prev,
        waktuSalam: detectWaktuSalam(now),
        tanggalIso: currentIso,
        hariTanggal: finalResult.hariTanggal?.trim() || formatIndonesianDate(currentIso),
        pukul: finalResult.pukul?.trim() || prev.pukul || detectCurrentTimeRange(now),
        judulKegiatan:
          finalResult.judulKegiatan?.trim() || prev.judulKegiatan || 'Rapat Ops Komunikasi',
        pimpinanRapat:
          finalResult.pimpinanRapat?.trim() || prev.pimpinanRapat || '-',
        pesertaRapat:
          finalResult.pesertaRapat?.trim() || prev.pesertaRapat || '-',
        tempat:
          finalResult.tempat?.trim() ||
          (screenFrames.length > 0 ? 'Vicon Zoom Meeting' : prev.tempat),
      }));

      setCustomFullText(null);
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
        'Sintesis Multimodal AI selesai: Rekaman suara & materi paparan berhasil diintegrasikan.'
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

  const selectedPhoto =
    capturedPhotos.find((p) => p.id === selectedPhotoId) ||
    capturedPhotos[capturedPhotos.length - 1] ||
    null;

  return (
    <div className="min-h-dvh w-full bg-[#0B1120] text-slate-100 flex flex-col justify-between">
      <input
        ref={trayMultiInputRef}
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
                r.onload = () => resolve(typeof r.result === 'string' ? r.result : '');
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

      {/* Fullscreen Tactical Container (One-Handed Mobile & Split-Screen Tablet Ergonomics) */}
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

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePanicWipe}
              className="p-1.5 rounded-lg bg-red-950/70 hover:bg-red-900 border border-red-700/70 text-red-300 hover:text-white transition-colors cursor-pointer"
              title="PANIC WIPE / Clear Session Memory"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
            <KomlekOmegaEmblem className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>
        </header>

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

        {/* Responsive Main Tactical Grid (Single-Column Mobile, Split-Screen Landscape on Tablet/Desktop) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start">
          <div className="lg:col-span-7 space-y-2">
            {/* 2. METADATA RAPAT PANEL */}
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl px-3 py-2 shadow-inner space-y-1.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                <h2 className="text-[11px] font-bold tracking-wider text-slate-200 uppercase">
                  METADATA RAPAT
                </h2>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDraftEditor((prev) => !prev)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer lg:hidden ${
                      showDraftEditor
                        ? 'bg-[#F59E0B]/20 text-[#F59E0B] border-[#F59E0B]/50'
                        : 'bg-[#0B1120] text-[#38BDF8] border-slate-700 hover:text-white'
                    }`}
                  >
                    <Eye className="w-2.5 h-2.5" />
                    <span>Draf Notulen</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowExtraMetadata((prev) => !prev)}
                    className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    <span>{showExtraMetadata ? 'Ringkas' : 'Detail & Glosarium'}</span>
                    {showExtraMetadata ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
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
                      placeholder="Otomatis dari OCR Undangan / Suara"
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-100 font-medium"
                    />
                  </div>
                </div>

                {/* Row 2: Hari/Tgl + Inbs./Jam */}
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
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-100"
                    />
                  </div>
                  <label className="col-span-1 sm:col-span-1 text-slate-300 font-medium text-right">
                    Pukul
                  </label>
                  <div className="col-span-3 sm:col-span-3">
                    <input
                      type="text"
                      value={metadata.pukul}
                      onChange={(e) => handleFieldChange('pukul', e.target.value)}
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-1.5 py-0.5 text-[11px] text-slate-100 text-center"
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
                      className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-100"
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
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-100"
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
                          className="w-full bg-[#0B1120] border border-slate-700/90 rounded px-1 py-0.5 text-[11px] text-slate-100"
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
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-100"
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
                          className="w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded px-2 py-0.5 text-[11px] text-slate-300"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 3. ACTIVE CAMERA PREVIEW (Autonomous Vision Router) */}
            <TacticalCameraPreview
              metadata={metadata}
              selectedPhoto={selectedPhoto}
              onAutonomousPhotoCapture={handleAutonomousPhotoCapture}
            />

            {/* 4. ANALYZER & CONTROLS (Dual-Stream Audio Recorder) */}
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

          {/* Live Editable Official Report Preview (Always visible on Tablet Split-Screen, Toggleable on Mobile) */}
          <div
            className={`lg:col-span-5 ${
              showDraftEditor ? 'block' : 'hidden lg:block'
            } h-full`}
          >
            <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-3 shadow-inner flex flex-col h-full space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider text-[#38BDF8] uppercase">
                  LAPORAN PELAKSANAAN KEGIATAN (LIVE EDITABLE):
                </span>
                {customFullText !== null && (
                  <button
                    type="button"
                    onClick={() => setCustomFullText(null)}
                    className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] hover:text-amber-300 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Reset Template
                  </button>
                )}
              </div>
              <textarea
                rows={14}
                value={displayedFullReportText}
                onChange={(e) => setCustomFullText(e.target.value)}
                className="flex-1 w-full bg-[#0B1120] border border-slate-700/90 focus:border-[#38BDF8] focus:outline-none rounded-lg p-2.5 text-xs text-slate-100 leading-relaxed resize-y font-sans"
              />
            </section>
          </div>
        </div>

        {/* 5. BOTTOM-ANCHORED AUTONOMOUS DATA CAPTURE TRAY */}
        <AutonomousDataCaptureTray
          photos={capturedPhotos}
          selectedPhotoId={selectedPhoto?.id || null}
          onSelectPhoto={setSelectedPhotoId}
          onCycleCategoryOverride={handleCycleCategoryOverride}
          onRemovePhoto={handleRemovePhoto}
          onAddPhotosClick={() => trayMultiInputRef.current?.click()}
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
