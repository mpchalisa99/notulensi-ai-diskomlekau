export type WaktuSalam = 'pagi' | 'siang' | 'malam';

export type CaptureMode = 'dual' | 'mic' | 'upload';

export type VisionCategory =
  | 'OCR_UNDANGAN'
  | 'MATERI_PAPARAN'
  | 'DOKUMENTASI_KEGIATAN';

export type PhotoCaptureSource = 'camera' | 'upload' | 'screen';

export interface CapturedPhotoItem {
  id: string;
  category: VisionCategory;
  /** Origin of image: camera capture, manual file upload, or Zoom screen frame */
  captureSource?: PhotoCaptureSource;
  /** Stripped EXIF raw image data URL before watermark */
  cleanSourceDataUrl: string;
  /** Display / export image data URL (watermarked when DOKUMENTASI_KEGIATAN) */
  displayDataUrl: string;
  capturedAt: string;
  status: 'analyzing' | 'done' | 'error';
  confidenceReason?: string;
  /** Extracted slide bullet points / OCR text / visual description */
  extractedText?: string;
  /** Detailed visual observation for correlation even on documentation photos */
  visualCorrelationNote?: string;
  /** Draft numbered report section extracted from slide/document */
  isiKegiatanDraft?: string;
  extractedMetadata?: Partial<MeetingMetadata>;
  errorMessage?: string;
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
  visualCorrelationNote?: string;
  isiKegiatanDraft?: string;
  modelUsed?: string;
  keySlotUsed?: number;
  failoverTriggered?: boolean;
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
  correlationAnalysis?: string;
  detailedResume?: string;
  actionItems: ActionItem[];
  cleanTranscript: string;
  modelUsed?: string;
  keySlotUsed?: number;
  failoverTriggered?: boolean;
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
  source?: CaptureMode;
  screenFrames?: string[];
  /** Stored chronological transcript/translation for cross-modal fusion */
  transcript?: string;
  /** Stored chunk-level summary */
  isiKegiatanSummary?: string;
  /** Stored chunk-level action items */
  extractedActionItems?: ActionItem[];
  /** Timestamp when background analysis completed */
  analyzedAt?: string;
  /** Error message if analysis failed */
  errorMessage?: string;
}

export interface GeminiFailureInfo {
  occurred: boolean;
  message: string;
  failureReason?: string;
  model: string;
  attemptedKeySlots?: number;
  timestamp: string;
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
  captureSource?: PhotoCaptureSource;
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
  captureSource?: PhotoCaptureSource;
  capturedAt: string;
  slideTitle?: string;
  extractedKnowledge: string;
  isiKegiatanDraft?: string;
}

export interface UnifiedDokumentasiContext {
  count: number;
  captions: string[];
  visualObservations: Array<{
    photoId: string;
    captureSource?: PhotoCaptureSource;
    capturedAt: string;
    observation: string;
  }>;
}

export interface UnifiedSessionContextPayload {
  audioStreamData: UnifiedAudioSegmentContext[];
  ocrUndanganData: UnifiedOcrUndanganContext[];
  materiPaparanData: UnifiedMateriPaparanContext[];
  dokumentasiKegiatanData: UnifiedDokumentasiContext;
  currentMetadata: MeetingMetadata;
}
