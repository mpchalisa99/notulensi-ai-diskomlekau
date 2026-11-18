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
  /** Draft 4-point report section extracted from slide/document */
  isiKegiatanDraft?: string;
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
  /** Stored chronological transcript/translation for cross-modal fusion */
  transcript?: string;
  /** Stored chunk-level 4-point summary */
  isiKegiatanSummary?: string;
  /** Stored chunk-level action items */
  extractedActionItems?: ActionItem[];
}

export interface UnifiedAudioSegmentContext {
  chunkIndex: number;
  timestampLabel: string;
  durationSec: number;
  transcript: string;
  isiKegiatanSummary: string;
  actionItems: ActionItem[];
}

export interface UnifiedOcrUndanganContext {
  photoId: string;
  capturedAt: string;
  judulKegiatan?: string;
  hariTanggal?: string;
  pukul?: string;
  tempat?: string;
  pimpinanRapat?: string;
  pesertaRapat?: string;
  extractedText?: string;
}

export interface UnifiedMateriPaparanContext {
  photoId: string;
  capturedAt: string;
  slideTitle?: string;
  extractedKnowledge: string;
  isiKegiatanDraft?: string;
}

export interface UnifiedDokumentasiContext {
  count: number;
  captions: string[];
}

export interface UnifiedSessionContextPayload {
  audioStreamData: UnifiedAudioSegmentContext[];
  ocrUndanganData: UnifiedOcrUndanganContext[];
  materiPaparanData: UnifiedMateriPaparanContext[];
  dokumentasiKegiatanData: UnifiedDokumentasiContext;
  currentMetadata: MeetingMetadata;
}
