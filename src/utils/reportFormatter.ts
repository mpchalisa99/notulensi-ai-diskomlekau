import type { MeetingMetadata, MeetingReportResult, WaktuSalam } from '../types';

const HARI_INDONESIA = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
];

const BULAN_INDONESIA = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function detectWaktuSalam(date: Date = new Date()): WaktuSalam {
  const hour = date.getHours();
  if (hour < 11) return 'pagi';
  if (hour < 18) return 'siang';
  return 'malam';
}

export function detectCurrentTimeRange(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}.${mm} WIB s.d. selesai`;
}

export function formatIndonesianDate(isoDateString: string): string {
  if (!isoDateString) return '';
  const parts = isoDateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return isoDateString;
  const [year, month, day] = parts;
  const dateObj = new Date(year, month - 1, day);
  const namaHari = HARI_INDONESIA[dateObj.getDay()];
  const namaBulan = BULAN_INDONESIA[dateObj.getMonth()];
  return `${namaHari}, ${day} ${namaBulan} ${year}`;
}

export function getTodayIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDurationHMS(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;
  return [hours, minutes, seconds].map((v) => String(v).padStart(2, '0')).join(':');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function createCleanSessionMetadata(now: Date = new Date()): MeetingMetadata {
  const iso = getTodayIsoDate(now);
  return {
    waktuSalam: detectWaktuSalam(now),
    judulKegiatan: '',
    tanggalIso: iso,
    hariTanggal: formatIndonesianDate(iso),
    pukul: detectCurrentTimeRange(now),
    tempat: '',
    pimpinanRapat: '',
    pesertaRapat: '',
    customGlossary:
      'Kadiskomlekau, Sesdiskomlekau, Diskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau, TNI AU, Vicon',
  };
}

export function createCleanSessionReport(): MeetingReportResult {
  return {
    judulKegiatan: '',
    hariTanggal: '',
    pukul: '',
    pimpinanRapat: '',
    pesertaRapat: '',
    tempat: '',
    isiKegiatan:
      '1. Dasar / Latar Belakang: -\n\n2. Jalannya Rapat / Pokok Pembahasan: -\n\n3. Hasil Rapat : -\n\n4. Kesimpulan: -',
    executiveSummary: '',
    actionItems: [],
    cleanTranscript: '',
  };
}

/**
 * Renders the exact official Diskomlekau Notulen template dynamically bound to current metadata & isiKegiatan.
 */
export function buildOfficialReportText(
  metadata: MeetingMetadata,
  isiKegiatan: string
): string {
  const waktuSalam = metadata.waktuSalam || detectWaktuSalam();
  const judulKegiatan =
    metadata.judulKegiatan?.trim() || '[Judul Kegiatan Belum Diisi]';
  const hariTanggal = metadata.hariTanggal?.trim() || '-';
  const pukul = metadata.pukul?.trim() || '-';
  const tempat = metadata.tempat?.trim() || '-';
  const pimpinanRapat = metadata.pimpinanRapat?.trim() || '-';
  const pesertaRapat = metadata.pesertaRapat?.trim() || '-';
  const body =
    isiKegiatan?.trim() ||
    `1. Dasar / Latar Belakang: -\n\n2. Jalannya Rapat / Pokok Pembahasan: -\n\n3. Hasil Rapat : -\n\n4. Kesimpulan: -`;

  return `Selamat ${waktuSalam}

Yth. Kadiskomlekau 
Ysh. Sesdiskomlekau, 
Para Kasubdis, Kasatkomlek, para Kabag.


Mohon ijin melaporkan kegiatan ${judulKegiatan} yang dilaksanakan pada:

hari /tanggal: ${hariTanggal}
pukul: ${pukul}
tempat: ${tempat}
pimpinan rapat: ${pimpinanRapat}
peserta rapat : ${pesertaRapat}


${body}


Demikian laporan pelaksanaan kegiatan ini kami sampaikan. Terima kasih, selamat ${waktuSalam}. (Dokumentasi terlampir)`;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
