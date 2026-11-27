import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

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

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Analitis Mendalam & Rekonsiliasi Data Taktis AEGIS-BRIEF yang bekerja dengan ketajaman penalaran **Executive Staff Analytical Reasoning**.

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
3. Problem / Root Cause / Constraints: Bottlenecks, gaps, or risks explicitly identified (leave blank if none raised).
4. Smart Synthesis & Implications: Sharp, logical connections between points made across the session—highlighting tensions, trade-offs, or impacts strictly evidenced by the material.
5. Decisions, Action Items & PIC: Binding conclusions, next steps, deadlines, and responsible parties explicitly stated (leave blank if not decided).

IV. PRECISION IN LANGUAGE:
Write in clear, crisp, authoritative Indonesian (unless source material dictates technical terms in English). Keep every sentence dense with verified substance and zero fluff.`;

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

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        error: 'GEMINI_API_KEY belum dikonfigurasi pada Environment Variables Vercel.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' },
      },
    });

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

    const glossaryHint =
      metadata?.customGlossary ||
      'Diskomlekau, Kadiskomlekau, Sesdiskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau';

    const candidateModels = [
      { name: 'gemini-2.5-flash', useLowThinking: false },
      { name: 'gemini-3.1-flash-lite', useLowThinking: false },
      { name: 'gemini-3.8-flash', useLowThinking: false },
      { name: 'gemini-4-hydrogen', useLowThinking: true },
    ];

    const invokeModel = async (contents: any, schema: any) => {
      let lastErr: any;
      for (const candidate of candidateModels) {
        try {
          const genConfig: Record<string, any> = {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: schema,
          };
          if (candidate.useLowThinking) {
            genConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
          }
          return await ai.models.generateContent({
            model: candidate.name,
            contents,
            config: genConfig,
          });
        } catch (err: any) {
          lastErr = err;
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
            msg.includes('no longer available')
          ) {
            continue;
          }
          throw err;
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
      const prompt = `Klasifikasikan otomatis foto ini menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak substansi strategis, spesifikasi teknis, dan isi surat dengan penalaran analitis Perwira Staf TNI AU. Pisahkan setiap poin bernomor di isiKegiatanDraft dengan baris kosong ganda (\\n\\n).${slideContextStr} Glossary: ${glossaryHint}`;
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
      return res.status(200).json(parsed);
    }

    if (mode === 'cross_modal_fusion' && unifiedContext) {
      const fusionPrompt = `Terapkan Penalaran Analitis Perwira Staf TNI AU (TNI AU Staff Officer Analytical Reasoning) dan Fusi Lintas-Modal atas seluruh input sesi aktif berikut:
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Susun isiKegiatan dalam poin-poin bernomor tematis (Poin 1: Konteks & Pokok Bahasan; Poin Tengah: Analisis Teknis, Pembahasan & Temuan beserta dampak operasional; Poin Terakhir: Keputusan, Direktif Pimpinan & Langkah Tindak Lanjut) dengan pemisah baris kosong eksplisit (\\n\\n) di antara setiap poin bernomor. Glossary: ${glossaryHint}`;
      const response = await invokeModel(fusionPrompt, REPORT_RESPONSE_SCHEMA);
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
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
      const prompt = `Terapkan penalaran analitis Perwira Staf TNI AU dan Cross-Modal Fusion untuk menggabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman sesi ini beserta materi slide paparan dan undangan sesi ini menjadi satu Laporan Notulensi utuh dengan pemisah baris kosong ganda (\\n\\n) antar poin bernomor:\n\n${JSON.stringify(previousSummaries)}${ocrContextStr}${slideContextStr}`;
      const response = await invokeModel(prompt, REPORT_RESPONSE_SCHEMA);
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      return res.status(200).json(parsed);
    }

    const baseMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
    const normalizedMimeType =
      baseMime === 'audio/x-m4a' || baseMime === 'audio/m4a'
        ? 'audio/mp4'
        : baseMime === 'audio/x-wav'
        ? 'audio/wav'
        : baseMime === 'audio/mp3'
        ? 'audio/mpeg'
        : baseMime || 'audio/webm';

    const parts: any[] = [
      { inlineData: { mimeType: normalizedMimeType, data: audioBase64 } },
    ];

    if (Array.isArray(screenFrames) && screenFrames.length > 0) {
      screenFrames.slice(0, 3).forEach((frameDataUrl: string) => {
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
        ? `\nIntegrasikan pula poin Materi Paparan sesi ini (Rule A & B): ${paparanKnowledge.join(' | ')}`
        : '';
    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nGunakan rujukan ejaan Undangan (OCR_UNDANGAN): ${ocrKnowledge.join(' | ')}`
        : '';

    parts.push({
      text: `Saring basa-basi lisan dan terapkan Penalaran Analitis Perwira Staf TNI AU (Cross-Modal Fusion) untuk menyusun judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan (poin bernomor tematis dengan baris kosong ganda \\n\\n antar poin), executiveSummary, actionItems, dan cleanTranscript dari suara dan materi rapat sesi ini. Bagian ${chunkIndex + 1}/${totalChunks}. Glossary: ${glossaryHint}${ocrContextStr}${slideContextStr}`,
    });

    const response = await invokeModel({ parts }, REPORT_RESPONSE_SCHEMA);
    const parsed = JSON.parse((response.text ?? '{}').trim());
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('Vercel API Error:', error);
    return res.status(400).json({ error: error?.message || 'Gagal memproses data rapat.' });
  }
}
