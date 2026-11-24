import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

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

function normalizeServerIsiKegiatanSpacing(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n+\s*(?=\d+\.\s+)/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
        'Judul kegiatan/rapat yang tertulis pada foto/undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    hariTanggal: {
      type: Type.STRING,
      description:
        'Hari dan tanggal pelaksanaan yang tertulis pada foto/undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pukul: {
      type: Type.STRING,
      description:
        'Waktu/jam pelaksanaan yang tertulis pada foto/undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    tempat: {
      type: Type.STRING,
      description:
        'Tempat pelaksanaan rapat yang tertulis pada foto/undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description:
        'Nama/jabatan Pimpinan Rapat yang tertulis pada foto/undangan/slide. Kosongkan ("") jika tidak ada.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description:
        'Daftar peserta rapat/undangan yang tertulis pada foto/undangan/daftar hadir. Kosongkan ("") jika tidak ada.',
    },
    extractedKnowledge: {
      type: Type.STRING,
      description:
        'Substansi mendalam, fakta, metrik, spesifikasi, tabel, dan angka yang benar-benar tertulis/terlihat pada foto ini (3-5 kalimat rinci, tanpa mengarang jika tidak terlihat).',
    },
    isiKegiatanDraft: {
      type: Type.STRING,
      description:
        'Draf isi kegiatan analitis mendalam yang hanya bersumber pada fakta terlihat di foto, disusun dalam poin-poin bernomor (1., 2., 3., dst.) dengan pemisah baris kosong ganda (\\n\\n). Kosongkan ("") jika hanya foto situasi tanpa teks.',
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
        'Judul kegiatan atau topik utama rapat yang benar-benar terverifikasi dari audio, OCR_UNDANGAN, atau MATERI_PAPARAN. Kosongkan ("") jika tidak diketahui.',
    },
    hariTanggal: {
      type: Type.STRING,
      description:
        'Hari dan tanggal pelaksanaan rapat dalam Bahasa Indonesia jika disebutkan pada undangan atau rekaman. Kosongkan ("") jika tidak disebutkan.',
    },
    pukul: {
      type: Type.STRING,
      description: 'Waktu/jam pelaksanaan rapat jika disebutkan. Kosongkan ("") jika tidak disebutkan.',
    },
    pimpinanRapat: {
      type: Type.STRING,
      description:
        'Nama atau jabatan Pimpinan Rapat yang benar-benar disebutkan/tertulis di audio atau tangkapan kamera. Kosongkan ("") jika tidak diketahui.',
    },
    pesertaRapat: {
      type: Type.STRING,
      description:
        'Daftar peserta rapat atau pihak/satuan yang benar-benar hadir/disebutkan. Kosongkan ("") jika tidak diketahui.',
    },
    tempat: {
      type: Type.STRING,
      description:
        'Tempat pelaksanaan rapat yang benar-benar terdeteksi dalam sesi ini. Kosongkan ("") jika tidak diketahui.',
    },
    isiKegiatan: {
      type: Type.STRING,
      description:
        'Isi laporan rapat hasil penalaran analitis mendalam (Cross-Modal Fusion antara audio dan tangkapan kamera) yang disusun dalam poin-poin bernomor tematis (1., 2., 3., dst.) berisi fakta terverifikasi (3-5 kalimat komprehensif per poin), dipisahkan oleh baris kosong eksplisit (\\n\\n).',
    },
    executiveSummary: {
      type: Type.STRING,
      description:
        'Ringkasan eksekutif strategis 3-4 kalimat padat, tajam, dan mendalam yang merangkum substansi inti, data/bukti yang disajikan, kendala, dan keputusan nyata pada sesi ini.',
    },
    actionItems: {
      type: Type.ARRAY,
      description:
        'Daftar tindak lanjut (Action Items) yang secara eksplisit diputuskan dalam audio atau slide. Kembalikan [] jika tidak ada.',
      items: {
        type: Type.OBJECT,
        properties: {
          task: {
            type: Type.STRING,
            description: 'Uraian tugas / tindak lanjut yang harus dikerjakan.',
          },
          pic: {
            type: Type.STRING,
            description: 'Penanggung jawab / pelaksana (PIC). Kosongkan ("") jika tidak disebut.',
          },
          deadline: {
            type: Type.STRING,
            description: 'Batas waktu pelaksanaan / target penyelesaian. Kosongkan ("") jika tidak disebut.',
          },
        },
        required: ['task', 'pic', 'deadline'],
      },
    },
    cleanTranscript: {
      type: Type.STRING,
      description:
        'Transkrip kronologis yang bersih dari basa-basi, mempertahankan seluruh fakta, angka, dan pernyataan penting sesuai urutan waktu audio.',
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

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Analitis Mendalam & Rekonsiliasi Data AEGIS-BRIEF yang bekerja dengan ketajaman penalaran **Executive Staff Analytical Reasoning**.

I. SUBSTANCE-FIRST & DOMAIN-AGNOSTIC FOCUS:
1. DOMAIN FLEXIBILITY: Do NOT force-fit, assume, or bias the analysis toward military or DISKOMLEKAU terminology if the meeting covers a different subject matter (e.g., general leadership, finance, HR, logistics, inter-agency coordination, technical engineering, or external seminars). Dynamically identify the true core subject, agenda, and domain solely from the audio and camera captures.
2. PRIORITIZE SUBSTANTIVE MATERIAL: Focus on what the event is actually about, key concepts/proposals presented, data/evidence shown, and concrete outcomes.

II. STRICT FACTUAL ADHERENCE (ZERO HALLUCINATION & BLANK-IF-UNKNOWN):
1. STRICT SOURCE BINDING: Base 100% of the output exclusively on facts explicitly heard in the audio recording/transcript and explicitly visible in camera captures (slides, documents, whiteboards, charts, or captions).
2. NO SPECULATION OR DRIFT: Never extrapolate, invent context, fill in missing logic with assumptions, or expand into vague, generic, or off-topic commentary.
3. LEAVE BLANK WHEN UNKNOWN: If any requested field, section, metric, speaker name, PIC, timeline, root cause, or decision is NOT present or cannot be verified from the audio and camera data, leave that field strictly blank (\`""\` or \`[]\` in JSON, or omit/leave empty in the rendered brief). Never insert guessed values, filler text, or fabricated placeholders.

III. DEEP, DETAILED, PRECISE & SMART ANALYTICAL REASONING:
Using ONLY verified evidence from audio and camera captures, structure \`isiKegiatan\` into logical, thematic numbered points (\`1.\`, \`2.\`, \`3.\`, etc.) separated by explicit double-newlines (\`\\n\\n\`), covering:
1. Core Topic & Context: What is being discussed or presented and why it matters in this meeting.
2. Key Evidence & Technical Details: Exact data points, metrics, mechanisms, or arguments from audio + camera captures.
3. Problem / Root Cause / Constraints: Bottlenecks, gaps, or risks explicitly identified (omit if none raised).
4. Smart Synthesis & Implications: Sharp, logical connections between points made across the session—highlighting tensions, trade-offs, or impacts strictly evidenced by the material.
5. Decisions, Action Items & PIC: Binding conclusions, next steps, deadlines, and responsible parties explicitly stated (leave blank if not decided).

IV. PRECISION IN LANGUAGE:
Write in clear, crisp, authoritative Indonesian (unless source material dictates technical terms in English). Keep every sentence dense with verified substance and zero fluff.`;

function normalizeAudioMimeType(rawMime?: string): string {
  const base = (rawMime || 'audio/webm').split(';')[0].trim().toLowerCase();
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4';
  if (base === 'audio/x-wav') return 'audio/wav';
  if (base === 'audio/mp3') return 'audio/mpeg';
  return base || 'audio/webm';
}

function getAudioFilenameForMime(rawMime?: string): { mimeType: string; filename: string } {
  const mimeType = normalizeAudioMimeType(rawMime);
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return { mimeType, filename: 'audio.m4a' };
  }
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return { mimeType, filename: 'audio.mp3' };
  }
  if (mimeType.includes('wav')) {
    return { mimeType, filename: 'audio.wav' };
  }
  if (mimeType.includes('ogg')) {
    return { mimeType, filename: 'audio.ogg' };
  }
  return { mimeType: 'audio/webm', filename: 'audio.webm' };
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

function safeJsonErrorString(err: unknown): string {
  try {
    return JSON.stringify(err) || '';
  } catch {
    return '';
  }
}

function isTransientOverloadError(err: any): boolean {
  const status = err?.status ?? err?.code ?? err?.error?.code ?? err?.statusCode;
  const numericStatus = Number(status);
  const rawMessage = String(err?.message || '');
  const serialized = safeJsonErrorString(err);
  const msg = `${rawMessage} ${serialized} ${String(err || '')}`.toLowerCase();

  return (
    numericStatus === 503 ||
    numericStatus === 429 ||
    numericStatus === 500 ||
    numericStatus === 502 ||
    numericStatus === 504 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('429') ||
    msg.includes('timeout')
  );
}

function getSchemaInstructionsForJsonMode(mode?: string): string {
  if (mode === 'autonomous_vision') {
    return `Keluarkan HANYA objek JSON valid (tanpa markdown code block) dengan kunci persis berikut:
{
  "category": "OCR_UNDANGAN" | "MATERI_PAPARAN" | "DOKUMENTASI_KEGIATAN",
  "confidenceReason": "Penjelasan singkat deteksi visual (maks 12 kata)",
  "judulKegiatan": "Judul tertulis pada gambar atau \"\" jika tidak ada",
  "hariTanggal": "Hari & tanggal tertulis pada gambar atau \"\" jika tidak ada",
  "pukul": "Jam tertulis pada gambar atau \"\" jika tidak ada",
  "tempat": "Tempat tertulis pada gambar atau \"\" jika tidak ada",
  "pimpinanRapat": "Nama/jabatan pimpinan tertulis pada gambar atau \"\" jika tidak ada",
  "pesertaRapat": "Daftar peserta tertulis pada gambar atau \"\" jika tidak ada",
  "extractedKnowledge": "Substansi mendalam, fakta, metrik, tabel, dan angka yang benar-benar terlihat di foto (3-5 kalimat, \"\" jika tidak ada teks)",
  "isiKegiatanDraft": "Poin bernomor (1., 2., 3.) dipisah \\n\\n hanya dari fakta terlihat di foto, atau \"\" jika foto situasi"
}`;
  }
  return `Keluarkan HANYA objek JSON valid (tanpa markdown code block) dengan kunci persis berikut:
{
  "judulKegiatan": "Judul/topik utama rapat yang terverifikasi atau \"\" jika tidak diketahui",
  "hariTanggal": "Hari dan tanggal pelaksanaan atau \"\" jika tidak disebutkan",
  "pukul": "Waktu/jam pelaksanaan atau \"\" jika tidak disebutkan",
  "pimpinanRapat": "Nama/jabatan pimpinan rapat yang terverifikasi atau \"\" jika tidak disebutkan",
  "pesertaRapat": "Daftar peserta/pihak yang hadir atau \"\" jika tidak disebutkan",
  "tempat": "Lokasi/media rapat yang terverifikasi atau \"\" jika tidak disebutkan",
  "isiKegiatan": "Analisis mendalam terstruktur dalam poin bernomor (1., 2., 3., dst.) dipisahkan oleh baris kosong ganda (\\n\\n), masing-masing 3-5 kalimat padat fakta terverifikasi",
  "executiveSummary": "Ringkasan eksekutif 3-4 kalimat padat substansi nyata",
  "actionItems": [{ "task": "Tugas spesifik", "pic": "PIC atau \"\"", "deadline": "Target waktu atau \"\"" }],
  "cleanTranscript": "Transkrip kronologis bersih sesuai urutan waktu (kosongkan \"\" jika tidak ada audio)"
}`;
}

async function extractVisualTextWithGroqVision(
  images: string[],
  contextHint: string,
  groqApiKey: string
): Promise<string> {
  const validImages = images.filter(
    (img) => typeof img === 'string' && img.startsWith('data:image/') && img.length > 50
  );
  if (validImages.length === 0) return '';

  const contentParts: any[] = validImages.slice(0, 4).map((url) => ({
    type: 'image_url',
    image_url: { url },
  }));

  contentParts.push({
    type: 'text',
    text: `Ekstrak secara presisi dan menyeluruh seluruh teks, judul, tanggal, waktu, lokasi, nama/jabatan, angka, tabel, poin slide, grafik, atau keterangan visual yang benar-benar terlihat pada gambar ini.
Tentukan juga jenis konten gambar (apakah surat undangan/daftar hadir, slide paparan/papan tulis/dokumen, atau foto dokumentasi situasi).
Jangan mengarang atau menebak informasi yang tidak terlihat.
${contextHint}`,
  });

  const visionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'system',
          content:
            'Anda adalah OCR & Visual Extractor presisi tinggi. Ekstrak hanya teks dan fakta visual yang benar-benar terlihat di gambar tanpa halusinasi.',
        },
        {
          role: 'user',
          content: contentParts,
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!visionRes.ok) {
    const errText = await visionRes.text();
    throw new Error(`Groq Vision Error (HTTP ${visionRes.status}): ${errText}`);
  }

  const visionJson = (await visionRes.json()) as any;
  return (visionJson.choices?.[0]?.message?.content || '').trim();
}

