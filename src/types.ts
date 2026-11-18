export type WaktuSalam = 'pagi' | 'siang' | 'malam';

export type CaptureMode = 'dual' | 'mic' | 'upload';

export type VisionCategory =
  | 'OCR_UNDANGAN'
  | 'MATERI_PAPARAN'
  | 'DOKUMENTASI_KEGIATAN';

export interface CapturedPhotoItem {
  id: string;
  category: VisionCategory;
  /** Stripped EXIF raw image data URL before watermark */
  cleanSourceDataUrl: string;
  /** Display / export image data URL (watermarked when DOKUMENTASI_KEGIATAN) */
  displayDataUrl: string;
  capturedAt: string;
  status: 'analyzing' | 'done' | 'error';
  confidenceReason?: string;
  /** Extracted slide bullet points / OCR text */
  extractedText?: string;
  extractedMetadata?: Partial<MeetingMetadata>;
  isSample?: boolean;
}

export interface VisionRouterResponse {
  category: VisionCategory;
  confidenceReason: string;
  judulKegiatan?: string;
  hariTanggal?: string;
  pukul?: string;
  tempat?: string;
  pimpinanRapat?: string;
  pesertaRapat?: string;
  extractedKnowledge?: string;
  isiKegiatanDraft?: string;
}

export interface MeetingMetadata {
  waktuSalam: WaktuSalam;
  judulKegiatan: string;
  tanggalIso: string;
  hariTanggal: string;
  pukul: string;
  tempat: string;
  pimpinanRapat: string;
  pesertaRapat: string;
  customGlossary: string;
}

export interface ActionItem {
  task: string;
  pic: string;
  deadline: string;
}

export interface MeetingReportResult {
  judulKegiatan?: string;
  hariTanggal?: string;
  pukul?: string;
  pimpinanRapat?: string;
  pesertaRapat?: string;
  tempat?: string;
  isiKegiatan: string;
  executiveSummary: string;
  actionItems: ActionItem[];
  cleanTranscript: string;
}

export interface AudioChunkItem {
  id: string;
  index: number;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  timestampLabel: string;
  status: 'ready' | 'processing' | 'done' | 'error';
  screenFrames?: string[];
}
