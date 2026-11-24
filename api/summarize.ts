import { GoogleGenAI, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
  maxDuration: 60,
};

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY belum dikonfigurasi pada Environment Variables Vercel.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
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
    category: { type: Type.STRING },
    confidenceReason: { type: Type.STRING },
    judulKegiatan: { type: Type.STRING },
    hariTanggal: { type: Type.STRING },
    pukul: { type: Type.STRING },
    tempat: { type: Type.STRING },
    pimpinanRapat: { type: Type.STRING },
    pesertaRapat: { type: Type.STRING },
    extractedKnowledge: { type: Type.STRING },
    isiKegiatanDraft: { type: Type.STRING },
  },
  required: ['category', 'confidenceReason', 'extractedKnowledge', 'isiKegiatanDraft'],
};

const REPORT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judulKegiatan: { type: Type.STRING },
    hariTanggal: { type: Type.STRING },
    pukul: { type: Type.STRING },
    pimpinanRapat: { type: Type.STRING },
    pesertaRapat: { type: Type.STRING },
    tempat: { type: Type.STRING },
    isiKegiatan: { type: Type.STRING },
    executiveSummary: { type: Type.STRING },
    actionItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          task: { type: Type.STRING },
          pic: { type: Type.STRING },
          deadline: { type: Type.STRING },
        },
        required: ['task', 'pic', 'deadline'],
      },
    },
    cleanTranscript: { type: Type.STRING },
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
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return { mimeType, filename: 'audio.m4a' };
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return { mimeType, filename: 'audio.mp3' };
  if (mimeType.includes('wav')) return { mimeType, filename: 'audio.wav' };
  if (mimeType.includes('ogg')) return { mimeType, filename: 'audio.ogg' };
  return { mimeType: 'audio/webm', filename: 'audio.webm' };
}

function parseDataUrlImage(dataUrlOrBase64: string): { mimeType: string; data: string } {
  if (dataUrlOrBase64.includes(',')) {
    const [header, b64] = dataUrlOrBase64.split(',');
    const mimeMatch = header.match(/data:([^;]+);/);
    return { mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg', data: b64 };
  }
  return { mimeType: 'image/jpeg', data: dataUrlOrBase64 };
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
  const msg = `${String(err?.message || '')} ${safeJsonErrorString(err)} ${String(err || '')}`.toLowerCase();
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
    text: `Ekstrak secara presisi seluruh teks, judul, tanggal, waktu, lokasi, nama/jabatan, angka, tabel, poin slide, grafik, atau keterangan visual yang benar-benar terlihat pada gambar ini. Jangan mengarang informasi yang tidak terlihat.\n${contextHint}`,
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
        { role: 'user', content: contentParts },
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
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: form as any,
    });
    if (!transcriptionRes.ok) {
      const errText = await transcriptionRes.text();
      throw new Error(`Groq Whisper Error (HTTP ${transcriptionRes.status}): ${errText}`);
    }
    const transcriptionJson = (await transcriptionRes.json()) as any;
    transcriptText = (transcriptionJson.text || '').trim();
  }

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
      console.warn('Groq Vision warning:', visionErr?.message);
    }
  }

  const schemaPrompt = getSchemaInstructionsForJsonMode(reqBody.mode);
  const glossaryHint = reqBody.metadata?.customGlossary?.trim()
    ? `Glosarium Referensi (gunakan hanya jika relevan): ${reqBody.metadata.customGlossary.trim()}`
    : '';

  let userPrompt = '';
  if (reqBody.mode === 'cross_modal_fusion') {
    userPrompt = `Cross-Modal Fusion Request:\n${JSON.stringify(reqBody.unifiedContext || {}, null, 2)}\n${glossaryHint}`;
  } else if (reqBody.mode === 'synthesize') {
    userPrompt = `Sintesis Gabungan Segmen:\n${JSON.stringify(reqBody.previousSummaries || [], null, 2)}\nMateri Paparan: ${JSON.stringify(reqBody.paparanKnowledge || [])}\nOCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [])}\n${glossaryHint}`;
  } else if (reqBody.mode === 'autonomous_vision') {
    userPrompt = `Autonomous Vision Router Synthesis:\nKategori Wajib: ${reqBody.overrideCategory || 'Deteksi Otomatis'}\nEkstraksi Visual Groq Vision:\n${extractedVisualText}\nSlide Sebelumnya: ${JSON.stringify(reqBody.paparanKnowledge || [])}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}\n${glossaryHint}`;
  } else {
    userPrompt = `Analisis & Transkripsi Segmen Audio (${(reqBody.chunkIndex || 0) + 1}/${reqBody.totalChunks || 1}):\nTranskrip Audio (Whisper):\n${transcriptText}\n\nEkstraksi Visual Kamera/Slide (Groq Vision):\n${extractedVisualText}\n\nOCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [])}\nMateri Slide: ${JSON.stringify(reqBody.paparanKnowledge || [])}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}\n${glossaryHint}`;
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
      if (!parsedObj.cleanTranscript && transcriptText) parsedObj.cleanTranscript = transcriptText;
      if (!Array.isArray(parsedObj.actionItems)) parsedObj.actionItems = [];
    }
    return { text: JSON.stringify(parsedObj), providerUsed: 'groq' };
  } catch {
    return { text: content, providerUsed: 'groq' };
  }
}

