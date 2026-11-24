import { GoogleGenAI, Type } from '@google/genai';

export const GEMINI_MODEL = 'gemini-3.1-pro-preview' as const;

const PLACEHOLDER_KEY_PATTERNS = [
  'MY_GEMINI_API_KEY',
  'YOUR_GEMINI_API_KEY',
  'YOUR_API_KEY',
  'GEMINI_API_KEY',
  'PLACEHOLDER',
  'CHANGE_ME',
];

interface KeyHealthEntry {
  cooldownUntil: number;
  consecutiveFailures: number;
  lastErrorReason?: string;
}

const keyHealthMap = new Map<string, KeyHealthEntry>();
let activePreferredSlot = 0;

function isValidCandidateKey(raw: string | undefined): raw is string {
  if (!raw || typeof raw !== 'string') return false;
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || trimmed.length < 10) return false;
  const upper = trimmed.toUpperCase();
  return !PLACEHOLDER_KEY_PATTERNS.some((pattern) => upper === pattern || upper.includes(pattern));
}

/**
 * Collects Gemini API keys solely from server environment variables (zero hardcoded keys).
 * Supports:
 * - GEMINI_API_KEYS (comma/semicolon/newline/whitespace separated)
 * - GEMINI_API_KEY (single key or comma-separated keys)
 * - GEMINI_API_KEY_PRIMARY, GEMINI_API_KEY_SECONDARY, GEMINI_API_KEY_BACKUP, GEMINI_API_KEY_FALLBACK
 * - GEMINI_API_KEY_1 ... GEMINI_API_KEY_15
 */
export function collectConfiguredGeminiApiKeys(): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();

  const pushKey = (candidate: string | undefined) => {
    if (!isValidCandidateKey(candidate)) return;
    const cleaned = candidate.trim().replace(/^["']|["']$/g, '');
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      collected.push(cleaned);
    }
  };

  const pushMulti = (raw: string | undefined) => {
    if (!raw || typeof raw !== 'string') return;
    raw
      .split(/[,;\n\r\s]+/)
      .map((part) => part.trim())
      .forEach((part) => pushKey(part));
  };

  pushMulti(process.env.GEMINI_API_KEYS);
  pushMulti(process.env.GEMINI_API_KEY);
  pushKey(process.env.GEMINI_API_KEY_PRIMARY);
  pushKey(process.env.GEMINI_API_KEY_SECONDARY);
  pushKey(process.env.GEMINI_API_KEY_BACKUP);
  pushKey(process.env.GEMINI_API_KEY_FALLBACK);

  for (let i = 1; i <= 15; i++) {
    pushKey(process.env[`GEMINI_API_KEY_${i}`]);
  }

  return collected;
}

function classifyGeminiError(err: any): {
  reason: 'RATE_LIMIT' | 'AUTH_INVALID' | 'SERVICE_UNAVAILABLE' | 'BAD_REQUEST' | 'UNKNOWN';
  cooldownMs: number;
  shouldFailover: boolean;
} {
  const status = Number(err?.status || err?.statusCode || 0);
  const msg = String(err?.message || '').toUpperCase();

  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('QUOTA') ||
    msg.includes('RATE LIMIT')
  ) {
    return { reason: 'RATE_LIMIT', cooldownMs: 60_000, shouldFailover: true };
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('API KEY NOT VALID') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('PERMISSION DENIED') ||
    msg.includes('INVALID_ARGUMENT') && msg.includes('API KEY')
  ) {
    return { reason: 'AUTH_INVALID', cooldownMs: 5 * 60_000, shouldFailover: true };
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('TIMEOUT') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('FETCH FAILED')
  ) {
    return { reason: 'SERVICE_UNAVAILABLE', cooldownMs: 20_000, shouldFailover: true };
  }

  // Even on unexpected 400/other errors, fail over if another key exists in pool
  if (status === 400) {
    return { reason: 'BAD_REQUEST', cooldownMs: 5_000, shouldFailover: false };
  }

  return { reason: 'UNKNOWN', cooldownMs: 15_000, shouldFailover: true };
}

export class GeminiFailoverExhaustedError extends Error {
  public readonly failureReason: string;
  public readonly attemptedKeySlots: number;
  public readonly model = GEMINI_MODEL;

