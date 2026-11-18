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
      description: 'Judul kegiatan/rapat yang tertulis pada surat undangan atau slide. Kosongkan ("") jika tidak ada.',
    },
    hariTanggal: {
      type: Type.STRING,
      description: 'Hari dan tanggal pelaksanaan yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pukul: {
      type: Type.STRING,
      description: 'Waktu/jam pelaksanaan yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    tempat: {
      type: Type.STRING,
      description: 'Tempat pelaksanaan rapat yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description: 'Nama/jabatan Pimpinan Rapat yang tertulis pada surat undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description: 'Daftar peserta rapat/undangan yang tertulis pada surat undangan/daftar hadir. Kosongkan ("") jika tidak ada.',
    },
    extractedKnowledge: {
      type: Type.STRING,
      description:
        'Poin-poin inti materi, spesifikasi teknis, angka, atau isi surat yang berhasil diekstrak langsung dari foto ini.',
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
        'Judul kegiatan atau topik utama rapat yang terdeteksi langsung dari rekaman suara atau foto sesi ini.',
    },
    hariTanggal: {
      type: Type.STRING,
      description:
        'Hari dan tanggal pelaksanaan rapat dalam Bahasa Indonesia jika disebutkan.',
    },
    pukul: {
      type: Type.STRING,
      description:
        'Waktu/jam pelaksanaan rapat jika disebutkan.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description:
        'Nama atau jabatan Pimpinan Rapat yang terdeteksi dari rekaman suara atau layar sesi ini.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description:
        'Daftar peserta rapat atau satuan yang hadir dalam sesi ini.',
    },
    tempat: {
      type: Type.STRING,
      description:
        'Tempat pelaksanaan rapat yang terdeteksi dalam sesi ini.',
    },
    isiKegiatan: {
      type: Type.STRING,
      description:
        'Isi laporan rapat dalam Bahasa Indonesia formal staf Diskomlekau yang disusun tepat dalam 4 poin bernomor (1. Dasar / Latar Belakang: ..., 2. Jalannya Rapat / Pokok Pembahasan: ..., 3. Hasil Rapat : ..., 4. Kesimpulan: ...) yang dipisahkan baris kosong.',
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        'Ringkasan eksekutif singkat 3 kalimat padat dan jelas yang merangkum hasil rapat sesi ini.',
    },
    actionItems: {
      type: Type.ARRAY,
      description: 'Daftar tindak lanjut (Action Items) yang disepakati dalam rapat sesi ini.',
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
        'Transkrip percakapan kronologis atau teks hasil pembacaan OCR/Paparan dari sesi ini.',
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

const SYSTEM_INSTRUCTION = `Anda adalah Sistem AI Taktis AEGIS-BRIEF DISKOMLEKAU (Perwira Staf Ahli / Notulis Eksekutif Militer TNI Angkatan Udara) yang menyusun Laporan Pelaksanaan Kegiatan / Notulensi Rapat secara OTOMATIS.

ATURAN SINKRONISASI KETAT (ANTI-DATA LAMA):
- Gunakan HANYA informasi aktual yang berasal dari rekaman audio dan foto (OCR Undangan / Materi Paparan) pada permintaan sesi saat ini.
- JANGAN PERNAH mengarang judul kegiatan atau nama pejabat fiktif di luar data input yang diberikan.
- Susun \`isiKegiatan\` / \`isiKegiatanDraft\` dalam 4 poin bernomor dengan format paragraf langsung setelah titik dua (pisahkan antar poin dengan 1 baris kosong):

1. Dasar / Latar Belakang: [uraikan latar belakang/dasar surat undangan/tujuan pelaksanaan kegiatan dari data sesi ini].

2. Jalannya Rapat / Pokok Pembahasan: [uraikan secara komprehensif arahan pimpinan rapat serta pokok-pokok materi dari slide paparan dan diskusi sesi ini].

3. Hasil Rapat : [uraikan komitmen, kesepakatan teknis, atau hasil utama yang dicapai pada sesi ini].

4. Kesimpulan: [uraikan kesimpulan akhir pelaksanaan kegiatan serta penekanan/tindak lanjut yang wajib didokumentasikan].

Jangan menyertakan salam pembuka ("Selamat pagi/siang/malam", "Yth. Kadiskomlekau...") atau kalimat penutup ("Demikian laporan...") di dalam \`isiKegiatan\`.`;

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
  const candidateModels = [
    { name: 'gemini-3.1-flash-lite', useLowThinking: false },
    { name: 'gemini-3.8-flash', useLowThinking: false },
    { name: 'gemini-4-hydrogen', useLowThinking: true },
    { name: 'gemini-2.5-flash', useLowThinking: false },
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

    // AUTONOMOUS MULTI-MODAL VISION ROUTER
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
2. "MATERI_PAPARAN": Jika foto berupa slide presentasi, layar proyektor, diagram teknis, tabel spesifikasi, atau papan tulis. Ekstrak seluruh poin bahasan, spesifikasi teknis, dan angka ke dalam \`extractedKnowledge\` serta susun \`isiKegiatanDraft\`.
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

    // SYNTHESIZE MULTIPLE AUDIO CHUNKS + MATERI_PAPARAN CONTEXT OF CURRENT SESSION
    if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
      startHeartbeat();
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\n\nKONTEKS MATERI PAPARAN / SLIDE PRESENTASI SESI INI:\n${paparanKnowledge.join('\n---\n')}`
          : '';

      const combinedPrompt = `Gabungkan hasil ekstraksi dari ${previousSummaries.length} segmen rekaman rapat sesi ini beserta konteks materi paparan sesi ini menjadi SATU laporan notulensi utuh (judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan 4 poin, executiveSummary, actionItems, dan cleanTranscript):

${JSON.stringify(previousSummaries, null, 2)}${slideContextStr}

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

    // SINGLE AUDIO CHUNK (+ CURRENT SESSION MATERI_PAPARAN KNOWLEDGE & SCREEN FRAMES)
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).end(
        JSON.stringify({
          error: 'Data audio tidak ditemukan dalam permintaan. Pastikan rekaman atau file audio valid.',
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
        ? `\nKonteks Materi Slide Paparan (MATERI_PAPARAN) pada sesi ini yang wajib diintegrasikan ke dalam isiKegiatan:\n${paparanKnowledge.join('\n')}`
        : '';

    const currentTitleHint = metadata?.judulKegiatan?.trim()
      ? `\nJudul Kegiatan Sesi Ini (dari Undangan/Input): ${metadata.judulKegiatan.trim()}`
      : '';

    parts.push({
      text: `Sintesis HANYA rekaman suara rapat sesi ini bersama konteks layar/slide paparan sesi ini untuk menghasilkan Laporan Pelaksanaan Kegiatan resmi Diskomlekau.${currentTitleHint}
Bagian Rekaman: ${chunkIndex + 1} dari ${totalChunks}.
Daftar Istilah / Singkatan Resmi (Glossary): ${glossaryHint}.${slideContextStr}
Hasilkan JSON lengkap sesuai skema.`,
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