async function callOpenAiBackup(
  reqBody: any,
  systemInstruction: string,
  openaiApiKeyInput?: string
): Promise<{ text: string; providerUsed: string }> {
  const openaiApiKey = (openaiApiKeyInput || process.env.OPENAI_API_KEY || '').trim();
  if (!openaiApiKey) throw new Error('OpenAI API Key tidak dikonfigurasi.');

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
      headers: { Authorization: `Bearer ${openaiApiKey}` },
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
      ? `Sintesis Segmen:\n${JSON.stringify(reqBody.previousSummaries || [], null, 2)}`
      : reqBody.mode === 'autonomous_vision'
      ? `Vision Router Request:\nKategori wajib: ${reqBody.overrideCategory || 'Otomatis'}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}`
      : `Transkrip Audio: ${transcriptText}\nOCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [])}\nMateri Slide: ${JSON.stringify(reqBody.paparanKnowledge || [])}\nMetadata: ${JSON.stringify(reqBody.metadata || {})}`;

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
      if (!parsedObj.cleanTranscript && transcriptText) parsedObj.cleanTranscript = transcriptText;
      if (!Array.isArray(parsedObj.actionItems)) parsedObj.actionItems = [];
    }
    return { text: JSON.stringify(parsedObj), providerUsed: 'openai' };
  } catch {
    return { text: content, providerUsed: 'openai' };
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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
      groqApiKey,
      openaiApiKey,
      priorityMode = 'automatic',
      providerStage = 'auto',
    } = req.body || {};

    const resolvedGroqKey = (groqApiKey || process.env.GROQ_API_KEY || '').trim();
    const resolvedOpenAiKey = (openaiApiKey || process.env.OPENAI_API_KEY || '').trim();

    const glossaryHint =
      metadata?.customGlossary ||
      'Gunakan hanya istilah yang relevan atau benar-benar terucap/terlihat di sumber.';

    const invokeModel = async (contents: any, schema: any): Promise<{ text?: string; providerUsed: string }> => {
      if (providerStage === 'groq_failover' || (priorityMode === 'force_groq' && resolvedGroqKey)) {
        return await callGroqBackup(req.body || { mode: 'single' }, SYSTEM_INSTRUCTION, resolvedGroqKey);
      }
      if (providerStage === 'openai_failover' || (priorityMode === 'force_openai' && resolvedOpenAiKey)) {
        return await callOpenAiBackup(req.body || { mode: 'single' }, SYSTEM_INSTRUCTION, resolvedOpenAiKey);
      }

      const ai = getGeminiClient();
      const modelName = 'gemini-2.5-pro';
      const retryDelaysMs = [2000, 4000];
      const maxAttempts = 1 + retryDelaysMs.length;
      let lastErr: any;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: schema,
            },
          });
          return { text: response.text, providerUsed: modelName };
        } catch (err: any) {
          lastErr = err;
          const isTransient = isTransientOverloadError(err);
          if (isTransient && attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt - 1]));
            continue;
          }
          if (!isTransient) {
            throw err;
          }
        }
      }

      if (providerStage === 'gemini_only') {
        throw lastErr;
      }

      if (isTransientOverloadError(lastErr)) {
        if (resolvedGroqKey) {
          try {
            return await callGroqBackup(req.body || { mode: 'single' }, SYSTEM_INSTRUCTION, resolvedGroqKey);
          } catch {}
        }
        if (resolvedOpenAiKey) {
          try {
            return await callOpenAiBackup(req.body || { mode: 'single' }, SYSTEM_INSTRUCTION, resolvedOpenAiKey);
          } catch {}
        }
      }
      throw lastErr;
    };

    if (mode === 'autonomous_vision') {
      const img = parseDataUrlImage(imageDataUrl || '');
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nMateri Slide Sesi Ini Sebelumnya: ${paparanKnowledge.join(' | ')}`
          : '';
      const prompt = `Klasifikasikan otomatis foto ini menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak HANYA informasi yang benar-benar tertulis atau terlihat (kosongkan "" jika tidak terlihat). Pisahkan setiap poin bernomor di isiKegiatanDraft dengan baris kosong ganda (\\n\\n).${slideContextStr} Referensi Istilah: ${glossaryHint}`;
      const response = await invokeModel(
        {
          parts: [{ inlineData: { mimeType: img.mimeType, data: img.data } }, { text: prompt }],
        },
        VISION_ROUTER_SCHEMA
      );
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatanDraft) {
        parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
      }
      if (overrideCategory) parsed.category = overrideCategory;
      parsed.providerUsed = response.providerUsed;
      return res.status(200).json(parsed);
    }

    if (mode === 'cross_modal_fusion' && unifiedContext) {
      const fusionPrompt = `Terapkan Penalaran Analitis Mendalam (Executive Staff Analytical Reasoning) dan Fusi Lintas-Modal atas seluruh input sesi aktif berikut (100% berdasar fakta terverifikasi, kosongkan "" jika tidak ada bukti):
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Susun isiKegiatan dalam poin-poin bernomor tematis dengan pemisah baris kosong eksplisit (\\n\\n) di antara setiap poin bernomor. Referensi Istilah: ${glossaryHint}`;
      const response = await invokeModel(fusionPrompt, REPORT_RESPONSE_SCHEMA);
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.providerUsed = response.providerUsed;
      return res.status(200).json(parsed);
    }

    if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nMateri Slide Paparan Sesi Ini:\n${paparanKnowledge.join('\n')}`
          : '';
      const ocrContextStr =
        Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
          ? `\nData Undangan (OCR_UNDANGAN):\n${ocrKnowledge.join('\n')}`
          : '';
      const prompt = `Terapkan penalaran analitis mendalam dan Cross-Modal Fusion untuk menggabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman sesi ini beserta materi slide paparan dan undangan sesi ini menjadi satu Laporan Notulensi utuh berdasar fakta terverifikasi dengan pemisah baris kosong ganda (\\n\\n) antar poin bernomor:\n\n${JSON.stringify(previousSummaries)}${ocrContextStr}${slideContextStr}`;
      const response = await invokeModel(prompt, REPORT_RESPONSE_SCHEMA);
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.providerUsed = response.providerUsed;
      return res.status(200).json(parsed);
    }

    const normalizedMimeType = normalizeAudioMimeType(mimeType);
    const parts: any[] = [
      { inlineData: { mimeType: normalizedMimeType, data: audioBase64 } },
    ];

    if (Array.isArray(screenFrames) && screenFrames.length > 0) {
      screenFrames.slice(0, 4).forEach((frameDataUrl: string) => {
        if (typeof frameDataUrl === 'string' && frameDataUrl.length > 50) {
          const img = parseDataUrlImage(frameDataUrl);
          parts.push({
            inlineData: { mimeType: img.mimeType, data: img.data },
          });
        }
      });
    }

    const slideContextStr =
      Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
        ? `\nIntegrasikan pula poin Materi Paparan sesi ini: ${paparanKnowledge.join(' | ')}`
        : '';
    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nGunakan rujukan Undangan (OCR_UNDANGAN) bila relevan: ${ocrKnowledge.join(' | ')}`
        : '';

    parts.push({
      text: `Transkripsikan secara kronologis dan akurat, saring basa-basi lisan, dan terapkan Penalaran Analitis Mendalam (Cross-Modal Fusion) untuk menyusun judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan (poin bernomor tematis dengan baris kosong ganda \\n\\n antar poin), executiveSummary, actionItems, dan cleanTranscript dari suara dan materi rapat sesi ini (kosongkan "" bila tidak ada fakta). Bagian ${chunkIndex + 1}/${totalChunks}. Referensi Istilah: ${glossaryHint}${ocrContextStr}${slideContextStr}`,
    });

    const response = await invokeModel({ parts }, REPORT_RESPONSE_SCHEMA);
    const parsed = JSON.parse((response.text ?? '{}').trim());
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    parsed.providerUsed = response.providerUsed;
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('Vercel API Error:', error);
    const isTransient = isTransientOverloadError(error);
    return res.status(isTransient ? 503 : 400).json({
      error: error?.message || 'Gagal memproses data rapat.',
      isTransientOverload: isTransient,
      serverGroqConfigured: Boolean(process.env.GROQ_API_KEY?.trim()),
      serverOpenAiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    });
  }
}