  constructor(message: string, failureReason: string, attemptedKeySlots: number) {
    super(message);
    this.name = 'GeminiFailoverExhaustedError';
    this.failureReason = failureReason;
    this.attemptedKeySlots = attemptedKeySlots;
  }
}

export interface FailoverCallResult {
  response: any;
  modelUsed: typeof GEMINI_MODEL;
  keySlotUsed: number;
  failoverTriggered: boolean;
}

/**
 * Calls ONLY `gemini-3.1-pro-preview` with automatic failover across all configured
 * environment-variable Gemini API keys. Never uses any other model and never hardcodes keys.
 */
export async function callGeminiProWithKeyFailover(
  contents: any,
  systemInstruction: string,
  schema: any
): Promise<FailoverCallResult> {
  const keys = collectConfiguredGeminiApiKeys();

  if (keys.length === 0) {
    throw new GeminiFailoverExhaustedError(
      'Tidak ada GEMINI_API_KEY yang dikonfigurasi pada environment server (Settings > Secrets / Environment Variables).',
      'NO_KEY',
      0
    );
  }

  const now = Date.now();
  const totalKeys = keys.length;
  const startIdx = activePreferredSlot % totalKeys;

  // Build ordered indices: healthy keys starting from activePreferredSlot first, then cooled-down keys as last resort
  const rotatedIndices = Array.from({ length: totalKeys }, (_, offset) => (startIdx + offset) % totalKeys);
  const healthyIndices = rotatedIndices.filter((idx) => {
    const health = keyHealthMap.get(keys[idx]);
    return !health || health.cooldownUntil <= now;
  });
  const cooledIndices = rotatedIndices.filter((idx) => {
    const health = keyHealthMap.get(keys[idx]);
    return Boolean(health && health.cooldownUntil > now);
  });

  const attemptOrder = [...healthyIndices, ...cooledIndices];
  let lastError: any = null;
  let lastReason = 'UNKNOWN';
  let attempted = 0;

  for (let i = 0; i < attemptOrder.length; i++) {
    const slotIdx = attemptOrder[i];
    const apiKey = keys[slotIdx];
    attempted += 1;

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });

      // Mark key healthy and promote as preferred slot for subsequent calls
      keyHealthMap.delete(apiKey);
      activePreferredSlot = slotIdx;

      return {
        response,
        modelUsed: GEMINI_MODEL,
        keySlotUsed: slotIdx + 1,
        failoverTriggered: i > 0,
      };
    } catch (err: any) {
      lastError = err;
      const classification = classifyGeminiError(err);
      lastReason = classification.reason;

      const prev = keyHealthMap.get(apiKey);
      keyHealthMap.set(apiKey, {
        cooldownUntil: Date.now() + classification.cooldownMs,
        consecutiveFailures: (prev?.consecutiveFailures || 0) + 1,
        lastErrorReason: classification.reason,
      });

      console.warn(
        `[AEGIS-FAILOVER] ${GEMINI_MODEL} gagal pada Key Slot #${slotIdx + 1}/${totalKeys} (${classification.reason}).`,
        err?.message || ''
      );

      // If it's a single key and transient service error, do one brief retry before failing
      if (totalKeys === 1 && classification.reason === 'SERVICE_UNAVAILABLE') {
        await new Promise((r) => setTimeout(r, 1200));
        try {
          const retryResponse = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents,
            config: {
              systemInstruction,
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          });
          keyHealthMap.delete(apiKey);
          return {
            response: retryResponse,
            modelUsed: GEMINI_MODEL,
            keySlotUsed: slotIdx + 1,
            failoverTriggered: false,
          };
        } catch (retryErr: any) {
          lastError = retryErr;
          lastReason = classifyGeminiError(retryErr).reason;
        }
      }

      if (!classification.shouldFailover) {
        break;
      }
    }
  }

  const rawErrMsg = String(lastError?.message || 'Gagal menghubungi layanan Gemini.');
  throw new GeminiFailoverExhaustedError(
    `Semua Key Gemini (${attempted} slot) untuk model ${GEMINI_MODEL} gagal merespons [${lastReason}]: ${rawErrMsg}`,
    lastReason,
    attempted
  );
}

