import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  ExternalLink,
  FileCheck,
  Globe,
  Mic,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  AudioChunkItem,
  CapturedPhotoItem,
  GeminiFailureInfo,
  MeetingMetadata,
} from '../types';
import { buildExternalAiFallbackPrompt, formatBytes } from '../utils/reportFormatter';

interface FreeWebAlternative {
  name: string;
  url: string;
  badge: string;
  capabilities: string;
  bestFor: string;
}

const FREE_AI_ALTERNATIVES: FreeWebAlternative[] = [
  {
    name: 'Qwen Chat (Alibaba)',
    url: 'https://chat.qwen.ai',
    badge: 'GRATIS MULTIMODAL',
    capabilities: 'Audio, Gambar Slide/Undangan, Dokumen & Resume Detil',
    bestFor: 'Pengganti langsung paling lengkap (mendukung upload audio + foto + teks)',
  },
  {
    name: 'ChatGPT Web (OpenAI)',
    url: 'https://chatgpt.com',
    badge: 'GRATIS HARIAN',
    capabilities: 'Gambar Kamera/Upload, Analisis Slide, Korelasi & Resume',
    bestFor: 'Analisis gambar paparan & penyusunan laporan resmi terstruktur',
  },
  {
    name: 'Claude AI (Anthropic)',
    url: 'https://claude.ai',
    badge: 'GRATIS',
    capabilities: 'OCR Dokumen, Analisis Visual & Penulisan Resume Tajam',
    bestFor: 'Korelasi lintas-data dan bahasa dinas terstruktur',
  },
  {
    name: 'DeepSeek Chat',
    url: 'https://chat.deepseek.com',
    badge: 'GRATIS UNLIMITED',
    capabilities: 'Penalaran Mendalam & Sintesis Transkrip Panjang',
    bestFor: 'Menggabungkan banyak chunk transkrip rapat tanpa batas kuota',
  },
  {
    name: 'Microsoft Copilot',
    url: 'https://copilot.microsoft.com',
    badge: 'GRATIS',
    capabilities: 'Analisis Gambar & Ringkasan Cepat',
    bestFor: 'Alternatif cepat via browser tanpa konfigurasi',
  },
  {
    name: 'Google AI Studio Web',
    url: 'https://aistudio.google.com',
    badge: 'WEB GRATIS',
    capabilities: 'Audio, Gambar, Video & Gemini 3.1 Pro via Web',
    bestFor: 'Gunakan langsung via web jika API key server sedang limit',
  },
  {
    name: 'Riverside Transcription',
    url: 'https://riverside.fm/transcription',
    badge: 'TRANSKRIP GRATIS',
    capabilities: 'Ubah File Audio (.webm/.mp3/.wav/.m4a) ke Teks Gratis',
    bestFor: 'Transkripsi gratis tanpa batas untuk file chunk audio 5 menit',
  },
  {
    name: 'TurboScribe',
    url: 'https://turboscribe.ai',
    badge: 'TRANSKRIP AI',
    capabilities: 'Transkripsi Audio Akurat Bahasa Indonesia (Gratis 3 File/Hari)',
    bestFor: 'Ekstrak teks rekaman rapat sebelum disusun menjadi resume',
  },
];

interface GeminiFallbackPanelProps {
  failureInfo: GeminiFailureInfo;
  chunks: AudioChunkItem[];
  capturedPhotos: CapturedPhotoItem[];
  metadata: MeetingMetadata;
  onDismiss: () => void;
  onApplyExternalResult: (pastedText: string) => void;
  onRetryGemini: () => void;
}