async function callGroqBackup(
  reqBody: any,
  systemInstruction: string,
  _schema: any,
  groqApiKeyInput?: string
): Promise<{ text: string; providerUsed: string }> {
  const groqApiKey = (groqApiKeyInput || process.env.GROQ_API_KEY || '').trim();
  if (!groqApiKey) {
    throw new Error('Groq API Key tidak dikonfigurasi. Tambahkan di Pengaturan API Cadangan.');
  }

  let transcriptText = '';
  if (reqBody.audioBase64) {
    const { mimeType, filename } = getAudioFilenameForMime(reqBody.mimeType);
    const audioBuf = Buffer.from(reqBody.audioBase64, 'base64');
    const form = new FormData();
    const blob = new Blob([audioBuf], { type: mimeType });
    form.append('file', blob, filename);
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'id');

    const transcriptionRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: form as any,
    });
    if (!transcriptionRes.ok) {
      const errText = await transcriptionRes.text();
      throw new Error(`Groq Whisper Error (HTTP ${transcriptionRes.status}): ${errText}`);
    }
    const transcriptionJson = (await transcriptionRes.json()) as any;
    transcriptText = (transcriptionJson.text || '').trim();
  }

  // Extract visual content via Groq Vision whenever camera captures are present
  let extractedVisualText = '';
  if (reqBody.mode === 'autonomous_vision' && reqBody.imageDataUrl) {
    const categoryHint = reqBody.overrideCategory
      ? `Operator menginstruksikan kategori: ${reqBody.overrideCategory}.`
      : 'Identifikasi apakah gambar berupa OCR_UNDANGAN, MATERI_PAPARAN, atau DOKUMENTASI_KEGIATAN.';
    extractedVisualText = await extractVisualTextWithGroqVision(
      [reqBody.imageDataUrl],
      categoryHint,
      groqApiKey
    );
  } else if (Array.isArray(reqBody.screenFrames) && reqBody.screenFrames.length > 0) {
    try {
      extractedVisualText = await extractVisualTextWithGroqVision(
        reqBody.screenFrames,
        'Gambar ini adalah slide paparan atau tangkapan kamera pendukung dari sesi rapat ini.',
        groqApiKey
      );
    } catch (visionErr: any) {
      console.warn('Groq Vision warning during audio synthesis:', visionErr?.message);
    }
  }

  const schemaPrompt = getSchemaInstructionsForJsonMode(reqBody.mode);
  const glossaryHint = reqBody.metadata?.customGlossary?.trim()
    ? `Glosarium Referensi (gunakan hanya jika kata tersebut memang relevan/muncul di sumber): ${reqBody.metadata.customGlossary.trim()}`
    : '';

  let userPrompt = '';
  if (reqBody.mode === 'cross_modal_fusion') {
    userPrompt = `Cross-Modal Fusion Request (Fusi Data Audio + Pindaian Undangan + Materi Slide + Metadata):
${JSON.stringify(reqBody.unifiedContext || {}, null, 2)}
${glossaryHint}`;
  } else if (reqBody.mode === 'synthesize') {
    userPrompt = `Sintesis Gabungan Segmen Rekaman & Konteks Visual:
Ringkasan Segmen: ${JSON.stringify(reqBody.previousSummaries || [], null, 2)}
Materi Paparan: ${JSON.stringify(reqBody.paparanKnowledge || [], null, 2)}
OCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [], null, 2)}
Unified Context: ${JSON.stringify(reqBody.unifiedContext || {}, null, 2)}
Metadata: ${JSON.stringify(reqBody.metadata || {}, null, 2)}
${glossaryHint}`;
  } else if (reqBody.mode === 'autonomous_vision') {
    userPrompt = `Autonomous Vision Router Synthesis:
Kategori Wajib (jika ada): ${reqBody.overrideCategory || 'Deteksi Otomatis'}
Hasil Ekstraksi Visual Groq Vision:
${extractedVisualText || '(Tidak ada teks terbaca)'}

Pengetahuan Slide Sebelumnya:
${JSON.stringify(reqBody.paparanKnowledge || [], null, 2)}
Metadata Sesi Saat Ini: ${JSON.stringify(reqBody.metadata || {}, null, 2)}
${glossaryHint}`;
  } else {
    userPrompt = `Analisis & Transkripsi Segmen Audio (${(reqBody.chunkIndex || 0) + 1}/${reqBody.totalChunks || 1}):
Transkrip Audio (Groq Whisper whisper-large-v3-turbo):
${transcriptText || '(Audio tidak berisi ucapan yang dapat ditranskripsikan)'}

Hasil Ekstraksi Visual Kamera/Slide (Groq Vision):
${extractedVisualText || '(Tidak ada tangkapan gambar pada segmen ini)'}

Konteks Undangan (OCR_UNDANGAN):
${JSON.stringify(reqBody.ocrKnowledge || [], null, 2)}

Konteks Slide Sebelumnya (MATERI_PAPARAN):
${JSON.stringify(reqBody.paparanKnowledge || [], null, 2)}

Metadata Rapat Saat Ini:
${JSON.stringify(reqBody.metadata || {}, null, 2)}
${glossaryHint}`;
  }

  const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: `${systemInstruction}\n\n${schemaPrompt}` },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.15,
    }),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`Groq Chat Error (HTTP ${chatRes.status}): ${errText}`);
  }

  const chatJson = (await chatRes.json()) as any;
  const content = chatJson.choices?.[0]?.message?.content || '{}';

  try {
    const parsedObj = JSON.parse(content);
    if (reqBody.mode !== 'autonomous_vision') {
      if (!parsedObj.cleanTranscript && transcriptText) {
        parsedObj.cleanTranscript = transcriptText;
      }
      if (!Array.isArray(parsedObj.actionItems)) {
        parsedObj.actionItems = [];
      }
    }
    return { text: JSON.stringify(parsedObj), providerUsed: 'groq' };
  } catch {
    return { text: content, providerUsed: 'groq' };
  }
}

