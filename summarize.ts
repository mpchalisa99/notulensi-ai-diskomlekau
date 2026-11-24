import { GoogleGenAI, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
  maxDuration: 60,
};

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

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Analitis Mendalam & Rekonsiliasi Data AEGIS-BRIEF yang bekerja dengan ketajaman penalaran **Executive Analytical Reasoning**.

I. SUBSTANCE-FIRST & DOMAIN-AGNOSTIC FOCUS:
1. DOMAIN FLEXIBILITY: Do NOT force-fit, assume, or bias the analysis toward military or DISKOMLEKAU terminology if the event covers a different subject matter (e.g., general leadership, finance, HR, logistics, inter-agency coordination, technical engineering, or external seminars). Dynamically identify the true core topic, agenda, and domain solely from what is spoken in the audio and shown in the camera captures.
2. PRIORITIZE SUBSTANTIVE MATERIAL: Focus exclusively on what the event is actually about, key concepts/proposals presented, exact data/evidence shown, and concrete outcomes.

II. STRICT FACTUAL ADHERENCE (ZERO HALLUCINATION & BLANK-IF-UNKNOWN):
1. STRICT SOURCE BINDING: Base 100% of the output exclusively on facts explicitly heard in the audio recording/transcript and explicitly visible in camera captures (slides, documents, whiteboards, charts, or captions).
2. NO SPECULATION OR DRIFT: Never extrapolate, invent context, fill in missing logic with assumptions, or expand into vague, generic, or off-topic commentary.
3. LEAVE BLANK WHEN UNKNOWN: If any requested field, section, metric, speaker name, PIC, timeline, root cause, or decision is NOT present or cannot be verified from the audio and camera data, leave that field strictly blank (\`""\` or \`[]\` in JSON). Never insert guessed values, filler text, or fabricated placeholders.

III. DEEP, DETAILED, PRECISE & SMART ANALYTICAL REASONING:
Cross-reference spoken explanations with visual slide/document details. Extract exact technical specs, numbers, dates, root causes/constraints, operational impacts, and binding decisions/PICs. Structure \`isiKegiatan\` into logical, thematic numbered points (\`1.\`, \`2.\`, \`3.\`, etc.) separated by explicit double-newlines (\`\\n\\n\`), covering only verified evidence:
1. Core Topic & Context: What is being discussed or presented and why it matters.
2. Key Evidence & Technical Details: Exact data points, metrics, mechanisms, dates, or arguments from audio + camera captures.
3. Problem / Root Cause / Constraints: Bottlenecks, gaps, or risks explicitly identified (omit if none raised).
4. Smart Synthesis & Operational Impact: Sharp, logical connections and trade-offs strictly evidenced by the material.
5. Decisions, Action Items & PIC: Binding conclusions, next steps, deadlines, and responsible parties explicitly stated (leave \`""\` or \`[]\` if none decided).

IV. PRECISION IN LANGUAGE:
Write in sharp, high-signal, authoritative Indonesian (preserving technical terms in English when appropriate) with zero fluff.`;

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

function sanitizeJsonText(raw: string): string {
  const trimmed = (raw || '{}').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return trimmed;
}

function isModelUnavailableError(err: any): boolean {
  const status = err?.status || err?.code || err?.error?.code || err?.statusCode;
  let serialized = '';
  try {
    serialized = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err || '');
  } catch {
    serialized = String(err || '');
  }
  const msg = `${String(err?.message || '')} ${serialized}`.toLowerCase();
  return (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('no longer available') ||
    msg.includes('not found')
  );
}

function isTransientOverloadError(err: any): boolean {
  const status = err?.status || err?.code || err?.error?.code || err?.statusCode;
  let serialized = '';
  try {
    serialized = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err || '');
  } catch {
    serialized = String(err || '');
  }
  const msg = `${String(err?.message || '')} ${serialized}`.toLowerCase();
  return (
    status === 503 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('429')
  );
}