export const GeminiFallbackPanel: React.FC<GeminiFallbackPanelProps> = ({
  failureInfo,
  chunks,
  capturedPhotos,
  metadata,
  onDismiss,
  onApplyExternalResult,
  onRetryGemini,
}) => {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [pastedExternalText, setPastedExternalText] = useState('');
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  const handleCopyPrompt = async () => {
    const promptText = buildExternalAiFallbackPrompt(chunks, capturedPhotos, metadata);
    try {
      await navigator.clipboard.writeText(promptText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = promptText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2500);
  };

  const handleDownloadChunkAudio = (chunk: AudioChunkItem) => {
    const ext = chunk.mimeType.includes('mp4')
      ? 'm4a'
      : chunk.mimeType.includes('ogg')
      ? 'ogg'
      : chunk.mimeType.includes('mpeg')
      ? 'mp3'
      : chunk.mimeType.includes('wav')
      ? 'wav'
      : 'webm';
    const url = URL.createObjectURL(chunk.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AEGIS_Chunk_${chunk.index + 1}_${chunk.timestampLabel.replace(/[^a-zA-Z0-9_-]+/g, '_')}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const handleApplyPasted = () => {
    if (!pastedExternalText.trim()) return;
    onApplyExternalResult(pastedExternalText.trim());
    setAppliedSuccess(true);
    setTimeout(() => setAppliedSuccess(false), 2500);
  };

  return (
    <section className="bg-gradient-to-b from-[#1E1410] to-[#111827] border-2 border-[#F59E0B]/80 rounded-xl p-3 shadow-2xl space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-amber-800/60 pb-2">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-[#F59E0B]/70 flex items-center justify-center shrink-0 mt-0.5">
            <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-extrabold tracking-wide text-amber-200 uppercase">
              Kegagalan Layanan Gemini ({failureInfo.model}) — Gunakan Alternatif Web AI Gratis
            </h3>
            <p className="text-[11px] text-slate-300 leading-snug mt-0.5">
              {failureInfo.message}
            </p>
            <p className="text-[10px] font-mono text-amber-300/90 mt-0.5">
              Semua chunk rekaman &amp; gambar Anda tetap tersimpan aman di brankas lokal sampai Anda hapus.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          className="p-1 rounded-lg bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-700 cursor-pointer shrink-0"
          title="Tutup panel alternatif"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step 1: Quick Data Export Tools */}
      <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-2.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-[#38BDF8] uppercase tracking-wider inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" />
            1. Ekspor Data Sesi Untuk Situs AI Alternatif
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#2E6DB4] hover:bg-[#3579C4] border border-[#38BDF8]/60 text-white text-[11px] font-bold cursor-pointer"
            >
              {copiedPrompt ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Prompt &amp; Data Tersalin!</span>
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  <span>Salin Prompt &amp; Data Sesi Lengkap</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onRetryGemini}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-[11px] font-semibold cursor-pointer"
            >
              <span>Coba Gemini Lagi</span>
            </button>
          </div>
        </div>

        {chunks.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-slate-800/80">
            <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
              <Mic className="w-3 h-3 text-emerald-400" />
              <span>
                Unduh file Audio Chunk (untuk diunggah ke Qwen Chat / Riverside / TurboScribe / Google AI Studio):
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {chunks.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleDownloadChunkAudio(c)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-emerald-300 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>
                    Chunk #{c.index + 1} ({c.timestampLabel} • {formatBytes(c.sizeBytes)})
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Free Web Alternatives Grid */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-bold text-amber-300 uppercase tracking-wider inline-flex items-center gap-1.5">
          <Globe className="w-3.5 h-3.5" />
          2. Pilih Situs Web AI Gratis Pengganti Langsung Gemini
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1.5">
          {FREE_AI_ALTERNATIVES.map((site) => (
            <a
              key={site.url}
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-[#0B1120] hover:bg-slate-900 border border-slate-700/90 hover:border-[#38BDF8] rounded-lg p-2 flex flex-col justify-between gap-1 transition-colors"
            >
              <div className="space-y-0.5">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-extrabold text-white group-hover:text-[#38BDF8] truncate">
                    {site.name}
                  </span>
                  <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-[#38BDF8] shrink-0" />
                </div>
                <span className="inline-block text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {site.badge}
                </span>
                <p className="text-[10px] text-slate-300 leading-tight pt-0.5">
                  {site.capabilities}
                </p>
              </div>
              <p className="text-[9px] text-slate-400 italic leading-tight">
                {site.bestFor}
              </p>
            </a>
          ))}
        </div>
      </div>

      {/* Step 3: Paste Back Result */}
      <div className="bg-[#0B1120] border border-slate-800 rounded-lg p-2.5 space-y-1.5">
        <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider inline-flex items-center gap-1.5">
          <FileCheck className="w-3.5 h-3.5" />
          3. Tempel Hasil Resume dari Web AI Alternatif ke Laporan Resmi
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea
            rows={2}
            value={pastedExternalText}
            onChange={(e) => setPastedExternalText(e.target.value)}
            placeholder="Tempel hasil resume / notulensi dari Qwen, ChatGPT, Claude, atau DeepSeek di sini untuk langsung dimasukkan ke Laporan & Ekspor Word (.docx)..."
            className="flex-1 bg-[#111827] border border-slate-700 focus:border-emerald-400 focus:outline-none rounded-lg px-2.5 py-1.5 text-[11px] text-slate-100 placeholder:text-slate-500"
          />
          <button
            type="button"
            disabled={!pastedExternalText.trim()}
            onClick={handleApplyPasted}
            className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[11px] font-extrabold uppercase tracking-wide shrink-0 cursor-pointer"
          >
            {appliedSuccess ? 'Diterapkan!' : 'Terapkan ke Laporan'}
          </button>
        </div>
      </div>
    </section>
  );
};
