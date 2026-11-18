import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ScanText,
  Cpu,
  FileCheck2,
  Video,
  VideoOff,
  Loader2,
  Upload,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  CapturedPhotoItem,
  MeetingMetadata,
  VisionCategory,
} from '../types';

interface TacticalCameraPreviewProps {
  metadata: MeetingMetadata;
  selectedPhoto: CapturedPhotoItem | null;
  onAutonomousPhotoCapture: (rawDataUrls: string[]) => void;
}

export const TacticalCameraPreview: React.FC<TacticalCameraPreviewProps> = ({
  metadata,
  selectedPhoto,
  onAutonomousPhotoCapture,
}) => {
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [shutterFlash, setShutterFlash] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraLive(false);
  };

  const snapFrameFromVideo = (): boolean => {
    const videoEl = videoRef.current;
    if (!videoEl || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      return false;
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);

    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 180);

    onAutonomousPhotoCapture([dataUrl]);
    return true;
  };

  const startLiveCamera = async (snapAfterOpen: boolean = false) => {
    setCameraError(null);
    setIsStartingCamera(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser tidak mendukung akses kamera langsung.');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
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
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }
      setIsCameraLive(true);

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsCameraLive(false);
      });

      if (snapAfterOpen && videoEl) {
        setTimeout(() => {
          snapFrameFromVideo();
        }, 450);
      }
    } catch {
      setCameraError('Membuka akses kamera perangkat langsung...');
      cameraInputRef.current?.click();
    } finally {
      setIsStartingCamera(false);
    }
  };

  useEffect(() => {
    startLiveCamera(false);
    return () => {
      stopCameraStream();
    };
  }, []);

  const toggleLiveCamera = async () => {
    setCameraError(null);
    if (isCameraLive) {
      stopCameraStream();
      return;
    }
    await startLiveCamera(false);
  };

  const handleAmbilFotoClick = async () => {
    setCameraError(null);
    if (isCameraLive && snapFrameFromVideo()) {
      return;
    }
    await startLiveCamera(true);
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const promises: Promise<string>[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (!file.type.startsWith('image/')) continue;
      promises.push(
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(typeof reader.result === 'string' ? reader.result : '');
          };
          reader.readAsDataURL(file);
        })
      );
    }

    Promise.all(promises).then((urls) => {
      const valid = urls.filter(Boolean);
      if (valid.length > 0) {
        onAutonomousPhotoCapture(valid);
      }
    });

    e.target.value = '';
  };

  const watermarkBannerText = `${(
    metadata.judulKegiatan || 'RAPAT OPS KOMUNIKASI'
  ).toUpperCase()} - ${(metadata.hariTanggal || '17 NOVEMBER 2026').toUpperCase()}`;

  return (
    <div className="space-y-1">
      {/* Direct Hardware Camera Input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilesSelected}
        className="hidden"
      />
      {/* Multi-Image Upload Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesSelected}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-1 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
            ACTIVE CAMERA PREVIEW
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/40">
            AUTONOMOUS AI ROUTER
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleLiveCamera}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors cursor-pointer ${
              isCameraLive
                ? 'bg-[#10B981]/20 text-[#10B981] border-[#10B981]/60'
                : 'bg-[#111827] text-slate-300 border-slate-700 hover:text-white'
            }`}
            title="Aktifkan/Matikan Live WebRTC Camera"
          >
            {isCameraLive ? (
              <>
                <VideoOff className="w-3 h-3 text-[#10B981]" />
                <span>Live Cam On</span>
              </>
            ) : (
              <>
                <Video className="w-3 h-3 text-[#38BDF8]" />
                <span>Live Cam</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#111827] text-slate-300 border border-slate-700 hover:text-white cursor-pointer"
            title="Unggah satu atau banyak foto (AI otomatis mengklasifikasikan OCR / Paparan / Lampiran)"
          >
            <Upload className="w-2.5 h-2.5 text-[#F59E0B]" />
            <span>Multi-Foto</span>
          </button>
        </div>
      </div>

      {/* Camera Viewport Box with Tactical Brackets, Watermark & AMBIL FOTO button */}
      <div className="relative w-full h-40 sm:h-48 rounded-xl overflow-hidden bg-[#111827] border border-[#1E293B] shadow-lg select-none">
        <video
          ref={videoRef}
          muted
          playsInline
          className={`w-full h-full object-cover ${isCameraLive ? 'block' : 'hidden'}`}
        />

        {!isCameraLive && selectedPhoto && (
          <img
            src={selectedPhoto.displayDataUrl}
            alt={selectedPhoto.category}
            className="w-full h-full object-cover"
          />
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0B1120]/95 via-[#0B1120]/60 to-transparent" />

        {/* 4 Tactical Amber Corner Brackets */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 w-6 h-6 border-t-2 border-l-2 border-[#F59E0B]/90 rounded-tl-sm" />
        <div className="pointer-events-none absolute top-2.5 right-2.5 w-6 h-6 border-t-2 border-r-2 border-[#F59E0B]/90 rounded-tr-sm" />
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 w-6 h-6 border-b-2 border-l-2 border-[#F59E0B]/40 rounded-bl-sm" />
        <div className="pointer-events-none absolute bottom-2.5 right-2.5 w-6 h-6 border-b-2 border-r-2 border-[#F59E0B]/40 rounded-br-sm" />

        {/* Top-left autonomous router info badge */}
        <div className="absolute top-3 left-4 right-4 flex items-center justify-between pointer-events-none">
          <span className="bg-[#0B1120]/85 backdrop-blur-xs border border-slate-700 text-[9px] sm:text-[10px] font-mono text-slate-200 px-2 py-0.5 rounded truncate">
            ZERO-FRICTION AI: AUTO-DETEKSI UNDANGAN (OCR) &bull; PAPARAN &bull; LAMPIRAN
          </span>
        </div>

        {/* Bottom-Left Tactical Watermark Text & Bottom-Right AMBIL FOTO Button */}
        <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1 pr-1">
            <p className="text-[11px] sm:text-xs font-extrabold tracking-wide text-[#F59E0B] drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] truncate uppercase">
              {watermarkBannerText}
            </p>
            <p className="text-[9px] font-mono text-slate-300/90 truncate">
              AEGIS-BRIEF DISKOMLEKAU &bull; EXIF STRIPPED &bull;{' '}
              {selectedPhoto?.confidenceReason || 'SIAP POTRET OTOMATIS'}
            </p>
          </div>

          <button
            type="button"
            onClick={handleAmbilFotoClick}
            disabled={isStartingCamera}
            className={`shrink-0 flex flex-col items-center justify-center px-3 py-1.5 rounded-lg bg-gradient-to-b from-[#F59E0B] to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-95 border border-amber-300/80 text-slate-950 font-extrabold shadow-lg transition-all cursor-pointer disabled:opacity-50 ${
              shutterFlash ? 'ring-4 ring-white brightness-125' : ''
            }`}
            title="Potret langsung — AI otomatis mendeteksi Undangan (OCR), Slide Paparan, atau Lampiran Kegiatan"
          >
            {isStartingCamera ? (
              <Loader2 className="w-5 h-5 text-slate-950 animate-spin" />
            ) : (
              <Camera className="w-5 h-5 stroke-[2.2] text-slate-950" />
            )}
            <span className="text-[9px] tracking-wider uppercase mt-0.5 text-white drop-shadow-xs">
              {isStartingCamera ? 'BUKA CAM...' : 'AMBIL FOTO'}
            </span>
          </button>
        </div>
      </div>

      {cameraError && (
        <p className="text-[10px] text-[#F59E0B] px-1">{cameraError}</p>
      )}
    </div>
  );
};

interface AutonomousDataCaptureTrayProps {
  photos: CapturedPhotoItem[];
  selectedPhotoId: string | null;
  onSelectPhoto: (id: string) => void;
  onCycleCategoryOverride: (id: string) => void;
  onRemovePhoto: (id: string) => void;
  onAddPhotosClick: () => void;
}

export const AutonomousDataCaptureTray: React.FC<AutonomousDataCaptureTrayProps> = ({
  photos,
  selectedPhotoId,
  onSelectPhoto,
  onCycleCategoryOverride,
  onRemovePhoto,
  onAddPhotosClick,
}) => {
  const getCategoryMeta = (cat: VisionCategory) => {
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
          badgeLabel: 'LAMPIRAN',
          shortLabel: 'LAMPIRAN (DOC)',
          badgeClass: 'bg-[#10B981] text-slate-950 border-[#10B981]',
          borderSelected: 'border-[#10B981] shadow-[0_0_10px_rgba(16,185,129,0.35)]',
          icon: <FileCheck2 className="w-2.5 h-2.5" />,
        };
    }
  };

  return (
    <section className="bg-[#111827] border border-[#1E293B] rounded-xl p-2.5 shadow-inner space-y-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-mono text-slate-400">
          {photos.length} TANGKAPAN
        </span>
        <h3 className="text-[11px] font-bold tracking-wider text-slate-200 uppercase text-center">
          TANGKAPAN DATA &amp; LAMPIRAN
        </h3>
        <button
          type="button"
          onClick={onAddPhotosClick}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#38BDF8] hover:text-sky-300 cursor-pointer"
        >
          <Camera className="w-3 h-3" />
          <span>+ Foto</span>
        </button>
      </div>

      {/* Horizontal / 4-column Gallery Tray */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((photo) => {
          const isSelected = selectedPhotoId === photo.id;
          const isAnalyzing = photo.status === 'analyzing';
          const meta = getCategoryMeta(photo.category);

          return (
            <div
              key={photo.id}
              onClick={() => onSelectPhoto(photo.id)}
              className="flex flex-col items-center cursor-pointer group"
            >
              <div
                className={`relative w-full aspect-[16/11] rounded-lg overflow-hidden bg-[#0B1120] transition-all border-2 ${
                  isSelected ? meta.borderSelected : 'border-slate-700/80 hover:border-slate-500'
                }`}
              >
                <img
                  src={photo.displayDataUrl}
                  alt={meta.badgeLabel}
                  className="w-full h-full object-cover"
                />

                {/* Top-Left Category Badge (Sky Blue / Amber Gold / Emerald Green) */}
                <div
                  className={`absolute top-1 left-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[7px] font-extrabold tracking-wider uppercase shadow ${meta.badgeClass}`}
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  ) : (
                    meta.icon
                  )}
                  <span>{isAnalyzing ? 'KLASIFIKASI AI...' : meta.badgeLabel}</span>
                </div>

                {/* Top-Right Manual Override Toggle & Remove Controls */}
                <div className="absolute top-1 right-1 flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCycleCategoryOverride(photo.id);
                    }}
                    className="bg-slate-950/85 hover:bg-slate-800 text-slate-200 border border-slate-600 rounded p-0.5 transition-colors cursor-pointer"
                    title="Ubah Klasifikasi Kategori Manual (OCR Undangan / Materi Paparan / Lampiran)"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePhoto(photo.id);
                    }}
                    className="bg-slate-950/85 hover:bg-red-900/90 text-slate-300 hover:text-white border border-slate-600 rounded p-0.5 transition-colors cursor-pointer"
                    title="Hapus Foto"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>

                {/* Bottom Micro-Summary Strip */}
                <div className="absolute inset-x-0 bottom-0 bg-[#0B1120]/90 border-t border-slate-800 px-1 py-0.5">
                  <p className="text-[7px] font-mono text-slate-300 truncate leading-tight uppercase">
                    {isAnalyzing
                      ? 'VISION ROUTER MEMINDAI...'
                      : photo.extractedText || photo.confidenceReason || photo.capturedAt}
                  </p>
                </div>
              </div>

              <span
                className={`mt-1 text-[9px] sm:text-[10px] font-bold tracking-tight text-center leading-tight uppercase ${
                  isSelected ? 'text-[#F59E0B]' : 'text-slate-300 group-hover:text-white'
                }`}
              >
                {meta.shortLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};
