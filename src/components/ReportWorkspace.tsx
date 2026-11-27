import React, { useState } from 'react';
import {
  Send,
  FileDown,
  Check,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  MeetingMetadata,
  MeetingReportResult,
  WaktuSalam,
} from '../types';
import { buildOfficialReportText } from '../utils/reportFormatter';
import { exportReportToDocx } from '../utils/docxExport';

interface ReportWorkspaceProps {
  metadata: MeetingMetadata;
  onChangeMetadata: (updated: MeetingMetadata) => void;
  report: MeetingReportResult;
  onUpdateReport: (updated: MeetingReportResult) => void;
  customFullText: string | null;
  onUpdateCustomFullText: (val: string | null) => void;
  screenFrames: string[];
}

export const ReportWorkspace: React.FC<ReportWorkspaceProps> = ({
  metadata,
  onChangeMetadata,
  report,
  onUpdateReport,
  customFullText,
  onUpdateCustomFullText,
  screenFrames,
}) => {
  const [copiedWA, setCopiedWA] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const autoRenderedReportText = buildOfficialReportText(metadata, report.isiKegiatan);
  const displayedFullReportText =
    customFullText !== null ? customFullText : autoRenderedReportText;

  const handleFieldChange = <K extends keyof MeetingMetadata>(
    key: K,
    value: MeetingMetadata[K]
  ) => {
    onUpdateCustomFullText(null);
    onChangeMetadata({
      ...metadata,
      [key]: value,
    });
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
        report.actionItems
      );
    } finally {
      setIsExportingDocx(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-5">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            2. Hasil Ekstraksi Otomatis &amp; Format Notulen Resmi
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Seluruh data di bawah terisi otomatis dari hasil analisis suara &amp; layar Zoom (dapat disunting langsung)
          </p>
        </div>

        {customFullText !== null && (
          <button
            type="button"
            onClick={() => onUpdateCustomFullText(null)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-950/50 border border-amber-800/60 rounded-lg hover:bg-amber-900/50 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" />
            Sinkronkan Ulang Template
          </button>
        )}
      </div>

      {/* Compact Auto-Detected Data Grid (Judul, Pimpinan, Peserta, Waktu, Tempat) */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold text-sky-400">
          Data Rapat Terdeteksi (Dari Suara &amp; Layar Zoom)
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs text-slate-400 mb-1">
              Judul Kegiatan / Rapat
            </label>
            <input
              type="text"
              value={metadata.judulKegiatan}
              onChange={(e) => handleFieldChange('judulKegiatan', e.target.value)}
              placeholder="Terdeteksi otomatis dari suara / layar Zoom..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-1.5 text-xs sm:text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Pimpinan Rapat
            </label>
            <input
              type="text"
              value={metadata.pimpinanRapat}
              onChange={(e) => handleFieldChange('pimpinanRapat', e.target.value)}
              placeholder="Terdeteksi otomatis..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-1.5 text-xs sm:text-sm text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Peserta Rapat
            </label>
            <input
              type="text"
              value={metadata.pesertaRapat}
              onChange={(e) => handleFieldChange('pesertaRapat', e.target.value)}
              placeholder="Terdeteksi otomatis dari partisipan Zoom / suara..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-1.5 text-xs sm:text-sm text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Waktu Salam
              </label>
              <select
                value={metadata.waktuSalam}
                onChange={(e) =>
                  handleFieldChange('waktuSalam', e.target.value as WaktuSalam)
                }
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              >
                <option value="pagi">pagi</option>
                <option value="siang">siang</option>
                <option value="malam">malam</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Hari / Tanggal
              </label>
              <input
                type="text"
                value={metadata.hariTanggal}
                onChange={(e) => handleFieldChange('hariTanggal', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Pukul</label>
              <input
                type="text"
                value={metadata.pukul}
                onChange={(e) => handleFieldChange('pukul', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">Tempat</label>
              <input
                type="text"
                value={metadata.tempat}
                onChange={(e) => handleFieldChange('tempat', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Official Notulen Template Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="fullNotulenTextarea"
            className="text-xs font-semibold text-slate-200"
          >
            Format Notulen Resmi Diskomlekau (Siap Kirim WA / Word)
          </label>
          <span className="text-xs text-slate-500">
            Dapat diedit langsung pada kotak di bawah
          </span>
        </div>

        <textarea
          id="fullNotulenTextarea"
          rows={19}
          value={displayedFullReportText}
          onChange={(e) => onUpdateCustomFullText(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-xl p-4 text-xs sm:text-sm text-slate-100 font-sans leading-relaxed resize-y"
        />
      </div>

      {/* Primary Action Buttons: Salin WA & Unduh Word (.docx) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={handleCopyWhatsApp}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-sky-500 hover:bg-sky-400 active:scale-[0.99] transition-all cursor-pointer shadow-sm"
        >
          {copiedWA ? (
            <>
              <Check className="w-4 h-4" />
              <span>Notulen Berhasil Disalin!</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>Salin Notulen (WA)</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleExportDocx}
          disabled={isExportingDocx}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] transition-all cursor-pointer shadow-sm disabled:opacity-50"
        >
          <FileDown className="w-4 h-4" />
          <span>
            {isExportingDocx ? 'Menyiapkan Dokumen...' : 'Unduh Word (.docx)'}
          </span>
        </button>
      </div>

      {/* Dokumentasi Terlampir (From Zoom Screen Capture) */}
      {screenFrames.length > 0 && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="text-xs font-semibold text-slate-300">
            Lampiran Dokumentasi Layar Zoom ({screenFrames.length} Foto)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {screenFrames.map((frame, i) => (
              <div
                key={i}
                className="group relative rounded-lg overflow-hidden border border-slate-800 aspect-video bg-slate-900"
              >
                <img
                  src={frame}
                  alt={`Dokumentasi Rapat ${i + 1}`}
                  className="w-full h-full object-cover"
                />
                <a
                  href={frame}
                  download={`Dokumentasi_Rapat_${i + 1}.jpg`}
                  className="absolute inset-0 bg-slate-950/70 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 text-xs font-medium text-white transition-opacity"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh Foto
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Transcript Section */}
      <div className="border-t border-slate-800/80 pt-3">
        <button
          type="button"
          onClick={() => setShowTranscript((prev) => !prev)}
          className="flex items-center justify-between w-full text-xs font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          <span>Lihat Transkrip Lengkap Percakapan &amp; Tindak Lanjut</span>
          {showTranscript ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>

        {showTranscript && (
          <div className="mt-3 space-y-3">
            <textarea
              rows={8}
              value={report.cleanTranscript}
              onChange={(e) =>
                onUpdateReport({ ...report, cleanTranscript: e.target.value })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 font-mono leading-relaxed"
              placeholder="Transkrip percakapan rapat..."
            />
          </div>
        )}
      </div>
    </div>
  );
};
