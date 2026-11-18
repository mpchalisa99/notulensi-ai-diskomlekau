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

      const titleUpper = (
        judulKegiatan?.trim() || 'DOKUMENTASI KEGIATAN DISKOMLEKAU'
      ).toUpperCase();
      const dateUpper = (hariTanggal?.trim() || '-').toUpperCase();
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
