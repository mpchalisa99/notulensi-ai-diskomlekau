import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { ActionItem, CapturedPhotoItem, MeetingMetadata } from '../types';
import { burnTacticalBannerWatermark } from './tacticalWatermark';

function dataUrlToUint8Array(dataUrl: string): Uint8Array | null {
  try {
    if (
      !dataUrl.startsWith('data:image/jpeg;base64,') &&
      !dataUrl.startsWith('data:image/png;base64,') &&
      !dataUrl.startsWith('data:image/webp;base64,')
    ) {
      return null;
    }
    const base64 = dataUrl.split(',')[1];
    if (!base64) return null;
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Normalizes any portrait or landscape image into a strict uniform 16:9 landscape canvas (e.g. 1280x720)
 * with a dark-slate tactical letterbox/pillarbox frame so images never stretch or distort.
 */
async function normalizeToLandscapeCanvas(
  sourceDataUrl: string,
  judulKegiatan: string,
  hariTanggal: string
): Promise<string> {
  const watermarked = await burnTacticalBannerWatermark(
    sourceDataUrl,
    judulKegiatan,
    hariTanggal
  );

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const targetW = 1280;
      const targetH = 720; // 16:9 landscape frame

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(watermarked);
        return;
      }

      // Fill background with solid dark tactical slate (#0F172A)
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, targetW, targetH);

      const natW = img.naturalWidth || img.width || 800;
      const natH = img.naturalHeight || img.height || 600;

      // Calculate object-contain scaling to fit inside 16:9 without cropping or distortion
      const scale = Math.min(targetW / natW, targetH / natH);
      const drawW = Math.round(natW * scale);
      const drawH = Math.round(natH * scale);
      const offsetX = Math.round((targetW - drawW) / 2);
      const offsetY = Math.round((targetH - drawH) / 2);

      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      resolve(canvas.toDataURL('image/jpeg', 0.90));
    };
    img.onerror = () => resolve(watermarked);
    img.src = watermarked;
  });
}

