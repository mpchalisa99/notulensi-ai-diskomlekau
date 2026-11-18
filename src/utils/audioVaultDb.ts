import type { AudioChunkItem, CapturedPhotoItem, MeetingMetadata, MeetingReportResult } from '../types';

const DB_NAME = 'aegis_audio_vault';
const DB_VERSION = 1;
const CHUNKS_STORE = 'audio_chunks';
const ARCHIVES_STORE = 'session_archives';

export interface ArchivedSessionRecord {
  id: string;
  savedAt: string;
  metadata: MeetingMetadata;
  report: MeetingReportResult;
  fullReportText: string;
  chunkCount: number;
  attachmentCount: number;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB tidak tersedia pada browser ini.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, { keyPath: 'id' });
        store.createIndex('index', 'index', { unique: false });
      }
      if (!db.objectStoreNames.contains(ARCHIVES_STORE)) {
        db.createObjectStore(ARCHIVES_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Persists a completed audio chunk immediately into IndexedDB (`aegis_audio_vault`)
 * so zero audio data is lost under OS memory pressure or app switching.
 */
export async function saveAudioChunkToVault(chunk: AudioChunkItem): Promise<void> {
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readwrite');
      const store = tx.objectStore(CHUNKS_STORE);
      store.put({
        id: chunk.id,
        index: chunk.index,
        blob: chunk.blob,
        mimeType: chunk.mimeType,
        sizeBytes: chunk.sizeBytes,
        durationSec: chunk.durationSec,
        timestampLabel: chunk.timestampLabel,
        status: chunk.status,
        screenFrames: chunk.screenFrames || [],
        savedAt: Date.now(),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Non-fatal fallback if private browsing blocks IDB
  }
}

/**
 * Loads all stored audio chunks from `aegis_audio_vault`.
 */
export async function loadAudioChunksFromVault(): Promise<AudioChunkItem[]> {
  try {
    const db = await openVaultDb();
    return await new Promise<AudioChunkItem[]>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readonly');
      const store = tx.objectStore(CHUNKS_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        db.close();
        const items = (req.result || []) as AudioChunkItem[];
        items.sort((a, b) => a.index - b.index);
        resolve(items);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return [];
  }
}

/**
 * Deletes a single audio chunk from `aegis_audio_vault`.
 */
export async function removeAudioChunkFromVault(id: string): Promise<void> {
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readwrite');
      tx.objectStore(CHUNKS_STORE).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // ignore
  }
}

/**
 * Clears all audio chunks in `aegis_audio_vault` when resetting or exiting a session.
 */
export async function clearAudioVaultChunks(): Promise<void> {
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readwrite');
      tx.objectStore(CHUNKS_STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // ignore
  }
}

/**
 * Saves the completed session draft into the local archive (`aegis_audio_vault`) upon "Simpan & Keluar".
 */
export async function saveSessionDraftToArchive(
  metadata: MeetingMetadata,
  report: MeetingReportResult,
  fullReportText: string,
  chunks: AudioChunkItem[],
  photos: CapturedPhotoItem[]
): Promise<ArchivedSessionRecord | null> {
  const attachmentCount = photos.filter(
    (p) => p.category === 'DOKUMENTASI_KEGIATAN'
  ).length;

  const record: ArchivedSessionRecord = {
    id: `archive-${Date.now()}`,
    savedAt: new Date().toLocaleString('id-ID'),
    metadata,
    report,
    fullReportText,
    chunkCount: chunks.length,
    attachmentCount,
  };

  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ARCHIVES_STORE, 'readwrite');
      tx.objectStore(ARCHIVES_STORE).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Fallback to localStorage for metadata/text summary
  }

  try {
    localStorage.setItem('aegis_last_saved_archive', JSON.stringify(record));
  } catch {
    // ignore quota errors
  }

  return record;
}

/**
 * Generates a tiny 1-second near-silent WAV data URL so mobile browsers (Android Chrome / iOS Safari)
 * maintain an active MediaSession when the user switches to WhatsApp, PDF viewers, or locks the screen.
 */
export function createSilentLoopWavDataUrl(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Sub-audible 1-LSB oscillation so OS audio subsystem never auto-culls the stream as zero-filled silence
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:audio/wav;base64,${window.btoa(binary)}`;
}
