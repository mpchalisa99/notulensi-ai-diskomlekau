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

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Multi-Modal & Rekonsiliasi Data Taktis AEGIS-BRIEF DISKOMLEKAU (Perwira Staf Ahli / Notulis Eksekutif Militer TNI Angkatan Udara).

ATURAN FUSI LINTAS-MODAL & REKONSILIASI ENTITAS (CROSS-MODAL FUSION RULES):
1. RULE A — VISUAL SPELLING ANCHOR (ANTI-HALLUCINATION): Gunakan teks hasil pindaian OCR_UNDANGAN dan MATERI_PAPARAN sebagai rujukan ejaan otoritatif untuk nama satuan militer, alutsista/radar, akronim, nama pejabat, pangkat, serta angka/spesifikasi teknis. Koreksi otomatis kesalahan fonetik speech-to-text pada transkrip suara menggunakan istilah resmi dari foto.
2. RULE B — NARRATIVE & SLIDE SYNTHESIS (TANPA DUPLIKASI BAGIAN): JANGAN memisahkan "Ringkasan Suara" dan "Hasil Scan Foto". Leburkan fakta konkret, angka, dan poin teknis dari MATERI_PAPARAN secara menyatu dan kronologis bersama arahan pimpinan dan diskusi dari rekaman suara ke dalam 4 poin baku \`isiKegiatan\`:
1. Dasar / Latar Belakang: ...

2. Jalannya Rapat / Pokok Pembahasan: ...

3. Hasil Rapat : ...

4. Kesimpulan: ...
3. RULE C — AUTOMATIC LANGUAGE NORMALIZATION: Terjemahkan dan adaptasikan istilah teknis/militer berbahasa Inggris dari suara maupun slide presentasi ke dalam Bahasa Indonesia dinas staf TNI AU yang lugas, formal, dan efektif.
4. RULE D — SYNCHRONIZED ACTION ITEMS: Silangkan instruksi lisan dari audio dengan tabel/jadwal pada slide MATERI_PAPARAN untuk mengisi Tugas, PIC / Satuan, dan Batas Waktu secara akurat.`;

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

    if (mode === 'cross_modal_fusion' && unifiedContext) {
      const fusionPrompt = `Lakukan SINTESIS LINTAS-MODAL & REKONSILIASI DATA (CROSS-MODAL FUSION) atas seluruh input sesi aktif berikut sesuai RULE A (Visual Spelling Anchor), RULE B (Narrative & Slide Synthesis tanpa duplikasi bagian), RULE C (Automatic Language Normalization ke bahasa dinas TNI AU), dan RULE D (Synchronized Action Items):
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Glossary: ${glossaryHint}`;
      const response = await invokeModel(fusionPrompt, REPORT_RESPONSE_SCHEMA);
      return res.status(200).json(JSON.parse((response.text ?? '{}').trim()));
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
      const prompt = `Lakukan Cross-Modal Fusion untuk menggabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman sesi ini beserta materi slide paparan dan undangan sesi ini menjadi satu Laporan Notulensi utuh:\n\n${JSON.stringify(previousSummaries)}${ocrContextStr}${slideContextStr}`;
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
        ? `\nIntegrasikan pula poin Materi Paparan sesi ini (Rule A & B): ${paparanKnowledge.join(' | ')}`
        : '';
    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nGunakan rujukan ejaan Undangan (OCR_UNDANGAN): ${ocrKnowledge.join(' | ')}`
        : '';

    parts.push({
      text: `Ekstrak dan lakukan Cross-Modal Fusion (judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan 4 poin terpadu, executiveSummary, actionItems, dan cleanTranscript) dari suara dan materi rapat sesi ini. Bagian ${chunkIndex + 1}/${totalChunks}. Glossary: ${glossaryHint}${ocrContextStr}${slideContextStr}`,
    });

    const response = await invokeModel({ parts }, REPORT_RESPONSE_SCHEMA);

    return res.status(200).json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error: any) {
    console.error('Vercel API Error:', error);
    return res.status(400).json({ error: error?.message || 'Gagal memproses data rapat.' });
  }
}