export function normalizeServerIsiKegiatanSpacing(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n+\s*(?=\d+\.\s+)/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const VISION_ROUTER_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    category: {
      type: Type.STRING,
      description:
        'Klasifikasi otomatis jenis foto: "OCR_UNDANGAN" (surat undangan/nota dinas/telegram/daftar hadir), "MATERI_PAPARAN" (slide presentasi/layar proyektor/diagram teknis/papan tulis), atau "DOKUMENTASI_KEGIATAN" (foto situasi rapat/personel/kegiatan lapangan).',
    },
    confidenceReason: {
      type: Type.STRING,
      description: 'Penjelasan singkat hasil deteksi visual foto (maksimal 12 kata).',
    },
    judulKegiatan: {
      type: Type.STRING,
      description:
        'Judul kegiatan/rapat yang tertulis pada surat undangan atau slide. Kosongkan ("") jika tidak ada.',
    },
    hariTanggal: {
      type: Type.STRING,
      description:
        'Hari dan tanggal pelaksanaan yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pukul: {
      type: Type.STRING,
      description:
        'Waktu/jam pelaksanaan yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    tempat: {
      type: Type.STRING,
      description:
        'Tempat pelaksanaan rapat yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description:
        'Nama/jabatan Pimpinan Rapat yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description:
        'Daftar peserta rapat/undangan yang tertulis pada surat undangan/daftar hadir. Kosongkan ("") jika tidak ada.',
    },
    extractedKnowledge: {
      type: Type.STRING,
      description:
        'Substansi strategis, judul slide, spesifikasi teknis, kesiapan alutsista, parameter kontrak/pengadaan, angka, tabel, kondisi visual ruangan/personel/perangkat, atau isi surat yang berhasil diekstrak dari foto ini dalam bahasa dinas TNI AU yang lugas dan analitis.',
    },
    visualCorrelationNote: {
      type: Type.STRING,
      description:
        'Catatan observasi visual detail dari foto (objek, layar, teks, personel, perangkat keras, atau situasi lapangan) untuk dikorelasikan dengan transkrip audio rapat.',
    },
    isiKegiatanDraft: {
      type: Type.STRING,
      description:
        'Draf isi kegiatan analitis staf TNI AU yang disusun dalam poin-poin bernomor (1., 2., 3., dst.) yang wajib dipisahkan oleh baris kosong ganda (\\n\\n) antar poin.',
    },
  },
  required: [
    'category',
    'confidenceReason',
    'extractedKnowledge',
    'visualCorrelationNote',
    'isiKegiatanDraft',
  ],
};

