/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strips sensitive camera EXIF metadata and standardizes all images into a clean,
 * professional landscape format (16:9 aspect ratio, 1280x720) with proportional scaling
 * and letterboxing/cropping so all photos are straight and uniform.
 */
export async function stripExifAndNormalizeImage(sourceDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const naturalW = img.naturalWidth || img.width || 1280;
      const naturalH = img.naturalHeight || img.height || 720;

      const targetW = 1280;
      const targetH = 720; // Standard 16:9 landscape

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(sourceDataUrl);
        return;
      }

      // Fill background dark navy slate
      ctx.fillStyle = '#0B1120';
      ctx.fillRect(0, 0, targetW, targetH);

      // Proportional fit (contain/cover) to landscape 16:9
      const imgAspect = naturalW / naturalH;
      const targetAspect = targetW / targetH;

      let drawW = targetW;
      let drawH = targetH;
      let offsetX = 0;
      let offsetY = 0;

      if (imgAspect > targetAspect) {
        // Image is wider than 16:9 -> fit width, letterbox top/bottom
        drawW = targetW;
        drawH = targetW / imgAspect;
        offsetY = (targetH - drawH) / 2;
      } else {
        // Image is taller (portrait) or square -> fit height, letterbox left/right (straightened landscape framing)
        drawH = targetH;
        drawW = targetH * imgAspect;
        offsetX = (targetW - drawW) / 2;
      }

      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
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
        width: img.naturalWidth || img.width || 1280,
        height: img.naturalHeight || img.height || 720,
      });
    };
    img.onerror = () => resolve({ width: 1280, height: 720 });
    img.src = dataUrl;
  });
}

/**
 * Strips EXIF, standardizes to landscape, and burns a permanent, high-contrast bottom banner watermark onto the image:
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

      const targetW = 1280;
      const targetH = 720;

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(cleanSourceDataUrl);
        return;
      }

      ctx.fillStyle = '#0B1120';
      ctx.fillRect(0, 0, targetW, targetH);

      const imgAspect = naturalW / naturalH;
      const targetAspect = targetW / targetH;

      let drawW = targetW;
      let drawH = targetH;
      let offsetX = 0;
      let offsetY = 0;

      if (imgAspect > targetAspect) {
        drawW = targetW;
        drawH = targetW / imgAspect;
        offsetY = (targetH - drawH) / 2;
      } else {
        drawH = targetH;
        drawW = targetH * imgAspect;
        offsetX = (targetW - drawW) / 2;
      }

      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      const stripH = 92;
      const stripY = targetH - stripH;

      // High-contrast dark tactical banner
      ctx.fillStyle = 'rgba(11, 17, 32, 0.94)';
      ctx.fillRect(0, stripY, targetW, stripH);

      // Top accent line
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, stripY);
      ctx.lineTo(targetW, stripY);
      ctx.stroke();

      const titleUpper = (
        judulKegiatan?.trim() || 'DOKUMENTASI KEGIATAN DISKOMLEKAU'
      ).toUpperCase();
      const dateUpper = (hariTanggal?.trim() || '-').toUpperCase();
      const bannerText = `${titleUpper} - ${dateUpper}`;

      // Main high-contrast amber-gold watermark text
      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText(bannerText, 20, stripY + 36, targetW - 40);

      // Sub-line security stamp
      ctx.fillStyle = '#E2E8F0';
      ctx.font = '13px monospace';
      ctx.fillText(
        'AEGIS-BRIEF DISKOMLEKAU • EXIF STRIPPED • UNIFORM LANDSCAPE • DOKUMENTASI RESMI TERVERIFIKASI',
        20,
        stripY + 70,
        targetW - 40
      );

      resolve(canvas.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => resolve(cleanSourceDataUrl);
    img.src = cleanSourceDataUrl;
  });
}
