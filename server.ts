import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi. Silakan periksa panel Settings > Secrets di AI Studio atau Environment Variables di Vercel.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const VISION_ROUTER_SCHEMA = {
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
        'Poin-poin inti materi, judul slide, spesifikasi teknis, angka, tabel, atau isi surat yang berhasil diekstrak langsung dari foto ini (diterjemahkan ke Bahasa Indonesia dinas TNI AU yang formal).',
    },
    isiKegiatanDraft: {
      type: Type.STRING,
      description:
        'Draf isi kegiatan 4 poin bernomor (1. Dasar / Latar Belakang: ..., 2. Jalannya Rapat / Pokok Pembahasan: ..., 3. Hasil Rapat : ..., 4. Kesimpulan: ...) yang HANYA berisi materi dari sesi ini.',
    },
  },
  required: ['category', 'confidenceReason', 'extractedKnowledge', 'isiKegiatanDraft'],
};

const REPORT_RESPONSE_SCHEMA = {
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
        'Isi laporan rapat terpadu (Cross-Modal Fusion antara suara dan slide paparan tanpa memisahkan bagian suara vs foto) dalam Bahasa Indonesia dinas TNI AU yang disusun tepat dalam 4 poin bernomor (1. Dasar / Latar Belakang: ..., 2. Jalannya Rapat / Pokok Pembahasan: ..., 3. Hasil Rapat : ..., 4. Kesimpulan: ...) yang dipisahkan baris kosong.',
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        'Ringkasan eksekutif singkat 3 kalimat padat dan jelas yang merangkum hasil rapat sesi ini.',
    },
    actionItems: {
      type: Type.ARRAY,
      description:
        'Daftar tindak lanjut (Action Items) hasil rekonsiliasi instruksi lisan pimpinan pada audio dengan tabel/target pada slide MATERI_PAPARAN.',
      items: {
        type: Type.OBJECT,
        properties: {
          task: {
            type: Type.STRING,
            description: 'Uraian tugas / tindak lanjut yang harus dikerjakan.',
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
        'Transkrip kronologis yang telah dinormalisasi ejaan istilah militernya (mengacu pada OCR_UNDANGAN & MATERI_PAPARAN) dan diterjemahkan ke bahasa dinas TNI AU.',
    },
  },
  required: [
    'judulKegiatan',
    'pimpinanRapat',
    'pesertaRapat',
    'tempat',
    'isiKegiatan',
    'executiveSummary',
    'actionItems',
    'cleanTranscript',
  ],
};

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Multi-Modal & Rekonsiliasi Data Taktis AEGIS-BRIEF DISKOMLEKAU (Perwira Staf Ahli / Notulis Eksekutif Militer TNI Angkatan Udara).

ATURAN FUSI LINTAS-MODAL & REKONSILIASI ENTITAS (CROSS-MODAL FUSION RULES):

1. RULE A — VISUAL SPELLING ANCHOR (ANTI-HALLUCINATION):
   - Gunakan teks hasil pindaian \`OCR_UNDANGAN\` dan \`MATERI_PAPARAN\` sebagai rujukan ejaan otoritatif (authoritative spelling reference) untuk nama satuan militer (misal: Diskomlekau, Subdisrudal, Satkomlek), kode alutsista/radar/elektronika, singkatan/akronim, nama pejabat, pangkat, serta angka/spesifikasi teknis.
   - Koreksi otomatis kesalahan fonetik speech-to-text pada transkrip suara menggunakan istilah resmi yang tertulis pada foto undangan atau slide paparan.

2. RULE B — NARRATIVE & SLIDE SYNTHESIS (TANPA DUPLIKASI BAGIAN):
   - JANGAN PERNAH memisahkan bagian "Ringkasan Suara" dan "Hasil Scan Foto".
   - Leburkan fakta konkret, angka, spesifikasi teknis, dan poin-poin dari \`MATERI_PAPARAN\` secara menyatu dan kronologis bersama arahan pimpinan rapat, jalannya diskusi, serta keputusan dari rekaman suara ke dalam 4 poin baku \`isiKegiatan\`:

1. Dasar / Latar Belakang: [uraikan dasar surat undangan (\`OCR_UNDANGAN\`), latar belakang, dan tujuan pelaksanaan kegiatan pada sesi ini].

2. Jalannya Rapat / Pokok Pembahasan: [uraikan secara terpadu dan komprehensif arahan pimpinan rapat beserta rincian teknis, data, angka, dan pokok materi dari slide \`MATERI_PAPARAN\` serta jalannya diskusi].

3. Hasil Rapat : [uraikan keputusan, kesepakatan teknis, dan hasil utama yang dicapai dari perpaduan pembahasan suara dan materi paparan].

4. Kesimpulan: [uraikan kesimpulan akhir pelaksanaan kegiatan serta penekanan komando / tindak lanjut utama].

3. RULE C — AUTOMATIC LANGUAGE NORMALIZATION (BAHASA DINAS TNI AU):
   - Apabila pembicara dalam rekaman audio atau teks pada slide presentasi menggunakan istilah teknis/militer berbahasa Inggris atau bahasa percakapan, terjemahkan dan adaptasikan secara otomatis ke dalam Bahasa Indonesia dinas staf TNI AU yang lugas, formal, dan efektif, sambil tetap mempertahankan kode standar alutsista/teknis yang relevan.

4. RULE D — SYNCHRONIZED ACTION ITEMS (\`TINDAK LANJUT\`):
   - Silangkan (cross-check) instruksi lisan dari rekaman suara (seperti "tolong segera ditindaklanjuti...", "batas waktu minggu depan...") dengan tabel proyek, jadwal, atau daftar tugas yang terlihat pada foto \`MATERI_PAPARAN\` dan \`OCR_UNDANGAN\` untuk mengisi baris \`task\` (Tugas), \`pic\` (PIC / Satuan), dan \`deadline\` (Batas Waktu) secara akurat.

5. ISOLASI SESI KETAT:
   - Gunakan HANYA data dari sesi aktif saat ini. Jangan menyertakan salam pembuka ("Selamat pagi/siang/malam", "Yth. Kadiskomlekau...") atau kalimat penutup ("Demikian laporan...") di dalam field \`isiKegiatan\`.`;

function normalizeAudioMimeType(rawMime?: string): string {
  const base = (rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/x-wav') return 'audio/wav';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base || 'audio/webm';
}

function parseDataUrlImage(dataUrlOrBase64: string): { mimeType: string; data: string } {
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

async function callGeminiWithSchemaFallback(
  ai: GoogleGenAI,
  contents: any,
  systemInstruction: string,
  schema: any
) {
  // Prioritize gemini-2.5-flash as requested, with automatic fallback to active flash models if unavailable on the current key tier
  const candidateModels = [
    { name: 'gemini-2.5-flash', useLowThinking: false },
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
    { name: 'gemini-3.8-flash', useLowThinking: false },
    { name: 'gemini-4-hydrogen', useLowThinking: true },
  ];
  let lastError: unknown = null;

  for (const candidate of candidateModels) {
    try {
      const config: Record<string, any> = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: schema,
      };
      if (candidate.useLowThinking) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      }

      const response = await ai.models.generateContent({
        model: candidate.name,
        contents,
        config,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '');
      const status = err?.status || err?.statusCode;
      if (
        status === 404 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        msg.includes('404') ||
        msg.includes('503') ||
        msg.includes('UNAVAILABLE') ||
        msg.includes('high demand') ||
        msg.includes('NOT_FOUND') ||
        msg.includes('not found') ||
        msg.includes('no longer available') ||
        msg.includes('not supported')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

app.post('/api/summarize', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  let heartbeatTimer: NodeJS.Timeout | null = null;
  const startHeartbeat = () => {
    res.status(200);
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(' ');
      }
    }, 5000);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  try {
    const {
      audioBase64,
      mimeType,
      screenFrames = [],
      imageDataUrl,
      overrideCategory,
      paparanKnowledge = [],
      ocrKnowledge = [],
      unifiedContext,
      metadata,
      chunkIndex = 0,
      totalChunks = 1,
      previousSummaries = [],
      mode = 'single',
    } = req.body || {};

    const ai = getGeminiClient();

    const glossaryHint = metadata?.customGlossary?.trim()
      ? metadata.customGlossary.trim()
      : 'Kadiskomlekau, Sesdiskomlekau, Diskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau, TNI AU, Vicon';

    // 1. AUTONOMOUS MULTI-MODAL VISION ROUTER
    if (mode === 'autonomous_vision') {
      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        res.status(400).end(JSON.stringify({ error: 'Data foto tidak ditemukan.' }));
        return;
      }
      startHeartbeat();
      const img = parseDataUrlImage(imageDataUrl);
      const forcedCategoryInstruction = overrideCategory
        ? `klasifikasikan wajib sebagai "${overrideCategory}" sesuai instruksi operator`
        : `klasifikasikan secara OTOMATIS ke dalam salah satu dari 3 kategori berikut:
1. "OCR_UNDANGAN": Jika foto berupa surat undangan rapat, nota dinas, telegram, jadwal kegiatan, atau daftar hadir. Ekstrak otomatis judulKegiatan, hariTanggal, pukul, tempat, pimpinanRapat, dan pesertaRapat via OCR.
2. "MATERI_PAPARAN": Jika foto berupa slide presentasi, layar proyektor, diagram teknis, tabel spesifikasi, atau papan tulis. Ekstrak seluruh judul slide, poin bahasan, spesifikasi teknis, tabel, dan angka ke dalam \`extractedKnowledge\` (adaptasikan istilah Inggris ke Bahasa Indonesia dinas TNI AU) serta susun \`isiKegiatanDraft\`.
3. "DOKUMENTASI_KEGIATAN": Jika foto berupa situasi ruang rapat, personel di lapangan, atau kegiatan fisik.`;

      const slideKnowledgeStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nPengetahuan Slide Paparan Sesi Ini Sebelumnya:\n${paparanKnowledge.join('\n')}`
          : '';

      const visionPrompt = `Analisis foto baru ini menggunakan Autonomous Multi-Modal Vision Router AEGIS-BRIEF DISKOMLEKAU, dan ${forcedCategoryInstruction}.
Ekstrak HANYA informasi yang tertulis atau terlihat pada foto ini.${slideKnowledgeStr}
Glosarium Istilah: ${glossaryHint}`;

      const response = await callGeminiWithSchemaFallback(
        ai,
        {
          parts: [
            { inlineData: { mimeType: img.mimeType, data: img.data } },
            { text: visionPrompt },
          ],
        },
        SYSTEM_INSTRUCTION,
        VISION_ROUTER_SCHEMA
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (overrideCategory) {
        parsed.category = overrideCategory;
      } else if (
        parsed.category !== 'OCR_UNDANGAN' &&
        parsed.category !== 'MATERI_PAPARAN' &&
        parsed.category !== 'DOKUMENTASI_KEGIATAN'
      ) {
        parsed.category = 'DOKUMENTASI_KEGIATAN';
      }
      res.end(JSON.stringify(parsed));
      return;
    }

    // 2. UNIFIED CROSS-MODAL FUSION ENGINE (Audio Transcripts + OCR_UNDANGAN + MATERI_PAPARAN + DOKUMENTASI_KEGIATAN)
    if (mode === 'cross_modal_fusion' && unifiedContext) {
      startHeartbeat();
      const fusionPrompt = `Lakukan SINTESIS LINTAS-MODAL & REKONSILIASI DATA (CROSS-MODAL FUSION) atas seluruh input sesi aktif berikut sesuai RULE A (Visual Spelling Anchor), RULE B (Narrative & Slide Synthesis tanpa duplikasi bagian), RULE C (Automatic Language Normalization ke bahasa dinas TNI AU), dan RULE D (Synchronized Action Items):

=== PAYLOAD KONTEKS MULTI-MODAL SESI AKTIF (\`buildUnifiedSessionContext\`) ===
1. DATA STREAM AUDIO (Transkrip Kronologis & Ringkasan Segmen Suara):
${JSON.stringify(unifiedContext.audioStreamData || [], null, 2)}

2. DATA PINDAIAN UNDANGAN (\`OCR_UNDANGAN\` — Rujukan Otoritatif Judul, Waktu, Tempat, Pimpinan, Peserta & Ejaan):
${JSON.stringify(unifiedContext.ocrUndanganData || [], null, 2)}

3. DATA PINDAIAN SLIDE / MATERI PAPARAN (\`MATERI_PAPARAN\` — Rujukan Otoritatif Spesifikasi Teknis, Angka, Tabel, & Pokok Materi):
${JSON.stringify(unifiedContext.materiPaparanData || [], null, 2)}

4. DATA DOKUMENTASI KEGIATAN LAPANGAN (\`DOKUMENTASI_KEGIATAN\`):
${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {}, null, 2)}

5. METADATA RAPAT SAAT INI:
${JSON.stringify(unifiedContext.currentMetadata || metadata || {}, null, 2)}

Glosarium Resmi TNI AU / DISKOMLEKAU: ${glossaryHint}

Instruksi Wajib:
- Koreksi setiap salah eja fonetik pada transkrip audio dengan mengacu pada ejaan di \`OCR_UNDANGAN\` dan \`MATERI_PAPARAN\`.
- Padukan secara utuh poin-poin teknis \`MATERI_PAPARAN\` dan arahan/diskusi dari \`audioStreamData\` ke dalam 4 poin \`isiKegiatan\` tanpa memisahkan "Ringkasan Suara" dan "Hasil Scan Foto".
- Terjemahkan istilah teknis berbahasa Inggris ke dalam kalimat dinas staf TNI AU yang lugas dan formal.
- Rekonsiliasi instruksi lisan di audio dengan tabel/target di slide paparan untuk menghasilkan \`actionItems\` yang akurat.`;

      const response = await callGeminiWithSchemaFallback(
        ai,
        fusionPrompt,
        SYSTEM_INSTRUCTION,
        REPORT_RESPONSE_SCHEMA
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.end(JSON.stringify(parsed));
      return;
    }

    // 3. SYNTHESIZE MULTIPLE AUDIO CHUNKS + MATERI_PAPARAN + OCR_UNDANGAN CONTEXT
    if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
      startHeartbeat();
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\n\nKONTEKS MATERI PAPARAN / SLIDE PRESENTASI SESI INI (MATERI_PAPARAN):\n${paparanKnowledge.join('\n---\n')}`
          : '';
      const ocrContextStr =
        Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
          ? `\n\nKONTEKS PINDAIAN UNDANGAN SESI INI (OCR_UNDANGAN):\n${ocrKnowledge.join('\n---\n')}`
          : '';
      const unifiedContextStr = unifiedContext
        ? `\n\nUNIFIED MULTI-MODAL SESSION CONTEXT:\n${JSON.stringify(unifiedContext, null, 2)}`
        : '';

      const combinedPrompt = `Lakukan Cross-Modal Fusion untuk menggabungkan hasil ekstraksi dari ${previousSummaries.length} segmen rekaman rapat sesi ini beserta pindaian OCR_UNDANGAN dan MATERI_PAPARAN menjadi SATU laporan notulensi utuh (judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan 4 poin terpadu tanpa duplikasi bagian, executiveSummary, actionItems hasil rekonsiliasi suara+slide, dan cleanTranscript yang telah dikoreksi ejaannya):

${JSON.stringify(previousSummaries, null, 2)}${ocrContextStr}${slideContextStr}${unifiedContextStr}

Istilah Khusus (Glossary): ${glossaryHint}`;

      const response = await callGeminiWithSchemaFallback(
        ai,
        combinedPrompt,
        SYSTEM_INSTRUCTION,
        REPORT_RESPONSE_SCHEMA
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      res.end(JSON.stringify(parsed));
      return;
    }

    // 4. SINGLE AUDIO CHUNK (+ CURRENT SESSION OCR_UNDANGAN, MATERI_PAPARAN & SCREEN FRAMES)
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).end(
        JSON.stringify({
          error:
            'Data audio tidak ditemukan dalam permintaan. Pastikan rekaman atau file audio valid.',
        })
      );
      return;
    }

    startHeartbeat();

    const normalizedMimeType = normalizeAudioMimeType(mimeType);
    const parts: any[] = [
      {
        inlineData: {
          mimeType: normalizedMimeType,
          data: audioBase64,
        },
      },
    ];

    if (Array.isArray(screenFrames) && screenFrames.length > 0) {
      screenFrames.slice(0, 4).forEach((frameDataUrl: string) => {
        if (typeof frameDataUrl === 'string' && frameDataUrl.length > 50) {
          const img = parseDataUrlImage(frameDataUrl);
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data,
            },
          });
        }
      });
    }

    const slideContextStr =
      Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
        ? `\nKonteks Materi Slide Paparan (MATERI_PAPARAN — gunakan sebagai Visual Spelling Anchor & integrasikan langsung ke dalam 4 poin isiKegiatan):\n${paparanKnowledge.join('\n')}`
        : '';

    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nKonteks Pindaian Undangan (OCR_UNDANGAN — gunakan sebagai rujukan ejaan resmi Judul, Waktu, Tempat, Pimpinan & Peserta):\n${ocrKnowledge.join('\n')}`
        : '';

    const currentTitleHint = metadata?.judulKegiatan?.trim()
      ? `\nJudul Kegiatan Sesi Ini (dari Undangan/Input): ${metadata.judulKegiatan.trim()}`
      : '';

    parts.push({
      text: `Transkripsikan, terjemahkan istilah asing ke bahasa dinas TNI AU, dan lakukan Cross-Modal Fusion antara rekaman suara rapat ini dengan data OCR_UNDANGAN serta MATERI_PAPARAN sesi ini.${currentTitleHint}
Bagian Rekaman: ${chunkIndex + 1} dari ${totalChunks}.
Daftar Istilah / Singkatan Resmi (Glossary): ${glossaryHint}.${ocrContextStr}${slideContextStr}
Terapkan Rule A (Visual Spelling Anchor), Rule B (Narrative & Slide Synthesis tanpa memisahkan bagian suara vs foto), Rule C (Normalisasi Bahasa Dinas TNI AU), dan Rule D (Synchronized Action Items). Hasilkan JSON lengkap sesuai skema.`,
    });

    const response = await callGeminiWithSchemaFallback(
      ai,
      { parts },
      SYSTEM_INSTRUCTION,
      REPORT_RESPONSE_SCHEMA
    );

    stopHeartbeat();
    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    res.end(JSON.stringify(parsed));
  } catch (error: any) {
    stopHeartbeat();
    console.error('Gemini API Error:', error);
    const message =
      error?.message ||
      'Terjadi kesalahan saat memproses data rapat dengan Gemini Multimodal API.';
    if (!res.headersSent) {
      res.status(400);
    }
    res.end(
      JSON.stringify({
        error: message,
      })
    );
  }
});

app.all('/api/*', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({
    error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(400).json({
      error:
        err?.type === 'entity.too.large'
          ? 'Ukuran data terlalu besar untuk dikirim sekaligus.'
          : err?.message || 'Permintaan tidak valid.',
    });
    return;
  }
  next();
});

async function startServer() {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/manifest.webmanifest') {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (req.path === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AEGIS-BRIEF DISKOMLEKAU Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
