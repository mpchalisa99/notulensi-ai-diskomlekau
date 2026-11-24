import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ScanText,
  Cpu,
  FileCheck2,
  Loader2,
  RefreshCw,
  Trash2,
  X,
  SwitchCamera,
  Image as ImageIcon,
  ChevronUp,
  ChevronDown,
  FilePlus2,
} from 'lucide-react';
import type {
  CapturedPhotoItem,
  MeetingMetadata,
  VisionCategory,
} from '../types';

interface FullscreenCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: MeetingMetadata;
  capturedCount: number;
  attachmentCount: number;
  onAutonomousPhotoCapture: (
    rawDataUrls: string[],
    forcedCategory?: VisionCategory
  ) => void;
}

export const FullscreenCameraModal: React.FC<FullscreenCameraModalProps> = ({
  isOpen,
  onClose,
  metadata,
  capturedCount,
  attachmentCount,
  onAutonomousPhotoCapture,
}) => {
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [captureTargetMode, setCaptureTargetMode] = useState<'AUTO_AI' | 'LAMPIRAN_DIRECT'>(
    'AUTO_AI'
  );
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastSnapFeedback, setLastSnapFeedback] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackCameraInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCameraStream = useCallback(
    async (mode: 'environment' | 'user') => {
      stopCameraStream();
      setCameraError(null);
      setIsStartingCamera(true);

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Browser tidak mendukung live camera stream.');
        }

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError(
          'Akses kamera langsung dibatasi oleh perangkat. Gunakan tombol Jepret Foto untuk membuka kamera sistem.'
        );
      } finally {
        setIsStartingCamera(false);
      }
    },
    [stopCameraStream]
  );

  useEffect(() => {
    if (isOpen) {
      startCameraStream(facingMode);
    } else {
      stopCameraStream();
    }
    return () => {
      stopCameraStream();
    };
  }, [isOpen, facingMode, startCameraStream, stopCameraStream]);

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleJepretFoto = () => {
    const forcedCat: VisionCategory | undefined =
      captureTargetMode === 'LAMPIRAN_DIRECT' ? 'DOKUMENTASI_KEGIATAN' : undefined;

    const videoEl = videoRef.current;
    if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
      const maxWidth = 1280;
      const scale = Math.min(1, maxWidth / videoEl.videoWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(videoEl.videoWidth * scale);
      canvas.height = Math.round(videoEl.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (facingMode === 'user') {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);

        setShutterFlash(true);
        setTimeout(() => setShutterFlash(false), 180);

        setLastSnapFeedback(
          forcedCat === 'DOKUMENTASI_KEGIATAN'
            ? `Foto Dokumentasi #${attachmentCount + 1} disimpan + Watermark!`
            : `Foto #${capturedCount + 1} dijepret & dikirim ke AI Vision Router!`
        );
        setTimeout(() => setLastSnapFeedback(null), 2200);

        onAutonomousPhotoCapture([dataUrl], forcedCat);
        return;
      }
    }

    // Fallback to native hardware camera input if video stream is unavailable
    fallbackCameraInputRef.current?.click();
  };

  const handleFallbackFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const forcedCat: VisionCategory | undefined =
      captureTargetMode === 'LAMPIRAN_DIRECT' ? 'DOKUMENTASI_KEGIATAN' : undefined;

    const promises: Promise<string>[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) continue;
      promises.push(
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === 'string' ? reader.result : '');
          reader.readAsDataURL(file);
        })
      );
    }

    Promise.all(promises).then((urls) => {
      const valid = urls.filter(Boolean);
      if (valid.length > 0) {
        onAutonomousPhotoCapture(valid, forcedCat);
        setLastSnapFeedback(
          `${valid.length} foto berhasil ditambahkan ke daftar sesi ini!`
        );
        setTimeout(() => setLastSnapFeedback(null), 2200);
      }
    });

    e.target.value = '';
  };

  if (!isOpen) return null;

  const watermarkBannerText = `${(
    metadata.judulKegiatan?.trim() || 'KEGIATAN RAPAT DISKOMLEKAU'
  ).toUpperCase()} - ${(metadata.hariTanggal?.trim() || '-').toUpperCase()}`;

  return (
    <div className="fixed inset-0 z-50 w-screen h-dvh bg-black overflow-hidden select-none">
      <input
        ref={fallbackCameraInputRef}
        type="file"
        accept="image/*"
        capture={facingMode}
        onChange={handleFallbackFileChange}
        className="hidden"
      />

      {/* 100% Fullscreen Live Camera Viewfinder with object-cover scaling */}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={`w-full h-full object-cover ${
          facingMode === 'user' ? 'scale-x-[-1]' : ''
        }`}
      />

      {/* Shutter Flash Effect */}
      {shutterFlash && (
        <div className="pointer-events-none absolute inset-0 bg-white/80 transition-opacity" />
      )}

      {/* Tactical HUD Corner Reticles */}
      <div className="pointer-events-none absolute top-5 left-5 w-8 h-8 border-t-2 border-l-2 border-[#F59E0B]/85 rounded-tl" />
      <div className="pointer-events-none absolute top-5 right-5 w-8 h-8 border-t-2 border-r-2 border-[#F59E0B]/85 rounded-tr" />
      <div className="pointer-events-none absolute bottom-48 left-5 w-8 h-8 border-b-2 border-l-2 border-[#F59E0B]/85 rounded-bl" />
      <div className="pointer-events-none absolute bottom-48 right-5 w-8 h-8 border-b-2 border-r-2 border-[#F59E0B]/85 rounded-br" />

      {/* Top HUD Status Bar */}
      <div className="absolute top-6 inset-x-6 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 bg-[#0B1120]/85 backdrop-blur-md border border-slate-700/80 rounded-lg px-3 py-1.5 pointer-events-none">
          <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
          <span className="text-[11px] font-mono font-bold text-slate-100 uppercase tracking-wider">
            AEGIS-BRIEF CAM ({facingMode === 'environment' ? 'REAR' : 'FRONT'})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              setCaptureTargetMode((prev) =>
                prev === 'AUTO_AI' ? 'LAMPIRAN_DIRECT' : 'AUTO_AI'
              )
            }
            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase border cursor-pointer transition-colors ${
              captureTargetMode === 'LAMPIRAN_DIRECT'
                ? 'bg-[#10B981]/90 text-slate-950 border-emerald-300'
                : 'bg-[#0B1120]/85 text-[#38BDF8] border-[#38BDF8]/50'
            }`}
          >
            {captureTargetMode === 'LAMPIRAN_DIRECT'
              ? 'MODE: LANGSUNG LAMPIRAN (.DOCX)'
              : 'MODE: AUTO AI VISION'}
          </button>

          <div className="bg-[#0B1120]/85 backdrop-blur-md border border-[#10B981]/60 rounded-lg px-2.5 py-1.5 text-[10px] font-mono text-emerald-300 pointer-events-none">
            Lampiran: {attachmentCount} | Total: {capturedCount}
          </div>
        </div>
      </div>

      {/* Center Status / Feedback Toast */}
      {(isStartingCamera || cameraError || lastSnapFeedback) && (
        <div className="absolute top-20 inset-x-6 flex justify-center pointer-events-none">
          {isStartingCamera && (
            <div className="inline-flex items-center gap-2 bg-[#0B1120]/90 border border-slate-700 rounded-lg px-4 py-2 text-xs text-slate-200">
              <Loader2 className="w-4 h-4 text-[#F59E0B] animate-spin" />
              <span>Mengaktifkan sensor kamera...</span>
            </div>
          )}
          {lastSnapFeedback && (
            <div className="inline-flex items-center gap-2 bg-emerald-950/95 border border-[#10B981] rounded-lg px-4 py-2 text-xs font-bold text-emerald-200 shadow-lg">
              <span>{lastSnapFeedback}</span>
            </div>
          )}
          {cameraError && !isStartingCamera && (
            <div className="bg-amber-950/90 border border-[#F59E0B] rounded-lg px-4 py-2 text-xs text-amber-200 text-center max-w-md">
              {cameraError}
            </div>
          )}
        </div>
      )}

      {/* Bottom Floating Tactical Overlay Controls — Raised higher up so shutter button is never covered */}
      <div className="absolute inset-x-0 bottom-12 sm:bottom-10 bg-gradient-to-t from-black/95 via-black/80 to-transparent pt-6 pb-8 px-5 flex flex-col items-center space-y-3.5">
        {/* Subtle Live Watermark Preview Badge */}
        <div className="w-full max-w-lg bg-[#0B1120]/90 backdrop-blur-xs border border-[#F59E0B]/50 rounded-lg px-3 py-1.5 text-center shadow-md">
          <p className="text-[10px] sm:text-xs font-extrabold tracking-wider text-[#F59E0B] uppercase truncate">
            {watermarkBannerText}
          </p>
          <p className="text-[9px] font-mono text-slate-300 truncate">
            MULTI-SHOT AKTIF: JEPRET BANYAK FOTO BERURUTAN TANPA MENUTUP KAMERA
          </p>
        </div>

        {/* Bottom Control Row: Left TUTUP | Center JEPRET FOTO (Elevated) | Right FRONT/REAR */}
        <div className="w-full max-w-lg flex items-center justify-between gap-4 pb-2">
          {/* Close/Back Button (TUTUP) on the Left */}
          <button
            type="button"
            onClick={onClose}
            className="min-w-[88px] min-h-[48px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 active:scale-95 border border-slate-600 text-slate-100 font-bold text-xs uppercase tracking-wider shadow-lg cursor-pointer"
          >
            <X className="w-4 h-4 text-red-400" />
            <span>SELESAI</span>
          </button>

          {/* Large Tactile Shutter Button (JEPRET FOTO) in the Center — Raised with -translate-y-2 */}
          <button
            type="button"
            onClick={handleJepretFoto}
            className="group relative -translate-y-2 flex flex-col items-center justify-center px-7 py-3.5 rounded-2xl bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 border-2 border-white text-slate-950 font-extrabold shadow-[0_0_30px_rgba(245,158,11,0.65)] transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Camera className="w-6 h-6 stroke-[2.4] text-slate-950" />
              <span className="text-xs sm:text-sm tracking-wider uppercase font-black">
                JEPRET FOTO
              </span>
            </div>
          </button>

          {/* Switch Camera (Front/Rear) Button on the Right */}
          <button
            type="button"
            onClick={handleSwitchCamera}
            className="min-w-[88px] min-h-[48px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900/95 hover:bg-slate-800 active:scale-95 border border-slate-600 text-slate-100 font-bold text-xs uppercase tracking-wider shadow-lg cursor-pointer"
            title="Ganti Kamera Depan / Belakang"
          >
            <SwitchCamera className="w-4 h-4 text-[#38BDF8]" />
            <span>{facingMode === 'environment' ? 'REAR' : 'FRONT'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface CollapsibleDataCaptureTrayProps {
  photos: CapturedPhotoItem[];
  selectedPhotoId: string | null;
  onSelectPhoto: (id: string) => void;
  onCycleCategoryOverride: (id: string) => void;
  onRemovePhoto: (id: string) => void;
  onOpenFullscreenCamera: () => void;
  onOpenGalleryPicker: () => void;
  onOpenDirectLampiranPicker: () => void;
}

export const CollapsibleDataCaptureTray: React.FC<CollapsibleDataCaptureTrayProps> = ({
  photos,
  selectedPhotoId,
  onSelectPhoto,
  onCycleCategoryOverride,
  onRemovePhoto,
  onOpenFullscreenCamera,
  onOpenGalleryPicker,
  onOpenDirectLampiranPicker,
}) => {
  // Default: Collapsed state so it never blocks main workspace on mobile screens
  const [isExpanded, setIsExpanded] = useState(false);

  const analyzingCount = photos.filter((p) => p.status === 'analyzing').length;
  const attachmentPhotos = photos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  const getCategoryMeta = (cat: VisionCategory, docIndex?: number) => {
    switch (cat) {
      case 'OCR_UNDANGAN':
        return {
          badgeLabel: 'OCR UNDANGAN',
          shortLabel: 'UNDANGAN (OCR)',
          badgeClass: 'bg-[#38BDF8] text-slate-950 border-[#38BDF8]',
          borderSelected: 'border-[#38BDF8] shadow-[0_0_10px_rgba(56,189,248,0.35)]',
          icon: <ScanText className="w-2.5 h-2.5" />,
        };
      case 'MATERI_PAPARAN':
        return {
          badgeLabel: 'MATERI PAPARAN',
          shortLabel: 'PAPARAN (AI)',
          badgeClass: 'bg-[#F59E0B] text-slate-950 border-[#F59E0B]',
          borderSelected: 'border-[#F59E0B] shadow-[0_0_10px_rgba(245,158,11,0.35)]',
          icon: <Cpu className="w-2.5 h-2.5" />,
        };
      case 'DOKUMENTASI_KEGIATAN':
      default:
        return {
          badgeLabel: docIndex ? `DOKUMENTASI ${docIndex}` : 'LAMPIRAN',
          shortLabel: docIndex
            ? `DOKUMENTASI ${docIndex} (.DOCX)`
            : 'LAMPIRAN (.DOCX)',
          badgeClass: 'bg-[#10B981] text-slate-950 border-[#10B981]',
          borderSelected: 'border-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.35)]',
          icon: <FileCheck2 className="w-2.5 h-2.5" />,
        };
    }
  };

  let runningDocIndex = 0;

  return (
    <section className="bg-[#111827] border border-[#1E293B] rounded-xl px-2.5 py-2 shadow-lg transition-all">
      {/* Compact Folding Bar (Always Visible) */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex-1 min-w-[180px] inline-flex items-center gap-1.5 text-left py-1.5 px-2.5 rounded-lg bg-[#0B1120] hover:bg-slate-900 border border-slate-700/80 text-xs font-bold text-slate-100 transition-colors cursor-pointer"
        >
          {isExpanded ? (
            <>
              <ChevronDown className="w-4 h-4 text-[#F59E0B] shrink-0" />
              <span className="truncate">
                ▼ Lipat ({photos.length} Foto • {attachmentPhotos.length} Lampiran Word)
              </span>
            </>
          ) : (
            <>
              <ChevronUp className="w-4 h-4 text-[#38BDF8] shrink-0" />
              <span className="truncate">
                ▲ Tangkapan Foto ({photos.length}) • Lampiran Word: {attachmentPhotos.length}
              </span>
            </>
          )}
          {analyzingCount > 0 && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-[#F59E0B]">
              <Loader2 className="w-3 h-3 animate-spin" />
              AI...
            </span>
          )}
        </button>

        {/* Quick-Action Buttons: 📷 Kamera, 🖼️ Galeri (AI), & ➕ Lampiran Multi-Foto */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onOpenFullscreenCamera}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 border border-amber-300/70 text-slate-950 font-extrabold text-xs shadow cursor-pointer"
            title="Buka Kamera Fullscreen (Multi-Shot)"
          >
            <Camera className="w-3.5 h-3.5 stroke-[2.3]" />
            <span>Kamera</span>
          </button>

          <button
            type="button"
            onClick={onOpenDirectLampiranPicker}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/90 hover:bg-emerald-900 active:scale-95 border border-[#10B981]/70 text-emerald-200 font-bold text-xs shadow cursor-pointer"
            title="Tambah Banyak Foto Sekaligus Langsung sebagai Lampiran Dokumentasi (.docx) dengan Watermark Otomatis"
          >
            <FilePlus2 className="w-3.5 h-3.5 text-[#10B981]" />
            <span>+Lampiran ({attachmentPhotos.length})</span>
          </button>

          <button
            type="button"
            onClick={onOpenGalleryPicker}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1E293B] hover:bg-slate-700 active:scale-95 border border-slate-600 text-slate-100 font-bold text-xs shadow cursor-pointer"
            title="Pilih Banyak Foto dari Galeri (Otomatis Klasifikasi OCR / Paparan / Lampiran)"
          >
            <ImageIcon className="w-3.5 h-3.5 text-[#38BDF8]" />
            <span>Galeri AI</span>
          </button>
        </div>
      </div>

      {/* Expanded Horizontal Thumbnail Strip */}
      {isExpanded && (
        <div className="mt-2.5 pt-2.5 border-t border-slate-800">
          {photos.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-400 font-mono">
              Belum ada tangkapan foto pada sesi ini. Tekan tombol{' '}
              <span className="text-[#F59E0B] font-bold">Kamera</span>,{' '}
              <span className="text-[#10B981] font-bold">+Lampiran</span>, atau{' '}
              <span className="text-[#38BDF8] font-bold">Galeri AI</span> untuk
              menambahkan banyak foto dokumentasi sekaligus.
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 px-1">
                <span>
                  TOTAL: <strong className="text-slate-200">{photos.length} FOTO</strong>
                </span>
                <span className="text-emerald-300">
                  SIAP EKSPOR KE WORD (.DOCX):{' '}
                  <strong>{attachmentPhotos.length} FOTO LAMPIRAN WATERMARK</strong>
                </span>
              </div>

              <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                {photos.map((photo) => {
                  const isSelected = selectedPhotoId === photo.id;
                  const isAnalyzing = photo.status === 'analyzing';
                  if (photo.category === 'DOKUMENTASI_KEGIATAN') {
                    runningDocIndex += 1;
                  }
                  const docSeq =
                    photo.category === 'DOKUMENTASI_KEGIATAN'
                      ? runningDocIndex
                      : undefined;
                  const meta = getCategoryMeta(photo.category, docSeq);

                  return (
                    <div
                      key={photo.id}
                      onClick={() => onSelectPhoto(photo.id)}
                      className="shrink-0 w-36 sm:w-40 flex flex-col items-center cursor-pointer group"
                    >
                      <div
                        className={`relative w-full aspect-[16/10] rounded-lg overflow-hidden bg-[#0B1120] transition-all border-2 ${
                          isSelected
                            ? meta.borderSelected
                            : 'border-slate-700/80 hover:border-slate-500'
                        }`}
                      >
                        <img
                          src={photo.displayDataUrl}
                          alt={meta.badgeLabel}
                          className="w-full h-full object-cover"
                        />

                        {/* Category Badge */}
                        <div
                          className={`absolute top-1 left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase shadow ${meta.badgeClass}`}
                        >
                          {isAnalyzing ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            meta.icon
                          )}
                          <span>{isAnalyzing ? 'AI...' : meta.badgeLabel}</span>
                        </div>

                        {/* Manual Override & Delete Buttons */}
                        <div className="absolute top-1 right-1 flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onCycleCategoryOverride(photo.id);
                            }}
                            className="bg-slate-950/85 hover:bg-slate-800 text-slate-200 border border-slate-600 rounded p-1 transition-colors cursor-pointer"
                            title="Ubah Kategori Manual (OCR Undangan / Materi Paparan / Lampiran)"
                          >
                            <RefreshCw className="w-2.5 h-2.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemovePhoto(photo.id);
                            }}
                            className="bg-slate-950/85 hover:bg-red-900/90 text-slate-300 hover:text-white border border-slate-600 rounded p-1 transition-colors cursor-pointer"
                            title="Hapus Foto"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>

                        {/* Micro-Summary Strip */}
                        <div className="absolute inset-x-0 bottom-0 bg-[#0B1120]/90 border-t border-slate-800 px-1.5 py-0.5">
                          <p className="text-[8px] font-mono text-slate-300 truncate leading-tight uppercase">
                            {isAnalyzing
                              ? 'MEMINDAI...'
                              : photo.extractedText ||
                                photo.confidenceReason ||
                                photo.capturedAt}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`mt-1 text-[9px] font-bold tracking-tight text-center leading-tight uppercase ${
                          isSelected
                            ? 'text-[#F59E0B]'
                            : 'text-slate-300 group-hover:text-white'
                        }`}
                      >
                        {meta.shortLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
