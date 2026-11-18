import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
  maxDuration: 60,
};

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

const SYSTEM_INSTRUCTION = `Anda adalah Sistem AI Taktis AEGIS-BRIEF DISKOMLEKAU (Perwira Staf Ahli / Notulis Eksekutif Militer TNI Angkatan Udara) yang menyusun Laporan Pelaksanaan Kegiatan / Notulensi Rapat secara OTOMATIS.
Gunakan HANYA informasi aktual dari rekaman audio dan foto (OCR Undangan / Materi Paparan) pada sesi saat ini. Jangan mengarang judul kegiatan atau nama pejabat dari sesi sebelumnya.

Susun \`isiKegiatan\` / \`isiKegiatanDraft\` tepat dalam 4 poin bernomor (pisahkan antar poin dengan 1 baris kosong):
1. Dasar / Latar Belakang: ...

2. Jalannya Rapat / Pokok Pembahasan: ...

3. Hasil Rapat : ...

4. Kesimpulan: ...`;

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
      { name: 'gemini-3.1-flash-lite', useLowThinking: false },
      { name: 'gemini-3.8-flash', useLowThinking: false },
      { name: 'gemini-4-hydrogen', useLowThinking: true },
      { name: 'gemini-2.5-flash', useLowThinking: false },
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
      const prompt = `Klasifikasikan otomatis foto ini menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak HANYA informasi yang tertulis atau terlihat pada foto ini.${slideContextStr} Glossary: ${glossaryHint}`;
      const response = await invokeModel(
        {
          parts: [{ inlineData: { mimeType: img.mimeType, data: img.data } }, { text: prompt }],
        },
        VISION_ROUTER_SCHEMA
      );
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (overrideCategory) parsed.category = overrideCategory;
      return res.status(200).json(parsed);
    }

    if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nMateri Slide Paparan Sesi Ini:\n${paparanKnowledge.join('\n')}`
          : '';
      const prompt = `Gabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman sesi ini beserta materi slide paparan sesi ini menjadi satu Laporan Notulensi utuh:\n\n${JSON.stringify(previousSummaries)}${slideContextStr}`;
      const response = await invokeModel(prompt, REPORT_RESPONSE_SCHEMA);
      return res.status(200).json(JSON.parse((response.text ?? '{}').trim()));
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
        ? `\nIntegrasikan pula poin Materi Paparan sesi ini: ${paparanKnowledge.join(' | ')}`
        : '';

    parts.push({
      text: `Ekstrak otomatis judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan (4 poin), executiveSummary, actionItems, dan cleanTranscript HANYA dari suara dan materi rapat sesi ini. Bagian ${chunkIndex + 1}/${totalChunks}. Glossary: ${glossaryHint}${slideContextStr}`,
    });

    const response = await invokeModel({ parts }, REPORT_RESPONSE_SCHEMA);

    return res.status(200).json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error: any) {
    console.error('Vercel API Error:', error);
    return res.status(400).json({ error: error?.message || 'Gagal memproses data rapat.' });
  }
}
