/**
 * Strips all sensitive camera EXIF/GPS metadata by re-encoding the image through an HTML5 Canvas
 * while strictly preserving the image's natural aspect ratio.
 */
export async function stripExifAndNormalizeImage(sourceDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const naturalW = img.naturalWidth || img.width || 1280;
      const naturalH = img.naturalHeight || img.height || 720;
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(320, Math.round(naturalW * scale));
      canvas.height = Math.max(240, Math.round(naturalH * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(sourceDataUrl);
    img.src = sourceDataUrl;
  });
}

/**
 * Returns the pixel width and height of a Data URL image so .docx export can preserve exact aspect ratio.
 */
export async function getImageDimensions(
  dataUrl: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 800,
        height: img.naturalHeight || img.height || 450,
      });
    };
    img.onerror = () => resolve({ width: 800, height: 450 });
    img.src = dataUrl;
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
      const naturalW = img.naturalWidth || img.width || 1280;
      const naturalH = img.naturalHeight || img.height || 720;
      const maxDim = 1280;
      const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(320, Math.round(naturalW * scale));
      canvas.height = Math.max(240, Math.round(naturalH * scale));

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(cleanSourceDataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const stripH = Math.max(44, Math.round(canvas.height * 0.13));
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

      const titleUpper = (
        judulKegiatan?.trim() || 'DOKUMENTASI KEGIATAN DISKOMLEKAU'
      ).toUpperCase();
      const dateUpper = (hariTanggal?.trim() || '-').toUpperCase();
      const bannerText = `${titleUpper} - ${dateUpper}`;

      // Main high-contrast amber-gold watermark text
      ctx.fillStyle = '#F59E0B';
      const mainFontSize = Math.max(12, Math.round(canvas.width * 0.022));
      ctx.font = `bold ${mainFontSize}px sans-serif`;
      ctx.fillText(bannerText, 16, stripY + Math.round(stripH * 0.52), canvas.width - 32);

      // Sub-line security stamp
      ctx.fillStyle = '#E2E8F0';
      const subFontSize = Math.max(9, Math.round(canvas.width * 0.015));
      ctx.font = `${subFontSize}px monospace`;
      ctx.fillText(
        'AEGIS-BRIEF DISKOMLEKAU • EXIF STRIPPED • DOKUMENTASI RESMI TERVERIFIKASI',
        16,
        stripY + Math.round(stripH * 0.84),
        canvas.width - 32
      );

      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(cleanSourceDataUrl);
    img.src = cleanSourceDataUrl;
  });
}