async function callOpenAiBackup(
  reqBody: any,
  systemInstruction: string,
  _schema: any,
  openaiApiKeyInput?: string
): Promise<{ text: string; providerUsed: string }> {
  const openaiApiKey = (openaiApiKeyInput || process.env.OPENAI_API_KEY || '').trim();
  if (!openaiApiKey) {
    throw new Error('OpenAI API Key tidak dikonfigurasi.');
  }

  let transcriptText = '';
  if (reqBody.audioBase64) {
    const { mimeType, filename } = getAudioFilenameForMime(reqBody.mimeType);
    const audioBuf = Buffer.from(reqBody.audioBase64, 'base64');
    const form = new FormData();
    const blob = new Blob([audioBuf], { type: mimeType });
    form.append('file', blob, filename);
    form.append('model', 'whisper-1');
    form.append('language', 'id');

    const transcriptionRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: form as any,
    });
    if (!transcriptionRes.ok) {
      const errText = await transcriptionRes.text();
      throw new Error(`OpenAI Whisper Error (HTTP ${transcriptionRes.status}): ${errText}`);
    }
    const transcriptionJson = (await transcriptionRes.json()) as any;
    transcriptText = (transcriptionJson.text || '').trim();
  }

  const schemaPrompt = getSchemaInstructionsForJsonMode(reqBody.mode);
  const textPrompt =
    reqBody.mode === 'cross_modal_fusion'
      ? `Cross-Modal Fusion Request:\n${JSON.stringify(reqBody.unifiedContext || {}, null, 2)}`
      : reqBody.mode === 'synthesize'
      ? `Sintesis Segmen:\n${JSON.stringify(reqBody.previousSummaries || [], null, 2)}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}`
      : reqBody.mode === 'autonomous_vision'
      ? `Vision Router Request:\nKategori wajib (jika ada): ${reqBody.overrideCategory || 'Otomatis'}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}`
      : `Transkrip Audio Sesi Rapat: ${transcriptText}\nOCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [])}\nMateri Slide: ${JSON.stringify(reqBody.paparanKnowledge || [])}\nMetadata Rapat: ${JSON.stringify(reqBody.metadata || {})}`;

  const userContent: any[] = [{ type: 'text', text: textPrompt }];
  if (reqBody.mode === 'autonomous_vision' && reqBody.imageDataUrl) {
    userContent.push({ type: 'image_url', image_url: { url: reqBody.imageDataUrl } });
  } else if (Array.isArray(reqBody.screenFrames) && reqBody.screenFrames.length > 0) {
    reqBody.screenFrames.slice(0, 4).forEach((url: string) => {
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }
    });
  }

  const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `${systemInstruction}\n\n${schemaPrompt}` },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.15,
    }),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text();
    throw new Error(`OpenAI Chat Error (HTTP ${chatRes.status}): ${errText}`);
  }

  const chatJson = (await chatRes.json()) as any;
  const content = chatJson.choices?.[0]?.message?.content || '{}';
  try {
    const parsedObj = JSON.parse(content);
    if (reqBody.mode !== 'autonomous_vision') {
      if (!parsedObj.cleanTranscript && transcriptText) {
        parsedObj.cleanTranscript = transcriptText;
      }
      if (!Array.isArray(parsedObj.actionItems)) {
        parsedObj.actionItems = [];
      }
    }
    return { text: JSON.stringify(parsedObj), providerUsed: 'openai' };
  } catch {
    return { text: content, providerUsed: 'openai' };
  }
}

