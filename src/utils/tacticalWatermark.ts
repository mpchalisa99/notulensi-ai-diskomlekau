import type { CapturedPhotoItem } from '../types';

/**
 * Strips all sensitive camera EXIF/GPS metadata by re-encoding the image through an HTML5 Canvas.
 */
export async function stripExifAndNormalizeImage(sourceDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width || 800, img.height || 600));
      canvas.width = Math.max(640, Math.round((img.width || 800) * scale));
      canvas.height = Math.max(360, Math.round((img.height || 450) * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}

/**
 * Strips EXIF and burns a permanent, high-contrast bottom banner watermark onto the image:
 * "[JUDUL KEGIATAN] - [TANGGAL]"
 */
export async function burnTacticalBannerWatermark(
  cleanSourceDataUrl: string,
  judulKegiatan: string,
  hariTanggal: string
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(img.width || 800, img.height || 600));
      canvas.width = Math.max(640, Math.round((img.width || 800) * scale));
      canvas.height = Math.max(360, Math.round((img.height || 450) * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(cleanSourceDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const stripH = Math.round(canvas.height * 0.13);
      const stripY = canvas.height - stripH;

      // High-contrast dark tactical banner
      ctx.fillStyle = 'rgba(11, 17, 32, 0.92)';
      ctx.fillRect(0, stripY, canvas.width, stripH);

      // Top accent line
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, stripY);
      ctx.lineTo(canvas.width, stripY);
      ctx.stroke();

      const titleUpper = (judulKegiatan?.trim() || 'RAPAT OPS KOMUNIKASI').toUpperCase();
      const dateUpper = (hariTanggal?.trim() || 'SELASA, 17 NOVEMBER 2026').toUpperCase();
      const bannerText = `${titleUpper} - ${dateUpper}`;

      // Main high-contrast amber-gold watermark text
      ctx.fillStyle = '#F59E0B';
      ctx.font = `bold ${Math.max(13, Math.round(canvas.width * 0.022))}px sans-serif`;
      ctx.fillText(bannerText, 18, stripY + Math.round(stripH * 0.52));

      // Sub-line security stamp
      ctx.fillStyle = '#E2E8F0';
      ctx.font = `${Math.max(10, Math.round(canvas.width * 0.015))}px monospace`;
      ctx.fillText(
        'AEGIS-BRIEF DISKOMLEKAU • EXIF STRIPPED • DOKUMENTASI RESMI TERVERIFIKASI',
        18,
        stripY + Math.round(stripH * 0.84)
      );

      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => resolve(cleanSourceDataUrl);
    img.src = cleanSourceDataUrl;
  });
}

function createSampleSvgDataUrl(svgString: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgString.trim())}`;
}

const sampleOcrSvg = createSampleSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#0F172A"/>
    <rect x="28" y="14" width="264" height="172" rx="4" fill="#F8FAFC" stroke="#94A3B8" stroke-width="2"/>
    <circle cx="68" cy="44" r="13" fill="#0F172A"/>
    <circle cx="68" cy="44" r="9" fill="#F59E0B"/>
    <rect x="92" y="32" width="154" height="8" rx="2" fill="#0F172A"/>
    <rect x="92" y="46" width="115" height="6" rx="2" fill="#475569"/>
    <line x1="46" y1="68" x2="274" y2="68" stroke="#0F172A" stroke-width="2"/>
    <rect x="46" y="80" width="85" height="6" rx="2" fill="#334155"/>
    <rect x="140" y="80" width="122" height="6" rx="2" fill="#0F172A"/>
    <rect x="46" y="94" width="85" height="6" rx="2" fill="#334155"/>
    <rect x="140" y="94" width="106" height="6" rx="2" fill="#0F172A"/>
    <rect x="46" y="108" width="85" height="6" rx="2" fill="#334155"/>
    <rect x="140" y="108" width="128" height="6" rx="2" fill="#0F172A"/>
    <rect x="46" y="126" width="224" height="5" rx="2" fill="#64748B"/>
    <rect x="46" y="138" width="196" height="5" rx="2" fill="#64748B"/>
  </svg>
`);

