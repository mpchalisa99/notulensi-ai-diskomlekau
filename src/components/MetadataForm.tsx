import React, { useState } from 'react';
import { Calendar, Clock, MapPin, Users, UserCheck, BookOpen, RotateCcw, Plus, X } from 'lucide-react';
import type { MeetingMetadata, WaktuSalam } from '../types';
import { detectWaktuSalam, formatIndonesianDate, getTodayIsoDate } from '../utils/reportFormatter';

interface MetadataFormProps {
  metadata: MeetingMetadata;
  onChange: (updated: MeetingMetadata) => void;
}

const QUICK_PARTICIPANTS = [
  'Perwakilan Kemhan',
  'Subdisrudal Diskomlekau',
  'Para Kasubdis',
  'Para Kasatkomlek',
  'Para Kabag',
  'Staf Ahli Diskomlekau',
];

export const MetadataForm: React.FC<MetadataFormProps> = ({ metadata, onChange }) => {
  const [newParticipant, setNewParticipant] = useState('');

  const handleFieldChange = <K extends keyof MeetingMetadata>(
    key: K,
    value: MeetingMetadata[K]
  ) => {
    onChange({
      ...metadata,
      [key]: value,
    });
  };

  const handleDateChange = (isoDate: string) => {
    const formatted = formatIndonesianDate(isoDate);
    onChange({
      ...metadata,
      tanggalIso: isoDate,
      hariTanggal: formatted,
    });
  };

  const participantList = metadata.pesertaRapat
    ? metadata.pesertaRapat
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const addParticipantTag = (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    if (!participantList.includes(trimmed)) {
      const next = [...participantList, trimmed].join(', ');
      handleFieldChange('pesertaRapat', next);
    }
    setNewParticipant('');
  };

  const removeParticipantTag = (tagToRemove: string) => {
    const next = participantList.filter((item) => item !== tagToRemove).join(', ');
    handleFieldChange('pesertaRapat', next);
  };

  const handleResetToCurrentTime = () => {
    const todayIso = getTodayIsoDate();
    onChange({
      ...metadata,
      waktuSalam: detectWaktuSalam(),
      tanggalIso: todayIso,
      hariTanggal: formatIndonesianDate(todayIso),
    });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 tracking-tight">
            Metadata Rapat &amp; Parameter Laporan
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Otomatis terintegrasi ke format Notulensi Resmi Diskomlekau
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetToCurrentTime}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          title="Sinkronkan waktu salam dan tanggal hari ini"
        >
          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
          Sinkron Waktu
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Waktu Salam */}
        <div>
          <label
            htmlFor="waktuSalam"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Waktu Salam
          </label>
          <select
            id="waktuSalam"
            value={metadata.waktuSalam}
            onChange={(e) => handleFieldChange('waktuSalam', e.target.value as WaktuSalam)}
            className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-slate-100 transition-colors"
          >
            <option value="pagi">Selamat pagi (&lt; 11:00)</option>
            <option value="siang">Selamat siang (11:00–17:59)</option>
            <option value="malam">Selamat malam (&ge; 18:00)</option>
          </select>
        </div>

        {/* Pemilih Tanggal */}
        <div>
          <label
            htmlFor="tanggalIso"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Pilih Tanggal Kalender
          </label>
          <div className="relative">
            <input
              id="tanggalIso"
              type="date"
              value={metadata.tanggalIso}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2 text-sm text-slate-100 font-mono tabular-nums transition-colors"
            />
          </div>
        </div>

        {/* Hari / Tanggal Formal */}
        <div>
          <label
            htmlFor="hariTanggal"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Format Hari / Tanggal Resmi
          </label>
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="hariTanggal"
              type="text"
              value={metadata.hariTanggal}
              onChange={(e) => handleFieldChange('hariTanggal', e.target.value)}
              placeholder="Selasa, 17 November 2026"
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Judul Kegiatan */}
      <div>
        <label
          htmlFor="judulKegiatan"
          className="block text-xs font-medium text-slate-300 mb-1.5"
        >
          Judul Kegiatan / Nama Rapat
        </label>
        <input
          id="judulKegiatan"
          type="text"
          value={metadata.judulKegiatan}
          onChange={(e) => handleFieldChange('judulKegiatan', e.target.value)}
          placeholder="Contoh: Rapat Koordinasi Teknis Kesiapan Sistem Komlek & Radar TA 2026"
          className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-600 transition-colors"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Pukul */}
        <div>
          <label htmlFor="pukul" className="block text-xs font-medium text-slate-300 mb-1.5">
            Pukul Pelaksanaan
          </label>
          <div className="relative">
            <Clock className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="pukul"
              type="text"
              value={metadata.pukul}
              onChange={(e) => handleFieldChange('pukul', e.target.value)}
              placeholder="09.00 WIB s.d. selesai"
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 transition-colors"
            />
          </div>
        </div>

        {/* Tempat */}
        <div>
          <label htmlFor="tempat" className="block text-xs font-medium text-slate-300 mb-1.5">
            Tempat / Media Vicon
          </label>
          <div className="relative">
            <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="tempat"
              type="text"
              value={metadata.tempat}
              onChange={(e) => handleFieldChange('tempat', e.target.value)}
              placeholder="Vicon Zoom Meeting"
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 transition-colors"
            />
          </div>
        </div>

        {/* Pimpinan Rapat */}
        <div>
          <label
            htmlFor="pimpinanRapat"
            className="block text-xs font-medium text-slate-300 mb-1.5"
          >
            Pimpinan Rapat
          </label>
          <div className="relative">
            <UserCheck className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="pimpinanRapat"
              type="text"
              value={metadata.pimpinanRapat}
              onChange={(e) => handleFieldChange('pimpinanRapat', e.target.value)}
              placeholder="Kadiskomlekau / Sesdiskomlekau"
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Peserta Rapat */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="pesertaRapatInput"
            className="block text-xs font-medium text-slate-300"
          >
            Peserta Rapat
          </label>
          <span className="text-xs text-slate-500">
            Klik tambah cepat atau ketik langsung
          </span>
        </div>

        <div className="flex gap-2 mb-2">
          <div className="relative flex-1">
            <Users className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="pesertaRapatInput"
              type="text"
              value={metadata.pesertaRapat}
              onChange={(e) => handleFieldChange('pesertaRapat', e.target.value)}
              placeholder="Perwakilan Kemhan, Subdisrudal Diskomlekau, ..."
              className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg pl-8 pr-3 py-2 text-sm text-slate-100 transition-colors"
            />
          </div>
        </div>

        {/* Interactive Participant Preset Selector & Active List */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {QUICK_PARTICIPANTS.map((preset) => {
            const isSelected = participantList.includes(preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() =>
                  isSelected ? removeParticipantTag(preset) : addParticipantTag(preset)
                }
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-sky-500/15 border-sky-500/50 text-sky-300 font-medium'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {isSelected ? (
                  <X className="w-3 h-3 text-sky-400" />
                ) : (
                  <Plus className="w-3 h-3 text-slate-500" />
                )}
                {preset}
              </button>
            );
          })}

          <div className="flex items-center gap-1 ml-auto">
            <input
              type="text"
              value={newParticipant}
              onChange={(e) => setNewParticipant(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addParticipantTag(newParticipant);
                }
              }}
              placeholder="+ Satuan lain..."
              className="bg-slate-950/80 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-md px-2.5 py-1 text-xs text-slate-200 w-32"
            />
            {newParticipant.trim() && (
              <button
                type="button"
                onClick={() => addParticipantTag(newParticipant)}
                className="px-2 py-1 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md transition-colors cursor-pointer"
              >
                Tambah
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Custom Glossary */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label
            htmlFor="customGlossary"
            className="flex items-center gap-1.5 text-xs font-medium text-slate-300"
          >
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            Daftar Istilah / Singkatan Khusus (Custom Glossary)
          </label>
          <span className="text-xs text-slate-500">Akurasi Transkripsi AI 100%</span>
        </div>
        <textarea
          id="customGlossary"
          rows={2}
          value={metadata.customGlossary}
          onChange={(e) => handleFieldChange('customGlossary', e.target.value)}
          placeholder="Masukkan singkatan militer, nama pejabat, atau istilah teknis (pisahkan dengan koma): Kadiskomlekau, Sesdiskomlekau, Subdisrudal, Kasatkomlek, Kemhan, Alutsista, Vicon..."
          className="w-full bg-slate-950/90 border border-slate-800 focus:border-sky-500 focus:outline-none rounded-lg px-3.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 leading-relaxed transition-colors resize-y"
        />
      </div>
    </div>
  );
};
