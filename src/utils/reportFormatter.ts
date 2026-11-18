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

export function getTodayIsoDate(): string {
  const now = new Date();
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

/**
 * Renders the exact official Diskomlekau Notulen template specified in Section 4.
 */
export function buildOfficialReportText(
  metadata: MeetingMetadata,
  isiKegiatan: string
): string {
  const waktuSalam = metadata.waktuSalam || detectWaktuSalam();
  const judulKegiatan =
    metadata.judulKegiatan?.trim() ||
    'Rapat Uji Fungsi Pengadaan Armor Personel Carrier';
  const hariTanggal = metadata.hariTanggal?.trim() || '-';
  const pukul = metadata.pukul?.trim() || '-';
  const tempat = metadata.tempat?.trim() || 'Posko Utama Diskomlekau';
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

export const INITIAL_SAMPLE_REPORT: MeetingReportResult = {
  judulKegiatan: 'Rapat Uji Fungsi Pengadaan Armor Personel Carrier',
  pimpinanRapat: 'Kolonel Lek Budi, ST, MH',
  pesertaRapat:
    'Komandan Satrad 421 Teluk Naga, Staf Satrad 421 Teluk Naga, Perwakilan PT Tabel Aero, Tim Uji Fungsi',
  tempat: 'Posko Utama / Vicon Zoom Meeting',
  isiKegiatan: `1. Dasar / Latar Belakang: Rapat dilaksanakan dalam rangka koordinasi teknis dan persiapan pelaksanaan uji fungsi pengadaan Armor Personel Carrier yang merupakan sarana mobilitas perlindungan personel.

2. Jalannya Rapat / Pokok Pembahasan: Pimpinan rapat membuka kegiatan dan menyampaikan arahan terkait pentingnya profesionalisme dan ketelitian dalam pelaksanaan uji fungsi sesuai parameter teknis serta operasional yang telah disepakati. Kegiatan ini bersumber dari anggaran optimalisasi TNI AU.

3. Hasil Rapat : Seluruh pihak diminta berkomitmen dan bersinergi dalam pelaksanaan kegiatan agar berjalan dengan sebaik-baiknya.

4. Kesimpulan: Uji fungsi akan dilaksanakan dengan menjunjung tinggi standar operasional yang telah ditetapkan. Seluruh bentuk catatan evaluasi dan perbaikan selama uji fungsi wajib didokumentasikan.`,
  executiveSummary:
    'Rapat dilaksanakan dalam rangka koordinasi teknis dan persiapan pelaksanaan uji fungsi pengadaan Armor Personel Carrier yang bersumber dari anggaran optimalisasi TNI AU. Pimpinan rapat menekankan profesionalisme, ketelitian, serta sinergi seluruh pihak sesuai parameter teknis dan operasional yang disepakati.',
  actionItems: [
    {
      task: 'Melaksanakan uji fungsi pengadaan Armor Personel Carrier sesuai parameter teknis dan standar operasional',
      pic: 'Tim Uji Fungsi, Satrad 421 Teluk Naga & PT Tabel Aero',
      deadline: 'Sesuai jadwal uji fungsi',
    },
    {
      task: 'Mendokumentasikan seluruh catatan evaluasi dan perbaikan selama pelaksanaan uji fungsi',
      pic: 'Tim Uji Fungsi & Staf Satrad 421 Teluk Naga',
      deadline: 'Selama pelaksanaan kegiatan',
    },
  ],
  cleanTranscript: `[00:00] Kolonel Lek Budi, ST, MH (Pimpinan Rapat): Selamat malam, terima kasih kepada Komandan Satrad 421 Teluk Naga beserta staf, Perwakilan PT Tabel Aero, dan Tim Uji Fungsi yang telah bergabung.
[01:10] Kolonel Lek Budi, ST, MH: Rapat ini kita laksanakan dalam rangka koordinasi teknis dan persiapan pelaksanaan uji fungsi pengadaan Armor Personel Carrier sebagai sarana mobilitas perlindungan personel.`,
};
