import type {
  AudioChunkItem,
  CapturedPhotoItem,
  MeetingMetadata,
  MeetingReportResult,
  UnifiedSessionContextPayload,
  WaktuSalam,
} from '../types';

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
      '1. [Konteks & Pokok Bahasan: Menunggu input rekaman suara per 5 menit atau pindaian kamera/upload gambar sesi ini.]\n\n2. [Analisis Teknis, Pembahasan & Temuan: -]\n\n3. [Keputusan, Direktif Pimpinan & Langkah Tindak Lanjut: -]',
    executiveSummary: '',
    correlationAnalysis: '',
    detailedResume: '',
    actionItems: [],
    cleanTranscript: '',
  };
}

/**
 * Enforces strict double-newline (`\n\n`) spacing between every numbered point (`1.`, `2.`, `3.`, etc.)
 */
export function normalizeNumberedPointsSpacing(rawBody: string): string {
  if (!rawBody || !rawBody.trim()) {
    return '1. [Konteks & Pokok Bahasan: Menunggu input rekaman suara per 5 menit atau pindaian kamera/upload gambar sesi ini.]\n\n2. [Analisis Teknis, Pembahasan & Temuan: -]\n\n3. [Keputusan, Direktif Pimpinan & Langkah Tindak Lanjut: -]';
  }

  return rawBody
    .replace(/\r\n/g, '\n')
    .replace(/\n+\s*(?=\d+\.\s+)/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Builds the Unified Multi-Modal Session Context Payload (`buildUnifiedSessionContext`)
 * combining all active session inputs:
 * 1. Audio Stream Data (all 5-minute chunks)
 * 2. Scanned Invitation Data (`OCR_UNDANGAN`) from camera & manual upload
 * 3. Scanned Slide / Document Data (`MATERI_PAPARAN`) from camera & manual upload
 * 4. Field Activity Photos & Visual Observations (`DOKUMENTASI_KEGIATAN`) from camera & manual upload
 */
export function buildUnifiedSessionContext(
  chunks: AudioChunkItem[],
  capturedPhotos: CapturedPhotoItem[],
  currentMetadata: MeetingMetadata
): UnifiedSessionContextPayload {
  const sortedChunks = [...chunks].sort((a, b) => a.index - b.index);

  const audioStreamData = sortedChunks
    .filter((c) => Boolean(c.transcript || c.isiKegiatanSummary))
    .map((c) => ({
      chunkIndex: c.index + 1,
      timestampLabel: c.timestampLabel,
      durationSec: c.durationSec,
      transcript: c.transcript || '',
      isiKegiatanSummary: c.isiKegiatanSummary || '',
      actionItems: c.extractedActionItems || [],
    }));

  const ocrUndanganData = capturedPhotos
    .filter((p) => p.category === 'OCR_UNDANGAN' && p.status === 'done')
    .map((p) => ({
      photoId: p.id,
      captureSource: p.captureSource || 'camera',
      capturedAt: p.capturedAt,
      judulKegiatan: p.extractedMetadata?.judulKegiatan,
      hariTanggal: p.extractedMetadata?.hariTanggal,
      pukul: p.extractedMetadata?.pukul,
      tempat: p.extractedMetadata?.tempat,
      pimpinanRapat: p.extractedMetadata?.pimpinanRapat,
      pesertaRapat: p.extractedMetadata?.pesertaRapat,
      extractedText: p.extractedText || p.visualCorrelationNote || '',
    }));

  const materiPaparanData = capturedPhotos
    .filter((p) => p.category === 'MATERI_PAPARAN' && p.status === 'done')
    .map((p) => ({
      photoId: p.id,
      captureSource: p.captureSource || 'camera',
      capturedAt: p.capturedAt,
      slideTitle: p.extractedMetadata?.judulKegiatan,
      extractedKnowledge: p.extractedText || p.visualCorrelationNote || p.confidenceReason || '',
      isiKegiatanDraft: p.isiKegiatanDraft || '',
    }));

  const lampiranPhotos = capturedPhotos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  const dokumentasiKegiatanData = {
    count: lampiranPhotos.length,
    captions: lampiranPhotos.map(
      (p, idx) =>
        `Dokumentasi ${idx + 1} (${p.captureSource === 'upload' ? 'Upload Manual' : 'Kamera'}): ${
          currentMetadata.judulKegiatan || 'Dokumentasi Kegiatan'
        } — ${currentMetadata.hariTanggal || ''} (${p.capturedAt})`
    ),
    visualObservations: lampiranPhotos
      .filter((p) => Boolean(p.visualCorrelationNote || p.extractedText))
      .map((p) => ({
        photoId: p.id,
        captureSource: p.captureSource || 'camera',
        capturedAt: p.capturedAt,
        observation: p.visualCorrelationNote || p.extractedText || '',
      })),
  };

  return {
    audioStreamData,
    ocrUndanganData,
    materiPaparanData,
    dokumentasiKegiatanData,
    currentMetadata,
  };
}

/**
 * Builds a ready-to-paste prompt containing all local session data (chunk transcripts, OCR, slides, metadata)
 * so the operator can paste directly into free external web AI alternatives if Gemini fails.
 */
export function buildExternalAiFallbackPrompt(
  chunks: AudioChunkItem[],
  capturedPhotos: CapturedPhotoItem[],
  metadata: MeetingMetadata
): string {
  const context = buildUnifiedSessionContext(chunks, capturedPhotos, metadata);
  return `Anda adalah Perwira Staf Ahli TNI Angkatan Udara (DISKOMLEKAU).
Tolong gabungkan, korelasikan, dan buat RESUME RAPAT YANG DETIL serta LAPORAN PELAKSANAAN KEGIATAN resmi berdasarkan data berikut:

1. METADATA RAPAT:
- Judul: ${metadata.judulKegiatan || '(Identifikasi dari transkrip/undangan)'}
- Hari/Tanggal: ${metadata.hariTanggal || '-'}
- Jam: ${metadata.pukul || '-'}
- Tempat: ${metadata.tempat || '-'}
- Pimpinan: ${metadata.pimpinanRapat || '-'}
- Peserta: ${metadata.pesertaRapat || '-'}
- Glosarium Istilah: ${metadata.customGlossary}

2. DATA CHUNK REKAMAN AUDIO (PER 5 MENIT) YANG SUDAH TERKUMPUL (${chunks.length} chunk):
${
  context.audioStreamData.length > 0
    ? context.audioStreamData
        .map(
          (seg) =>
            `[Chunk #${seg.chunkIndex} | ${seg.timestampLabel}]\nRingkasan: ${seg.isiKegiatanSummary}\nTranskrip: ${seg.transcript}`
        )
        .join('\n\n')
    : '(Belum ada transkrip otomatis — silakan unggah file audio chunk yang diunduh ke situs transkripsi gratis lalu tempel teksnya di sini)'
}

3. HASIL ANALISA GAMBAR UNDANGAN / SLIDE / FOTO KAMERA & UPLOAD MANUAL (${capturedPhotos.length} gambar):
- OCR Undangan: ${JSON.stringify(context.ocrUndanganData, null, 2)}
- Materi Paparan: ${JSON.stringify(context.materiPaparanData, null, 2)}
- Dokumentasi Kegiatan: ${JSON.stringify(context.dokumentasiKegiatanData, null, 2)}

FORMAT OUTPUT YANG DIMINTA:
A. Poin-poin Isi Laporan Kegiatan (bernomor 1., 2., 3., dst. dengan bahasa dinas TNI AU yang lugas & analitis).
B. Korelasi Audio & Visual (keterkaitan pembahasan suara dengan gambar undangan/slide/dokumentasi).
C. Resume Detil Rapat (pembahasan lengkap, angka/spesifikasi teknis, kendala, keputusan komando).
D. Daftar Tindak Lanjut / Action Items (Tugas, PIC/Satuan, Target Waktu).`;
}

/**
 * Renders the exact official Diskomlekau Notulen template with clean paragraph & item spacing (`\n\n`)
 */
export function buildOfficialReportText(
  metadata: MeetingMetadata,
  isiKegiatan: string,
  attachmentCount: number = 0
): string {
  const waktuSalam = metadata.waktuSalam || detectWaktuSalam();
  const judulKegiatan =
    metadata.judulKegiatan?.trim() || '[Judul Kegiatan Belum Diisi]';
  const hariTanggal = metadata.hariTanggal?.trim() || '-';
  const pukul = metadata.pukul?.trim() || '-';
  const tempat = metadata.tempat?.trim() || '-';
  const pimpinanRapat = metadata.pimpinanRapat?.trim() || '-';
  const pesertaRapat = metadata.pesertaRapat?.trim() || '-';

  const formattedBody = normalizeNumberedPointsSpacing(isiKegiatan);

  const lampiranSuffix =
    attachmentCount > 0
      ? `(Dokumentasi terlampir - ${attachmentCount} foto)`
      : `(Dokumentasi terlampir)`;

  return `Selamat ${waktuSalam}

Yth. Kadiskomlekau
Ysh. Sesdiskomlekau,
Para Kasubdis, Kasatkomlek, para Kabag.


Mohon ijin melaporkan kegiatan ${judulKegiatan} yang dilaksanakan pada:

- Hari,tanggal: ${hariTanggal}
- Pukul: ${pukul}
- Tempat: ${tempat}
- Pimpinan rapat: ${pimpinanRapat}
- Peserta rapat : ${pesertaRapat}


${formattedBody}


Demikian laporan pelaksanaan kegiatan ini kami sampaikan. Terima kasih, selamat ${waktuSalam}. ${lampiranSuffix}`;
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