async function extractVisualTextWithGroqVision(
  imageDataUrls: string[],
  groqApiKey: string,
  instructionPrompt: string,
  expectJson: boolean = false
): Promise<string> {
  const validUrls = imageDataUrls
    .filter((u) => typeof u === 'string' && u.length > 50)
    .slice(0, 4);

  if (validUrls.length === 0) return '';

  const contentParts: any[] = [
    { type: 'text', text: instructionPrompt },
    ...validUrls.map((url) => ({
      type: 'image_url',
      image_url: {
        url: url.startsWith('data:') ? url : `data:image/jpeg;base64,${url}`,
      },
    })),
  ];

  const visionCandidates = [
    'qwen/qwen3.8-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
  ];

  let lastErr = '';
  for (const visionModel of visionCandidates) {
    const visionRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: contentParts },
        ],
        ...(expectJson ? { response_format: { type: 'json_object' } } : {}),
        temperature: 0.1,
      }),
    });

    if (visionRes.ok) {
      const visionJson = (await visionRes.json()) as any;
      return visionJson.choices?.[0]?.message?.content || '';
    }

    lastErr = await visionRes.text();
    if (visionRes.status === 404 || lastErr.includes('model_not_found')) {
      continue;
    }
    throw new Error(`Groq Vision Error (HTTP ${visionRes.status}): ${lastErr}`);
  }

  throw new Error(`Groq Vision Error: Model vision tidak tersedia (${lastErr})`);
}