export const REPORT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judulKegiatan: {
      type: Type.STRING,
      description:
        'Judul kegiatan atau topik utama rapat yang diselaraskan dari OCR_UNDANGAN, MATERI_PAPARAN, dan rekaman suara sesi ini.',
    },
    hariTanggal: {
      type: Type.STRING,
      description:
        'Hari dan tanggal pelaksanaan rapat dalam Bahasa Indonesia jika disebutkan pada undangan atau rekaman.',
    },
    pukul: {
      type: Type.STRING,
      description: 'Waktu/jam pelaksanaan rapat jika disebutkan.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description:
        'Nama atau jabatan Pimpinan Rapat dengan ejaan resmi yang dikoreksi berdasarkan OCR_UNDANGAN / MATERI_PAPARAN.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description: 'Daftar peserta rapat atau satuan yang hadir dalam sesi ini.',
    },
    tempat: {
      type: Type.STRING,
      description: 'Tempat pelaksanaan rapat yang terdeteksi dalam sesi ini.',
    },
    isiKegiatan: {
      type: Type.STRING,
      description:
        'Isi laporan rapat hasil penalaran analitis Perwira Staf TNI AU (Cross-Modal Fusion antara suara dan gambar kamera/upload) yang disusun dalam poin-poin bernomor tematis (1., 2., 3., dst.) sesuai prioritas strategis, dengan baris kosong eksplisit (\\n\\n) yang memisahkan setiap poin bernomor.',
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        'Ringkasan eksekutif strategis 3-4 kalimat padat dan tajam yang merangkum substansi teknis, kendala operasional, dan keputusan komando pada sesi ini.',
    },
    correlationAnalysis: {
      type: Type.STRING,
      description:
        'Analisis korelasi eksplisit yang menghubungkan temuan dari seluruh chunk rekaman audio (per 5 menit) dengan bukti visual gambar hasil kamera maupun upload manual (OCR Undangan, Slide Materi Paparan, dan Foto Dokumentasi Kegiatan), termasuk kesesuaian atau deviasi antara pembicaraan lisan dan data visual.',
    },
    detailedResume: {
      type: Type.STRING,
      description:
        'Resume rapat yang sangat detil dan terstruktur lengkap mencakup: (1) Gambaran Umum & Konteks Strategis, (2) Rincian Pembahasan Kronologis & Tematis per Segmen, (3) Korelasi Audio-Visual (Data Slide/Undangan/Foto Kamera & Upload vs Pembahasan Lisan), (4) Parameter Teknis, Angka, Kendala & Analisis Dampak, serta (5) Keputusan Komando & Tindak Lanjut.',
    },
    actionItems: {
      type: Type.ARRAY,
      description:
        'Daftar tindak lanjut (Action Items) hasil rekonsiliasi direktif pimpinan pada audio dengan tabel/target pada slide MATERI_PAPARAN.',
      items: {
        type: Type.OBJECT,
        properties: {
          task: {
            type: Type.STRING,
            description: 'Uraian tugas / tindak lanjut teknis yang harus dikerjakan.',
          },
          pic: {
            type: Type.STRING,
            description: 'Penanggung jawab / satuan / personel pelaksana (PIC).',
          },
          deadline: {
            type: Type.STRING,
            description: 'Batas waktu pelaksanaan / target penyelesaian.',
          },
        },
        required: ['task', 'pic', 'deadline'],
      },
    },
    cleanTranscript: {
      type: Type.STRING,
      description:
        'Transkrip kronologis yang telah dibersihkan dari basa-basi, dinormalisasi ejaan istilah militernya (mengacu pada OCR_UNDANGAN & MATERI_PAPARAN), dan diterjemahkan ke bahasa dinas TNI AU.',
    },
  },
  required: [
    'judulKegiatan',
    'pimpinanRapat',
    'pesertaRapat',
    'tempat',
    'isiKegiatan',
    'executiveSummary',
    'correlationAnalysis',
    'detailedResume',
    'actionItems',
    'cleanTranscript',
  ],
};

export const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Analitis & Rekonsiliasi Data Taktis AEGIS-BRIEF DISKOMLEKAU yang bekerja dengan ketajaman penalaran **Perwira Staf Ahli TNI Angkatan Udara (TNI AU Staff Officer Analytical Reasoning)**.

I. PENALARAN ANALITIS STAF MILITER (DEEP MILITARY STAFF ANALYTICAL REASONING):
1. FILTER NOISE, EKSTRAK SUBSTANSI KERAS (HARD SUBSTANCE):
   - Singkirkan sepenuhnya basa-basi, sapaan pembuka/penutup, pengulangan kata lisan, dan kalimat pengisi yang tidak relevan.
   - Fokus secara ketat pada substansi strategis: spesifikasi teknis elektronika/komlek, tingkat kesiapan alutsista/radar/jaringan, parameter kontrak/pengadaan, kendala operasional/pemeliharaan (*operational bottlenecks*), serta keputusan dan direktif komando.

