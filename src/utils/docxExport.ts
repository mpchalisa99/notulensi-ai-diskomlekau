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

function dataUrlToUint8Array(dataUrl: string): Uint8Array | null {
  try {
    if (!dataUrl.startsWith('data:image/jpeg;base64,') && !dataUrl.startsWith('data:image/png;base64,')) {
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

export async function exportReportToDocx(
  fullReportText: string,
  metadata: MeetingMetadata,
  executiveSummary?: string,
  actionItems?: ActionItem[],
  capturedPhotos?: CapturedPhotoItem[]
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

  // Embed LAMPIRAN (DOKUMENTASI_KEGIATAN) photos directly into the .docx
  const lampiranPhotos = (capturedPhotos || []).filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  );

  if (lampiranPhotos.length > 0) {
    extraChildren.push(
      new Paragraph({
        spacing: { before: 320, after: 140 },
        heading: HeadingLevel.HEADING_3,
        children: [
          new TextRun({
            text: 'LAMPIRAN DOKUMENTASI KEGIATAN (WATERMARKED)',
            font: 'Arial',
            size: 22,
            bold: true,
          }),
        ],
      })
    );

    lampiranPhotos.forEach((photo, idx) => {
      const imgBytes = dataUrlToUint8Array(photo.displayDataUrl);
      if (imgBytes) {
        extraChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 80 },
            children: [
              new ImageRun({
                data: imgBytes,
                transformation: {
                  width: 480,
                  height: 270,
                },
                type: 'jpg',
              }),
            ],
          })
        );
      }

      extraChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({
              text: `Lampiran Foto ${idx + 1}: ${
                metadata.judulKegiatan || 'Dokumentasi Kegiatan'
              } — ${metadata.hariTanggal || ''} (${photo.capturedAt})`,
              font: 'Arial',
              size: 18,
              italics: true,
            }),
          ],
        })
      );
    });
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