async function callGroqBackup(
  reqBody: any,
  systemInstruction: string,
  groqApiKey: string
): Promise<{ text: string; providerUsed: string }> {
  if (!groqApiKey) {
    throw new Error('Groq API Key belum diisi pada Pengaturan API Cadangan.');
  }

  if (reqBody.mode === 'autonomous_vision' && reqBody.imageDataUrl) {
    const visionSchemaPrompt = `Analisis gambar ini secara objektif dan domain-agnostik. Klasifikasikan menjadi salah satu: "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN"${reqBody.overrideCategory ? ` (Wajib kategori: "${reqBody.overrideCategory}")` : ''}.
Ekstrak HANYA teks, angka, nama, tanggal, tempat, dan data yang benar-benar terlihat pada gambar (biarkan "" jika tidak terlihat).
Kembalikan STRICT JSON dengan kunci persis berikut:
{
  "category": "OCR_UNDANGAN | MATERI_PAPARAN | DOKUMENTASI_KEGIATAN",
  "confidenceReason": "penjelasan singkat <= 12 kata",
  "judulKegiatan": "",
  "hariTanggal": "",
  "pukul": "",
  "tempat": "",
  "pimpinanRapat": "",
  "pesertaRapat": "",
  "extractedKnowledge": "ekstraksi rinci teks/data visual yang terlihat",
  "isiKegiatanDraft": "poin bernomor (1., 2.) dipisah \\n\\n, atau \\"\\" jika hanya foto dokumentasi"
}`;
    const rawVisionJson = await extractVisualTextWithGroqVision(
      [reqBody.imageDataUrl],
      groqApiKey,
      visionSchemaPrompt,
      true
    );
    return { text: sanitizeJsonText(rawVisionJson), providerUsed: 'groq-vision' };
  }

  let transcriptText = '';
  if (reqBody.audioBase64) {
    const audioBuf = Buffer.from(reqBody.audioBase64, 'base64');
    const normMime = normalizeAudioMimeType(reqBody.mimeType);
    const ext = normMime.includes('mp4')
      ? 'm4a'
      : normMime.includes('mpeg')
      ? 'mp3'
      : normMime.includes('wav')
      ? 'wav'
      : normMime.includes('ogg')
      ? 'ogg'
      : 'webm';
    const form = new FormData();
    const blob = new Blob([audioBuf], { type: normMime });
    form.append('file', blob, `audio.${ext}`);
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
    transcriptText = transcriptionJson.text || '';
  }

  let visualExtractions = '';
  if (Array.isArray(reqBody.screenFrames) && reqBody.screenFrames.length > 0) {
    try {
      visualExtractions = await extractVisualTextWithGroqVision(
        reqBody.screenFrames,
        groqApiKey,
        'Ekstrak seluruh teks, angka, tabel, grafik, judul slide, tanggal, dan detail teknis yang terlihat jelas pada tangkapan gambar berikut secara akurat tanpa mengarang.',
        false
      );
    } catch (visErr: any) {
      console.warn('Groq Vision extraction skipped/warning:', visErr?.message);
    }
  }

  const reportSchemaInstruction = `Kembalikan STRICT JSON valid sesuai struktur persis berikut (biarkan "" atau [] bila data tidak ditemukan pada sumber):
{
  "judulKegiatan": "",
  "hariTanggal": "",
  "pukul": "",
  "pimpinanRapat": "",
  "pesertaRapat": "",
  "tempat": "",
  "isiKegiatan": "poin-poin bernomor (1., 2., 3.) dipisah \\n\\n",
  "executiveSummary": "",
  "actionItems": [{ "task": "", "pic": "", "deadline": "" }],
  "cleanTranscript": ""
}`;

  let userPrompt = '';
  if (reqBody.mode === 'cross_modal_fusion' && reqBody.unifiedContext) {
    userPrompt = `Lakukan Fusi Lintas-Modal dan Sintesis Analitis Mendalam terhadap seluruh data sesi aktif berikut.
DATA SESI AKTIF:
${JSON.stringify(reqBody.unifiedContext, null, 2)}

${reportSchemaInstruction}`;
  } else if (reqBody.mode === 'synthesize' && Array.isArray(reqBody.previousSummaries)) {
    userPrompt = `Gabungkan ringkasan segmen rekaman dan pindaian gambar berikut menjadi satu laporan utuh:
${JSON.stringify(reqBody.previousSummaries, null, 2)}
OCR Undangan: ${JSON.stringify(reqBody.ocrKnowledge || [])}
Materi Paparan: ${JSON.stringify(reqBody.paparanKnowledge || [])}

${reportSchemaInstruction}`;
  } else {
    userPrompt = `Sintesis rekaman suara (Segmen ${(reqBody.chunkIndex ?? 0) + 1}/${reqBody.totalChunks ?? 1}) dan materi visual sesi rapat berikut.
TRANSKRIP AUDIO (Whisper):
${transcriptText || '(Tidak ada ucapan terdeteksi)'}

EKSTRAKSI VISUAL KAMERA/SLIDE SAAT INI:
${visualExtractions || '(Tidak ada)'}

KONTEKS MATERI PAPARAN SESI INI:
${(reqBody.paparanKnowledge || []).join('\n') || '(Tidak ada)'}

KONTEKS OCR UNDANGAN SESI INI:
${(reqBody.ocrKnowledge || []).join('\n') || '(Tidak ada)'}

METADATA SAAT INI:
${JSON.stringify(reqBody.metadata || {})}

${reportSchemaInstruction}`;
  }

  const chatCandidates = [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
    'qwen/qwen3.8-27b',
    'openai/gpt-oss-20b',
  ];

  let lastChatErr = '';
  for (const chatModel of chatCandidates) {
    const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          {
            role: 'system',
            content: `${systemInstruction}\n\nAnda WAJIB menjawab dalam format JSON yang valid tanpa teks pembuka/penutup di luar JSON.`,
          },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.15,
      }),
    });

    if (chatRes.ok) {
      const chatJson = (await chatRes.json()) as any;
      const content = sanitizeJsonText(chatJson.choices?.[0]?.message?.content || '{}');
      return { text: content, providerUsed: `groq-${chatModel}` };
    }

    lastChatErr = await chatRes.text();
    if (chatRes.status === 404 || lastChatErr.includes('model_not_found')) {
      continue;
    }
    throw new Error(`Groq Chat Error (HTTP ${chatRes.status}): ${lastChatErr}`);
  }

  throw new Error(`Groq Chat Error: Model chat tidak tersedia (${lastChatErr})`);
}