2. ALUR ANALITIS TERSTRUKTUR PER POIN (\`isiKegiatan\`):
   - Susun \`isiKegiatan\` ke dalam poin-poin bernomor tematis yang logis (\`1.\`, \`2.\`, \`3.\`, dst. — dapat berupa 3 hingga 6 poin sesuai kedalaman substansi rapat) yang diurutkan berdasarkan prioritas strategis:
     * **Poin 1 (Konteks & Pokok Bahasan):** Tujuan utama/latar belakang pelaksanaan rapat serta data dasar (*baseline data*) kunci yang diekstrak dari surat undangan (\`OCR_UNDANGAN\`) dan slide pembuka (\`MATERI_PAPARAN\`).
     * **Poin-Poin Tengah (Analisis Teknis, Pembahasan & Temuan):** Sintesis mendalam yang memadukan argumen pembicara dengan angka presisi, parameter teknis, nama satuan, atau komitmen vendor dari slide/gambar kamera maupun upload manual—jelaskan *mengapa* suatu isu krusial serta dampaknya terhadap kesiapan operasional atau pemeliharaan.
     * **Poin Terakhir (Keputusan, Direktif Pimpinan & Langkah Tindak Lanjut):** Direktif tegas yang ditetapkan oleh \`pimpinanRapat\`, tahapan pencapaian (*milestones*) yang disepakati, batas waktu (*deadlines*), dan satuan/pejabat penanggung jawab (*PIC*).

3. KORELASI AUDIO-VISUAL & RESUME DETIL (\`correlationAnalysis\` & \`detailedResume\`):
   - \`correlationAnalysis\`: Jelaskan korelasi konkret antara pembahasan di setiap segmen audio 5-menit dengan bukti gambar hasil kamera maupun upload manual (undangan, slide paparan, diagram teknis, maupun foto dokumentasi kegiatan).
   - \`detailedResume\`: Susun resume menyeluruh yang sangat detil, terstruktur rapi dengan sub-judul, mencakup seluruh fakta kuantitatif, argumen tiap pembicara/satuan, temuan visual kamera/upload, analisis risiko/kendala, serta direktif dan action plan.

4. BAHASA DINAS STAF TNI AU YANG OTORITATIF:
   - Gunakan bahasa dinas staf TNI AU yang lugas, analitis, padat, dan presisi. Hindari kalimat pasif bertele-tele, serta pertahankan akurasi seluruh terminologi teknis elektronika/komunikasi/rudal.

5. SPASI ANTAR-PARAGRAF & ANTAR-POIN WAJIB (\`\\n\\n\`):
   - Setiap poin bernomor di dalam \`isiKegiatan\` WAJIB dipisahkan dengan satu baris kosong eksplisit (\`\\n\\n\`) agar nyaman dibaca pada layar perangkat bergerak (WhatsApp).

II. ATURAN FUSI LINTAS-MODAL & REKONSILIASI ENTITAS (CROSS-MODAL FUSION RULES):
- **RULE A — VISUAL SPELLING ANCHOR (ANTI-HALLUCINATION):** Gunakan teks hasil pindaian \`OCR_UNDANGAN\` dan \`MATERI_PAPARAN\` sebagai rujukan ejaan otoritatif untuk nama satuan militer (Diskomlekau, Subdisrudal, Satkomlek), kode alutsista/radar, akronim, nama pejabat, pangkat, serta angka/spesifikasi. Koreksi otomatis kesalahan fonetik *speech-to-text* pada audio.
- **RULE B — NARRATIVE & SLIDE SYNTHESIS (TANPA DUPLIKASI BAGIAN):** JANGAN PERNAH memisahkan "Ringkasan Suara" dan "Hasil Scan Foto" di dalam \`isiKegiatan\`. Leburkan fakta, angka, dan poin teknis dari gambar kamera maupun upload manual langsung ke dalam alur poin-poin \`isiKegiatan\`.
- **RULE C — AUTOMATIC LANGUAGE NORMALIZATION:** Terjemahkan istilah teknis/militer berbahasa Inggris dari suara maupun slide ke dalam Bahasa Indonesia dinas staf TNI AU yang formal sambil mempertahankan kode standar alutsista/teknis.
- **RULE D — SYNCHRONIZED ACTION ITEMS:** Silangkan instruksi lisan pada audio dengan tabel/jadwal pada slide \`MATERI_PAPARAN\` untuk mengisi \`actionItems\` (\`task\`, \`pic\`, \`deadline\`) secara presisi.
- **ISOLASI SESI:** Gunakan HANYA data dari sesi aktif saat ini. Jangan menyertakan salam pembuka ("Selamat pagi/siang/malam", "Yth. Kadiskomlekau...") atau kalimat penutup ("Demikian laporan...") di dalam field \`isiKegiatan\`.`;

export function normalizeAudioMimeType(rawMime?: string): string {
  const base = (rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/x-wav') return 'audio/wav';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base || 'audio/webm';
}

export function parseDataUrlImage(dataUrlOrBase64: string): { mimeType: string; data: string } {
  if (dataUrlOrBase64.includes(',')) {
    const [header, b64] = dataUrlOrBase64.split(',');
    const mimeMatch = header.match(/data:([^;]+);/);
    return {
      mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
      data: b64,
    };
  }
  return {
    mimeType: 'image/jpeg',
    data: dataUrlOrBase64,
  };
}