const samplePaparanSvg = createSampleSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#0B1120"/>
    <rect x="20" y="14" width="280" height="172" rx="6" fill="#E2E8F0" stroke="#475569" stroke-width="4"/>
    <rect x="34" y="28" width="252" height="22" rx="3" fill="#1E3A8A"/>
    <rect x="44" y="35" width="160" height="8" rx="2" fill="#F8FAFC"/>
    <rect x="34" y="60" width="130" height="8" rx="2" fill="#1E293B"/>
    <rect x="34" y="76" width="118" height="6" rx="2" fill="#475569"/>
    <rect x="34" y="88" width="124" height="6" rx="2" fill="#475569"/>
    <rect x="34" y="100" width="105" height="6" rx="2" fill="#475569"/>
    <rect x="34" y="116" width="120" height="48" rx="4" fill="#CBD5E1"/>
    <rect x="176" y="62" width="108" height="102" rx="4" fill="#DBEAFE" stroke="#3B82F6" stroke-width="1.5"/>
    <rect x="190" y="122" width="14" height="32" fill="#2563EB"/>
    <rect x="212" y="102" width="14" height="52" fill="#1D4ED8"/>
    <rect x="234" y="86" width="14" height="68" fill="#10B981"/>
    <rect x="256" y="74" width="14" height="80" fill="#F59E0B"/>
  </svg>
`);

const sampleDokumentasiSvg = createSampleSvgDataUrl(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
    <rect width="320" height="200" fill="#13261F"/>
    <polygon points="10,152 90,45 170,152" fill="#1E3A2F" stroke="#10B981" stroke-width="1.5"/>
    <polygon points="150,152 235,38 310,152" fill="#193026" stroke="#10B981" stroke-width="1.5"/>
    <rect x="55" y="110" width="210" height="44" rx="4" fill="#0F1F18" stroke="#34D399" stroke-width="1.5"/>
    <circle cx="115" cy="88" r="14" fill="#2E4C3B"/>
    <circle cx="165" cy="84" r="14" fill="#2E4C3B"/>
    <circle cx="215" cy="88" r="14" fill="#2E4C3B"/>
    <rect x="0" y="156" width="320" height="44" fill="#0B1120"/>
    <line x1="0" y1="156" x2="320" y2="156" stroke="#F59E0B" stroke-width="2"/>
    <rect x="14" y="166" width="210" height="7" rx="2" fill="#F59E0B"/>
    <rect x="14" y="179" width="250" height="5" rx="2" fill="#94A3B8"/>
  </svg>
`);

export const INITIAL_CAPTURED_PHOTOS: CapturedPhotoItem[] = [
  {
    id: 'sample-ocr-1',
    category: 'OCR_UNDANGAN',
    cleanSourceDataUrl: sampleOcrSvg,
    displayDataUrl: sampleOcrSvg,
    capturedAt: 'Auto-OCR Ready',
    status: 'done',
    confidenceReason: 'Surat Undangan / Nota Dinas Rapat',
    extractedText: 'Undangan Rapat Uji Fungsi Pengadaan Armor Personel Carrier',
    isSample: true,
  },
  {
    id: 'sample-paparan-2',
    category: 'MATERI_PAPARAN',
    cleanSourceDataUrl: samplePaparanSvg,
    displayDataUrl: samplePaparanSvg,
    capturedAt: 'Slide AI Ready',
    status: 'done',
    confidenceReason: 'Slide Paparan & Parameter Teknis Uji Fungsi',
    extractedText:
      'Parameter teknis uji fungsi Armor Personel Carrier bersumber dari anggaran optimalisasi TNI AU.',
    isSample: true,
  },
  {
    id: 'sample-dok-3',
    category: 'DOKUMENTASI_KEGIATAN',
    cleanSourceDataUrl: sampleDokumentasiSvg,
    displayDataUrl: sampleDokumentasiSvg,
    capturedAt: 'EXIF Stripped',
    status: 'done',
    confidenceReason: 'Dokumentasi Situasi Rapat & Lapangan (Watermarked)',
    extractedText: 'RAPAT UJI FUNGSI PENGADAAN ARMOR PERSONEL CARRIER',
    isSample: true,
  },
];