export async function exportReportToDocx(
  fullReportText: string,
  metadata: MeetingMetadata,
  executiveSummary?: string,
  actionItems?: ActionItem[],
  attachmentPhotos?: CapturedPhotoItem[]
): Promise<void> {
  const lines = fullReportText.split(/\r?\n/);

  const reportParagraphs: Paragraph[] = lines.map((line) => {
    const trimmed = line.trim();
    const isGreetingOrHeader =
      trimmed.startsWith('Selamat ') ||
      trimmed.startsWith('Yth.') ||
      trimmed.startsWith('Ysh.') ||
      trimmed.startsWith('Para Kasubdis');
    const isNumberedSection = /^[1-9]\.\s+/.test(trimmed);

    return new Paragraph({
      spacing: {
        after: trimmed === '' ? 120 : 80,
        line: 276,
      },
      children: [
        new TextRun({
          text: line,
          font: 'Arial',
          size: 22, // 11pt
          bold: isGreetingOrHeader || isNumberedSection,
        }),
      ],
    });
  });

  const extraChildren: (Paragraph | Table)[] = [];

  if (executiveSummary && executiveSummary.trim().length > 0) {
    extraChildren.push(
      new Paragraph({
        spacing: { before: 360, after: 120 },
        heading: HeadingLevel.HEADING_3,
        children: [
          new TextRun({
            text: 'RINGKASAN EKSEKUTIF (EXECUTIVE SUMMARY)',
            font: 'Arial',
            size: 22,
            bold: true,
          }),
        ],
      }),
      new Paragraph({
        spacing: { after: 240, line: 276 },
        children: [
          new TextRun({
            text: executiveSummary.trim(),
            font: 'Arial',
            size: 22,
          }),
        ],
      })
    );
  }

  if (actionItems && actionItems.length > 0) {
    extraChildren.push(
      new Paragraph({
        spacing: { before: 240, after: 140 },
        heading: HeadingLevel.HEADING_3,
        children: [
          new TextRun({
            text: 'DAFTAR TINDAK LANJUT (ACTION ITEMS)',
            font: 'Arial',
            size: 22,
            bold: true,
          }),
        ],
      })
    );

    const tableRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: ['No', 'Tindak Lanjut / Tugas', 'PIC / Pelaksana', 'Target / Batas Waktu'].map(
          (headerText, idx) =>
            new TableCell({
              width: {
                size: idx === 0 ? 8 : idx === 1 ? 52 : 20,
                type: WidthType.PERCENTAGE,
              },
              children: [
                new Paragraph({
                  alignment: AlignmentType.LEFT,
                  children: [
                    new TextRun({
                      text: headerText,
                      font: 'Arial',
                      size: 20,
                      bold: true,
                    }),
                  ],
                }),
              ],
            })
        ),
      }),
      ...actionItems.map(
        (item, index) =>
          new TableRow({
            children: [
              String(index + 1),
              item.task || '-',
              item.pic || '-',
              item.deadline || '-',
            ].map(
              (cellText) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: cellText,
                          font: 'Arial',
                          size: 20,
                        }),
                      ],
                    }),
                  ],
                })
            ),
          })
      ),
    ];

    extraChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: '94A3B8' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: '94A3B8' },
          left: { style: BorderStyle.SINGLE, size: 1, color: '94A3B8' },
          right: { style: BorderStyle.SINGLE, size: 1, color: '94A3B8' },
          insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
          insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
        },
        rows: tableRows,
      })
    );
  }

  // Embed ALL photos from attachmentPhotos[] (DOKUMENTASI_KEGIATAN / LAMPIRAN) in a 2-Column Symmetric Table Grid
  const lampiranPhotos = (attachmentPhotos || []).filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  if (lampiranPhotos.length > 0) {
    extraChildren.push(
      new Paragraph({
        spacing: { before: 320, after: 140 },
        heading: HeadingLevel.HEADING_3,
        children: [
          new TextRun({
            text: `LAMPIRAN DOKUMENTASI KEGIATAN (${lampiranPhotos.length} FOTO LANDSCAPE)`,
            font: 'Arial',
            size: 22,
            bold: true,
          }),
        ],
      })
    );

    // Group photos into pairs for 2-column symmetric rows
    const photoRowsData: CapturedPhotoItem[][] = [];
    for (let i = 0; i < lampiranPhotos.length; i += 2) {
      photoRowsData.push(lampiranPhotos.slice(i, i + 2));
    }

    const docxTableRows: TableRow[] = [];

    for (let rowIndex = 0; rowIndex < photoRowsData.length; rowIndex++) {
      const pair = photoRowsData[rowIndex];
      const cell1Cells: any[] = [];
      const cell2Cells: any[] = [];

      // Process Photo 1 in Row
      const photo1 = pair[0];
      const globalIdx1 = rowIndex * 2;
      const normalizedUrl1 = await normalizeToLandscapeCanvas(
        photo1.cleanSourceDataUrl || photo1.displayDataUrl,
        metadata.judulKegiatan,
        metadata.hariTanggal
      );
      const imgBytes1 = dataUrlToUint8Array(normalizedUrl1);

      if (imgBytes1) {
        cell1Cells.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 60, after: 40 },
            children: [
              new ImageRun({
                data: imgBytes1,
                transformation: {
                  width: 280,
                  height: 158, // Exact 16:9 landscape aspect ratio in docx units
                },
                type: 'jpg',
              }),
            ],
          })
        );
      }
      cell1Cells.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `Dokumentasi ${globalIdx1 + 1}: ${
                metadata.judulKegiatan || 'Kegiatan Rapat'
              }`,
              font: 'Arial',
              size: 16,
              bold: true,
              italics: true,
            }),
          ],
        })
      );

      // Process Photo 2 in Row (if exists)
      if (pair[1]) {
        const photo2 = pair[1];
        const globalIdx2 = rowIndex * 2 + 1;
        const normalizedUrl2 = await normalizeToLandscapeCanvas(
          photo2.cleanSourceDataUrl || photo2.displayDataUrl,
          metadata.judulKegiatan,
          metadata.hariTanggal
        );
        const imgBytes2 = dataUrlToUint8Array(normalizedUrl2);

        if (imgBytes2) {
          cell2Cells.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 60, after: 40 },
              children: [
                new ImageRun({
                  data: imgBytes2,
                  transformation: {
                    width: 280,
                    height: 158,
                  },
                  type: 'jpg',
                }),
              ],
            })
          );
        }
        cell2Cells.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: `Dokumentasi ${globalIdx2 + 1}: ${
                  metadata.judulKegiatan || 'Kegiatan Rapat'
                }`,
                font: 'Arial',
                size: 16,
                bold: true,
                italics: true,
              }),
            ],
          })
        );
      } else {
        // Empty placeholder cell for symmetric alignment when odd number of photos
        cell2Cells.push(
          new Paragraph({
            children: [new TextRun({ text: '' })],
          })
        );
      }

      docxTableRows.push(
        new TableRow({
          cantSplit: true, // Prevents row from splitting awkwardly across page breaks
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { top: 120, bottom: 160, left: 100, right: 100 },
              children: cell1Cells,
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              margins: { top: 120, bottom: 160, left: 100, right: 100 },
              children: cell2Cells,
            }),
          ],
        })
      );
    }

    extraChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
        rows: docxTableRows,
      })
    );
  }

  const doc = new Document({
    creator: 'AEGIS-BRIEF DISKOMLEKAU',
    title: `Laporan Kegiatan - ${metadata.judulKegiatan || 'Rapat'}`,
    description:
      'AEGIS-BRIEF DISKOMLEKAU — Laporan Pelaksanaan Kegiatan & Notulensi Rapat Resmi',
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new TextRun({
                text: 'LAPORAN PELAKSANAAN KEGIATAN / NOTULENSI RAPAT',
                font: 'Arial',
                size: 26,
                bold: true,
              }),
            ],
          }),
          ...reportParagraphs,
          ...extraChildren,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeTitle = (metadata.judulKegiatan || 'Laporan_Kegiatan_Diskomlekau')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const fileName = `AEGIS_BRIEF_${safeTitle}_${metadata.tanggalIso || 'Resmi'}.docx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