async function callGeminiProWithFailover(
  ai: GoogleGenAI | null,
  contents: any,
  schema: any,
  reqBody?: any
): Promise<{ text: string; providerUsed: string; failoverToGroq?: boolean }> {
  const groqApiKey = reqBody?.groqApiKey || process.env.GROQ_API_KEY || '';
  const priorityMode = reqBody?.priorityMode || 'auto';
  const clientManagedFailover = Boolean(reqBody?.clientManagedFailover);

  if (priorityMode === 'groq' || priorityMode === 'force_groq') {
    return await callGroqBackup(reqBody || { mode: 'single' }, SYSTEM_INSTRUCTION, groqApiKey);
  }

  if (!ai) {
    if (clientManagedFailover) {
      return { text: '{}', providerUsed: 'none', failoverToGroq: true };
    }
    return await callGroqBackup(reqBody || { mode: 'single' }, SYSTEM_INSTRUCTION, groqApiKey);
  }

  // Primary: gemini-3.1-pro-preview (active Gemini Pro model), Fallback: gemini-4-hydrogen (active free-tier model)
  const candidateModels = ['gemini-3.1-pro-preview', 'gemini-4-hydrogen'];
  const retryDelays = [2000, 4000];
  let lastError: unknown = null;

  for (const modelName of candidateModels) {
    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
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
        return {
          text: response.text ?? '{}',
          providerUsed: modelName,
        };
      } catch (err: any) {
        lastError = err;
        const isNotFound = isModelUnavailableError(err);
        const isTransient = isTransientOverloadError(err);

        if (isNotFound) {
          break;
        }

        if (isTransient && attempt < retryDelays.length) {
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          continue;
        }

        if (isTransient) {
          break;
        }

        throw err;
      }
    }
  }

  if (isTransientOverloadError(lastError) || isModelUnavailableError(lastError)) {
    if (clientManagedFailover) {
      return { text: '{}', providerUsed: 'none', failoverToGroq: true };
    }
    if (groqApiKey) {
      return await callGroqBackup(reqBody || { mode: 'single' }, SYSTEM_INSTRUCTION, groqApiKey);
    }
  }

  throw lastError;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const ai =
      apiKey && apiKey !== 'MY_GEMINI_API_KEY'
        ? new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: { 'User-Agent': 'aistudio-build' },
            },
          })
        : null;

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

    const glossaryHint = metadata?.customGlossary?.trim() ? metadata.customGlossary.trim() : '';
    const glossaryLine = glossaryHint ? `\nIstilah Khusus: ${glossaryHint}` : '';

    if (mode === 'autonomous_vision') {
      const img = parseDataUrlImage(imageDataUrl || '');
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nMateri Slide Sesi Ini Sebelumnya: ${paparanKnowledge.join(' | ')}`
          : '';
      const prompt = `Analisis gambar ini secara objektif, domain-agnostik, dan bebas halusinasi. Klasifikasikan otomatis menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak HANYA teks, angka, dan substansi yang terlihat jelas pada gambar (kosongkan "" jika tidak terlihat). Pisahkan setiap poin bernomor di isiKegiatanDraft dengan baris kosong ganda (\\n\\n).${slideContextStr}${glossaryLine}`;

      const response = await callGeminiProWithFailover(
        ai,
        {
          parts: [{ inlineData: { mimeType: img.mimeType, data: img.data } }, { text: prompt }],
        },
        VISION_ROUTER_SCHEMA,
        req.body
      );
      if (response.failoverToGroq) {
        return res.status(200).json({
          failoverToGroq: true,
          error: 'Gemini Pro sedang padat (503). Mengalihkan otomatis ke Groq...',
        });
      }
      const parsed = JSON.parse(sanitizeJsonText(response.text));
      if (parsed.isiKegiatanDraft) {
        parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
      }
      if (overrideCategory) parsed.category = overrideCategory;
      parsed._providerUsed = response.providerUsed;
      return res.status(200).json(parsed);
    }

    if (mode === 'cross_modal_fusion' && unifiedContext) {
      const fusionPrompt = `Lakukan Fusi Lintas-Modal (Cross-Modal Fusion) dan Sintesis Analitis Mendalam atas seluruh bukti terverifikasi pada sesi aktif berikut secara domain-agnostik dan bebas halusinasi:
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}${glossaryLine}
Susun isiKegiatan dalam poin-poin bernomor tematis dengan pemisah baris kosong eksplisit (\\n\\n). Biarkan strictly kosong ("" atau []) untuk kolom yang tidak ada pada sumber.`;

      const response = await callGeminiProWithFailover(
        ai,
        fusionPrompt,
        REPORT_RESPONSE_SCHEMA,
        req.body
      );
      if (response.failoverToGroq) {
        return res.status(200).json({
          failoverToGroq: true,
          error: 'Gemini Pro sedang padat (503). Mengalihkan otomatis ke Groq...',
        });
      }
      const parsed = JSON.parse(sanitizeJsonText(response.text));
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed._providerUsed = response.providerUsed;
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
      const prompt = `Gabungkan hasil ekstraksi ${previousSummaries.length} segmen rekaman sesi ini bersama pindaian undangan dan slide paparan menjadi satu laporan sintesis analitis mendalam yang domain-agnostik, bebas halusinasi, dan memisahkan setiap poin bernomor dengan baris kosong ganda (\\n\\n):\n\n${JSON.stringify(previousSummaries)}${ocrContextStr}${slideContextStr}${glossaryLine}`;

      const response = await callGeminiProWithFailover(
        ai,
        prompt,
        REPORT_RESPONSE_SCHEMA,
        req.body
      );
      if (response.failoverToGroq) {
        return res.status(200).json({
          failoverToGroq: true,
          error: 'Gemini Pro sedang padat (503). Mengalihkan otomatis ke Groq...',
        });
      }
      const parsed = JSON.parse(sanitizeJsonText(response.text));
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed._providerUsed = response.providerUsed;
      return res.status(200).json(parsed);
    }

    const normalizedMimeType = normalizeAudioMimeType(mimeType);
    const parts: any[] = [{ inlineData: { mimeType: normalizedMimeType, data: audioBase64 } }];

    if (Array.isArray(screenFrames) && screenFrames.length > 0) {
      screenFrames.slice(0, 4).forEach((frameDataUrl: string) => {
        if (typeof frameDataUrl === 'string' && frameDataUrl.length > 50) {
          const img = parseDataUrlImage(frameDataUrl);
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
        }
      });
    }

    const slideContextStr =
      Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
        ? `\nKonteks Materi Slide Paparan:\n${paparanKnowledge.join(' | ')}`
        : '';
    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nKonteks Pindaian Undangan:\n${ocrKnowledge.join(' | ')}`
        : '';

    parts.push({
      text: `Transkripsikan rekaman suara ini, saring basa-basi, dan lakukan Sintesis Analitis Mendalam (Cross-Modal Fusion) antara audio ini dengan gambar/slide/undangan sesi ini secara domain-agnostik dan 100% berbasis fakta terverifikasi. Bagian ${chunkIndex + 1}/${totalChunks}.${glossaryLine}${ocrContextStr}${slideContextStr}
Susun \`isiKegiatan\` dalam poin-poin bernomor tematis dengan pemisah baris kosong ganda (\\n\\n). Biarkan strictly kosong ("" atau []) untuk kolom yang tidak ada pada sumber audio/visual.`,
    });

    const response = await callGeminiProWithFailover(
      ai,
      { parts },
      REPORT_RESPONSE_SCHEMA,
      req.body
    );
    if (response.failoverToGroq) {
      return res.status(200).json({
        failoverToGroq: true,
        error: 'Gemini Pro sedang padat (503). Mengalihkan otomatis ke Groq...',
      });
    }
    const parsed = JSON.parse(sanitizeJsonText(response.text));
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    parsed._providerUsed = response.providerUsed;
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.warn('Vercel API notice:', error?.message || 'AI error');
    const isOverload = isTransientOverloadError(error) || isModelUnavailableError(error);
    const message = isOverload
      ? 'Server AI mengalami lonjakan trafik sementara (503). Data Anda tersimpan aman secara lokal.'
      : error?.message && !String(error.message).trim().startsWith('{')
      ? error.message
      : 'Terjadi kesalahan saat memproses data rapat.';
    return res.status(isOverload ? 503 : 400).json({
      error: message,
      isTransientOverload: isOverload,
    });
  }
}