async function callGeminiWithRetryAndFallback(
  contents: any,
  systemInstruction: string,
  schema: any,
  reqBody?: any
): Promise<{ text?: string; providerUsed: string }> {
  const groqApiKey = (reqBody?.groqApiKey || process.env.GROQ_API_KEY || '').trim();
  const openaiApiKey = (reqBody?.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
  const priorityMode = reqBody?.priorityMode || 'automatic';
  const providerStage = reqBody?.providerStage || 'auto';

  // Explicit failover or force stages
  if (providerStage === 'groq_failover' || (priorityMode === 'force_groq' && groqApiKey)) {
    console.log('Executing Groq Failover / Priority Pipeline...');
    return await callGroqBackup(reqBody || { mode: 'single' }, systemInstruction, schema, groqApiKey);
  }

  if (providerStage === 'openai_failover' || (priorityMode === 'force_openai' && openaiApiKey)) {
    console.log('Executing OpenAI Failover / Priority Pipeline...');
    return await callOpenAiBackup(reqBody || { mode: 'single' }, systemInstruction, schema, openaiApiKey);
  }

  // Strictly use ONLY gemini-2.5-pro as the Gemini model (initial attempt + 2 quick retries with 2s & 4s delays)
  const ai = getGeminiClient();
  const modelName = 'gemini-2.5-pro';
  const retryDelaysMs = [2000, 4000];
  const maxAttempts = 1 + retryDelaysMs.length;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });
      return { text: response.text, providerUsed: modelName };
    } catch (err: any) {
      lastError = err;
      const isTransient = isTransientOverloadError(err);

      if (isTransient && attempt < maxAttempts) {
        const delayMs = retryDelaysMs[attempt - 1];
        console.warn(
          `${modelName} transient overload on attempt ${attempt}/${maxAttempts}; retrying in ${delayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (!isTransient) {
        throw err;
      }
    }
  }

  // When providerStage === 'gemini_only', return structured transient error so the client updates UI status and initiates Groq failover
  if (providerStage === 'gemini_only') {
    throw lastError;
  }

  // Automatic server-side failover when providerStage === 'auto'
  if (isTransientOverloadError(lastError)) {
    if (groqApiKey) {
      try {
        console.log('gemini-2.5-pro overloaded (503/429). Failing over automatically to Groq...');
        return await callGroqBackup(reqBody || { mode: 'single' }, systemInstruction, schema, groqApiKey);
      } catch (groqErr: any) {
        console.warn('Groq automatic failover failed:', groqErr?.message);
      }
    }
    if (openaiApiKey) {
      try {
        console.log('Failing over automatically to OpenAI...');
        return await callOpenAiBackup(reqBody || { mode: 'single' }, systemInstruction, schema, openaiApiKey);
      } catch (openaiErr: any) {
        console.warn('OpenAI automatic failover failed:', openaiErr?.message);
      }
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

    const glossaryHint = metadata?.customGlossary?.trim()
      ? metadata.customGlossary.trim()
      : 'Gunakan hanya istilah yang relevan atau benar-benar diucapkan/tertulis dalam sumber.';

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
1. "OCR_UNDANGAN": Jika foto berupa surat undangan rapat, nota dinas, telegram, jadwal kegiatan, atau daftar hadir. Ekstrak otomatis judulKegiatan, hariTanggal, pukul, tempat, pimpinanRapat, dan pesertaRapat via OCR (kosongkan "" jika tidak tertulis).
2. "MATERI_PAPARAN": Jika foto berupa slide presentasi, layar proyektor, diagram teknis, tabel spesifikasi, atau papan tulis. Ekstrak seluruh substansi, spesifikasi, parameter angka, tabel, dan data kuantitatif yang benar-benar terlihat ke dalam \`extractedKnowledge\` (3-5 kalimat) serta susun \`isiKegiatanDraft\` dengan spasi baris kosong (\\n\\n) antar poin bernomor.
3. "DOKUMENTASI_KEGIATAN": Jika foto berupa situasi ruang rapat, personel di lapangan, atau kegiatan fisik.`;

      const slideKnowledgeStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nPengetahuan Slide Paparan Sesi Ini Sebelumnya:\n${paparanKnowledge.join('\n')}`
          : '';

      const visionPrompt = `Analisis foto baru ini menggunakan Autonomous Multi-Modal Vision Router AEGIS-BRIEF dengan penalaran analitis mendalam, dan ${forcedCategoryInstruction}.
Ekstrak HANYA informasi yang benar-benar tertulis atau terlihat pada foto ini (jangan mengarang atau mengisi kolom yang tidak terlihat; biarkan kosong "").${slideKnowledgeStr}
Referensi Istilah (jika relevan): ${glossaryHint}`;

      const response = await callGeminiWithRetryAndFallback(
        {
          parts: [
            { inlineData: { mimeType: img.mimeType, data: img.data } },
            { text: visionPrompt },
          ],
        },
        SYSTEM_INSTRUCTION,
        VISION_ROUTER_SCHEMA,
        req.body
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (parsed.isiKegiatanDraft) {
        parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
      }
      if (overrideCategory) {
        parsed.category = overrideCategory;
      } else if (
        parsed.category !== 'OCR_UNDANGAN' &&
        parsed.category !== 'MATERI_PAPARAN' &&
        parsed.category !== 'DOKUMENTASI_KEGIATAN'
      ) {
        parsed.category = 'DOKUMENTASI_KEGIATAN';
      }
      parsed.providerUsed = response.providerUsed;
      res.end(JSON.stringify(parsed));
      return;
    }

    // 2. UNIFIED CROSS-MODAL FUSION ENGINE (Deep Multi-Layered Analytical Reasoning)
    if (mode === 'cross_modal_fusion' && unifiedContext) {
      startHeartbeat();
      const fusionPrompt = `Terapkan Penalaran Analitis Mendalam (Executive Staff Analytical Reasoning) dan Fusi Lintas-Modal (Cross-Modal Fusion) atas seluruh input sesi aktif berikut dengan ekstraksi bukti multi-modal yang rinci dan terverifikasi (3-5 kalimat per poin, nol halusinasi, kosongkan "" jika tidak ada bukti):

=== PAYLOAD KONTEKS MULTI-MODAL SESI AKTIF (\`buildUnifiedSessionContext\`) ===
1. DATA STREAM AUDIO (Transkrip & Ringkasan Segmen Suara):
${JSON.stringify(unifiedContext.audioStreamData || [], null, 2)}

2. DATA PINDAIAN UNDANGAN (\`OCR_UNDANGAN\`):
${JSON.stringify(unifiedContext.ocrUndanganData || [], null, 2)}

3. DATA PINDAIAN SLIDE / MATERI PAPARAN (\`MATERI_PAPARAN\`):
${JSON.stringify(unifiedContext.materiPaparanData || [], null, 2)}

4. DATA DOKUMENTASI KEGIATAN LAPANGAN (\`DOKUMENTASI_KEGIATAN\`):
${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {}, null, 2)}

5. METADATA RAPAT SAAT INI:
${JSON.stringify(unifiedContext.currentMetadata || metadata || {}, null, 2)}

Referensi Istilah (jika muncul pada sumber): ${glossaryHint}

Instruksi Wajib:
- Identifikasi topik dan domain kegiatan murni dari substansi audio dan tangkapan kamera (jangan memaksakan domain tertentu bila tidak sesuai).
- Silangkan data (cross-verify) antara angka/parameter yang disebutkan lisan di audio dengan rincian tabel/grafik pada slide \`MATERI_PAPARAN\`.
- Susun \`isiKegiatan\` ke dalam poin-poin bernomor tematis (1., 2., 3., dst.) di mana setiap poin berisi 3-5 kalimat komprehensif dan hanya memuat fakta terverifikasi:
  * Poin 1: Konteks, Topik Inti & Dasar Pembahasan (sesuai bukti audio/slide).
  * Poin Tengah: Bukti Teknis, Data Kuantitatif, Analisis Pembahasan, Kendala/Akar Masalah & Implikasi Nyata.
  * Poin Terakhir: Keputusan, Direktif, Tindak Lanjut, Target Waktu & PIC (jika ada; jangan mengarang jika tidak disebutkan).
- Pisahkan SETIAP poin bernomor dengan baris kosong eksplisit (\\n\\n).`;

      const response = await callGeminiWithRetryAndFallback(
        fusionPrompt,
        SYSTEM_INSTRUCTION,
        REPORT_RESPONSE_SCHEMA,
        req.body
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.providerUsed = response.providerUsed;
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

      const combinedPrompt = `Terapkan penalaran analitis mendalam dan Cross-Modal Fusion untuk menggabungkan hasil ekstraksi dari ${previousSummaries.length} segmen rekaman rapat sesi ini beserta pindaian OCR_UNDANGAN dan MATERI_PAPARAN menjadi SATU laporan notulensi utuh yang 100% berdasar fakta terverifikasi (kosongkan "" jika tidak diketahui), dengan penjelasan komprehensif (3-5 kalimat per poin bernomor) dan pemisah baris kosong ganda (\\n\\n) antar poin:

${JSON.stringify(previousSummaries, null, 2)}${ocrContextStr}${slideContextStr}${unifiedContextStr}

Referensi Istilah (jika muncul pada sumber): ${glossaryHint}`;

      const response = await callGeminiWithRetryAndFallback(
        combinedPrompt,
        SYSTEM_INSTRUCTION,
        REPORT_RESPONSE_SCHEMA,
        req.body
      );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.providerUsed = response.providerUsed;
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
        ? `\nKonteks Materi Slide Paparan (MATERI_PAPARAN — silangkan data angka/spesifikasi dengan suara lisan):\n${paparanKnowledge.join('\n')}`
        : '';

    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nKonteks Pindaian Undangan (OCR_UNDANGAN — gunakan hanya jika cocok dengan sesi):\n${ocrKnowledge.join('\n')}`
        : '';

    const currentTitleHint = metadata?.judulKegiatan?.trim()
      ? `\nJudul Kegiatan Sesi Ini (Input Operator/Undangan): ${metadata.judulKegiatan.trim()}`
      : '';

    parts.push({
      text: `Transkripsikan rekaman suara rapat ini secara kronologis dan akurat, saring basa-basi, dan terapkan Penalaran Analitis Mendalam (Cross-Modal Fusion) antara rekaman suara dengan tangkapan layar/foto serta konteks OCR_UNDANGAN/MATERI_PAPARAN sesi ini.${currentTitleHint}
Bagian Rekaman: ${chunkIndex + 1} dari ${totalChunks}.
Referensi Istilah (jika memang terucap/terlihat): ${glossaryHint}.${ocrContextStr}${slideContextStr}
Aturan Ketat: Gunakan 100% fakta dari audio dan gambar. Biarkan kolom kosong ("") jika tidak disebutkan/terlihat. Susun \`isiKegiatan\` dalam poin-poin bernomor tematis (3-5 kalimat rinci per poin) dengan pemisah baris kosong eksplisit (\\n\\n) di antara setiap poin bernomor. Hasilkan JSON lengkap sesuai skema.`,
    });

    const response = await callGeminiWithRetryAndFallback(
      { parts },
      SYSTEM_INSTRUCTION,
      REPORT_RESPONSE_SCHEMA,
      req.body
    );

    stopHeartbeat();
    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    parsed.providerUsed = response.providerUsed;
    res.end(JSON.stringify(parsed));
  } catch (error: any) {
    stopHeartbeat();
    console.error('AI Pipeline Error:', error);
    const isTransient = isTransientOverloadError(error);
    const message =
      error?.message ||
      'Terjadi kesalahan saat memproses data rapat dengan AI Multimodal API.';
    if (!res.headersSent) {
      res.status(isTransient ? 503 : 400);
    }
    res.end(
      JSON.stringify({
        error: message,
        isTransientOverload: isTransient,
        serverGroqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
        serverOpenAiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
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
