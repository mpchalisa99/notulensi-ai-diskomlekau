import { GoogleGenAI, Type } from '@google/genai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
  maxDuration: 60,
};

function getGeminiClient(customKey?: string): GoogleGenAI {
  const apiKey = (customKey && customKey.trim()) ? customKey.trim() : process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi. Silakan masukkan kunci API Anda di Settings atau periksa Environment Variables.'
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

async function callGroqTranscription(buffer: Buffer, mimeType: string, groqApiKey: string): Promise<string> {
  const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'webm';
  const filename = `audio.${ext}`;
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  formData.append('file', blob, filename);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'id');
  formData.append('response_format', 'json');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqApiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq Whisper API error (HTTP ${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.text || '';
}

async function callGroqVision(imageDataUrl: string, prompt: string, groqApiKey: string): Promise<string> {
  const visionModels = [
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
  ];
  for (const model of visionModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: imageDataUrl } },
                { type: 'text', text: prompt + '\nReturn JSON format.' }
              ]
            }
          ],
          response_format: { type: 'json_object' }
        }),
      });
      if (!res.ok) {
        const status = res.status;
        const errText = await res.text();
        if (status === 404 || errText.includes('model_not_found') || errText.includes('not found')) {
          continue;
        }
        throw new Error(`Groq Vision API error (HTTP ${status}): ${errText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '{}';
    } catch (err: any) {
      if (err?.message?.includes('404') || err?.message?.includes('model_not_found')) {
        continue;
      }
    }
  }
  return '{}';
}

async function callGroqChat(prompt: string, systemInstruction: string, groqApiKey: string): Promise<string> {
  const chatModels = [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'llama-3.1-8b-instant',
  ];
  let lastErr: any;
  for (const model of chatModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemInstruction + '\nCRITICAL: Return ONLY valid JSON matching the requested schema.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        }),
      });
      if (!res.ok) {
        const status = res.status;
        const errText = await res.text();
        if (status === 404 || errText.includes('model_not_found') || errText.includes('not found')) {
          lastErr = new Error(`Groq Chat model ${model} not found`);
          continue;
        }
        throw new Error(`Groq Chat API error (HTTP ${status}): ${errText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '{}';
    } catch (err: any) {
      lastErr = err;
      if (err?.message?.includes('404') || err?.message?.includes('model_not_found')) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('All Groq chat models failed.');
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

const SYSTEM_INSTRUCTION = `Anda adalah Mesin Sintesis Analitis Mendalam & Rekonsiliasi Data Taktis AEGIS-BRIEF DISKOMLEKAU yang bekerja dengan ketajaman penalaran **Perwira Staf Ahli TNI Angkatan Udara (TNI AU Staff Officer Analytical Reasoning)**.

I. ANALISIS MULTI-MODAL MENDALAM & EKSTRAKSI BUKTI (EXHAUSTIVE MULTI-MODAL EVIDENCE EXTRACTION):
1. FILTER NOISE, EKSTRAK SUBSTANSI KERAS:
   - Singkirkan sepenuhnya basa-basi, sapaan pembuka/penutup, dan pengulangan lisan.
   - Fokus secara ketat pada substansi strategis: spesifikasi teknis elektronika/komlek, tingkat kesiapan alutsista/radar/jaringan, parameter kontrak/pengadaan, alokasi anggaran, jadwal milestone, kendala operasional/pemeliharaan (*operational bottlenecks*), serta keputusan komando.

2. STRUKTUR ANALITIS MENDALAM PER POIN (\`isiKegiatan\`):
   - Susun \`isiKegiatan\` ke dalam 3 hingga 5 poin bernomor tematis (\`1.\`, \`2.\`, \`3.\`, dst.) di mana SETIAP POIN berisi 3 hingga 5 kalimat terstruktur dan komprehensif, diurutkan berdasarkan prioritas strategis:
     * **Poin 1 (Latar Belakang & Dasar Rujukan):** Menguraikan dasar rujukan formal (surat, telegram, kontrak, atau unit baseline) serta objektif strategis rapat yang bersumber dari pindaian \`OCR_UNDANGAN\` dan transkrip audio awal.
     * **Poin-Poin Tengah (Data Kuantitatif, Spesifikasi Teknis & Analisis Pembahasan):** Membedah setiap angka kuantitatif, persentase, nilai anggaran, parameter frekuensi/radar/rudal, serta tanggal timeline yang ditarik secara silang (*cross-verify*) antara lisan pembicara dan tabel/grafik pada \`MATERI_PAPARAN\`. Menjelaskan *mengapa* suatu kendala teknis krusial dan dampaknya terhadap kesiapan operasional Diskomlekau.
     * **Poin Terakhir (Implikasi Operasional & Keputusan Pimpinan):** Merumuskan dampak strategis terhadap kesiapan TNI AU serta direktif tegas, tenggat waktu (*deadlines*), dan penanggung jawab (*PIC*) yang diputuskan oleh \`pimpinanRapat\`.

3. CROSS-MODAL REASONING & DISCREPANCY CHECK:
   - Apabila pembicara dalam audio hanya menyebutkan secara singkat ("seperti tertera pada paparan..."), otomatis perluas dan lengkapi narasi laporan dengan data rinci sub-komponen atau parameter teknis yang tertera pada gambar \`MATERI_PAPARAN\` agar laporan bernilai mandiri (*self-contained*).

4. BAHASA DINAS STAF TNI AU OTORITATIF & SPASI GANDA (\`\\n\\n\`):
   - Gunakan bahasa dinas staf TNI AU yang lugas, analitis, padat, dan presisi.
   - SETIAP poin bernomor di dalam \`isiKegiatan\` WAJIB dipisahkan oleh satu baris kosong eksplisit (\`\\n\\n\`):

1. [Paragraf mendalam poin pertama yang merinci latar belakang, dasar rujukan, dan data dasar.]

2. [Paragraf mendalam poin kedua yang membedah spesifikasi teknis, data kuantitatif, dan analisis temuan.]

3. [Paragraf mendalam poin terakhir yang menguraikan implikasi operasional dan direktif pimpinan.]

II. ATURAN FUSI LINTAS-MODAL:
- **RULE A — VISUAL SPELLING ANCHOR:** Gunakan teks \`OCR_UNDANGAN\` dan \`MATERI_PAPARAN\` sebagai rujukan ejaan otoritatif untuk nama satuan (Diskomlekau, Subdisrudal, Satkomlek), kode alutsista/radar, dan pangkat.
- **RULE B — NARRATIVE & SLIDE SYNTHESIS:** JANGAN memisahkan "Ringkasan Suara" dan "Hasil Scan Foto". Leburkan seluruh fakta ke dalam alur poin \`isiKegiatan\`.
- **RULE C — AUTOMATIC LANGUAGE NORMALIZATION:** Terjemahkan istilah teknis berbahasa Inggris dari suara/slide ke bahasa dinas staf TNI AU yang formal.
- **RULE D — SYNCHRONIZED ACTION ITEMS:** Silangkan instruksi lisan di audio dengan target di slide \`MATERI_PAPARAN\` untuk mengisi \`actionItems\` secara presisi. Jangan menyertakan salam pembuka/penutup di dalam \`isiKegiatan\`.`;

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
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
  ];
  let lastError: unknown = null;

  for (const modelName of candidateModels) {
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
      return response;
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message || '').toLowerCase();
      const status = Number(err?.status || err?.statusCode || err?.code || 0);
      if (
        status === 404 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        msg.includes('404') ||
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('unavailable') ||
        msg.includes('high demand') ||
        msg.includes('overloaded') ||
        msg.includes('not_found') ||
        msg.includes('not found') ||
        msg.includes('no longer available') ||
        msg.includes('not supported') ||
        msg.includes('resource_exhausted') ||
        msg.includes('quota') ||
        msg.includes('rate limit') ||
        msg.includes('too many requests')
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

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
      customGeminiApiKey,
      groqApiKey,
      aiMode = 'auto',
    } = req.body || {};

    const glossaryHint = metadata?.customGlossary?.trim()
      ? metadata.customGlossary.trim()
      : 'Kadiskomlekau, Sesdiskomlekau, Diskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau, TNI AU, Vicon';

    const useGroq = aiMode === 'groq' && Boolean(groqApiKey && groqApiKey.trim());
    let failoverTriggered = false;
    let failoverStatus: string | undefined;

    const executeGemini = async (contents: any, schema: any) => {
      const ai = getGeminiClient(customGeminiApiKey);
      return await callGeminiWithSchemaFallback(ai, contents, SYSTEM_INSTRUCTION, schema);
    };

    const executeGroq = async () => {
      if (!groqApiKey || !groqApiKey.trim()) {
        throw new Error('Gemini gagal dan Groq API Key belum dikonfigurasi di Settings.');
      }
      const key = groqApiKey.trim();

      if (mode === 'autonomous_vision') {
        const prompt = `Klasifikasikan otomatis foto ini menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak substansi strategis dan spesifikasi teknis dengan penalaran analitis Perwira Staf TNI AU. Glossary: ${glossaryHint}`;
        const rawJsonStr = await callGroqVision(imageDataUrl || '', prompt, key);
        const parsed = JSON.parse(rawJsonStr);
        if (parsed.isiKegiatanDraft) {
          parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
        }
        if (overrideCategory) parsed.category = overrideCategory;
        return {
          parsed,
          modelUsed: 'groq-llama-vision',
        };
      }

      let transcriptionText = '';
      if (audioBase64 && typeof audioBase64 === 'string') {
        try {
          const audioBuffer = Buffer.from(audioBase64, 'base64');
          const baseMime = (mimeType || 'audio/webm').split(';')[0].trim().toLowerCase();
          transcriptionText = await callGroqTranscription(audioBuffer, baseMime, key);
        } catch (e) {
          console.warn('Groq Whisper transcription fallback warning:', e);
        }
      }

      let chatPrompt = '';
      if (mode === 'cross_modal_fusion' && unifiedContext) {
        chatPrompt = `Terapkan Penalaran Analitis Perwira Staf TNI AU dan Fusi Lintas-Modal atas seluruh input sesi aktif berikut:
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Glossary: ${glossaryHint}`;
      } else if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
        chatPrompt = `Gabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman sesi ini beserta materi slide paparan dan undangan menjadi satu Laporan Notulensi utuh:\n\n${JSON.stringify(previousSummaries)}`;
      } else {
        chatPrompt = `Transkrip Audio (Whisper): "${transcriptionText}"
Konteks Pindaian Undangan: ${JSON.stringify(ocrKnowledge)}
Konteks Materi Paparan: ${JSON.stringify(paparanKnowledge)}
Susun Laporan Pelaksanaan Kegiatan resmi DISKOMLEKAU lengkap dengan isiKegiatan (poin bernomor tematis dengan baris kosong ganda \\n\\n), executiveSummary, actionItems, dan cleanTranscript. Glossary: ${glossaryHint}`;
      }

      const rawJsonStr = await callGroqChat(chatPrompt, SYSTEM_INSTRUCTION, key);
      const parsed = JSON.parse(rawJsonStr);
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      return {
        parsed,
        modelUsed: 'groq-gpt-oss-120b',
      };
    };

    let resultPayload: any;

    if (useGroq) {
      const groqRes = await executeGroq();
      resultPayload = {
        ...groqRes.parsed,
        modelUsed: groqRes.modelUsed,
        failoverTriggered: false,
      };
    } else {
      try {
        let geminiContents: any;
        if (mode === 'autonomous_vision') {
          const img = parseDataUrlImage(imageDataUrl || '');
          geminiContents = {
            parts: [
              { inlineData: { mimeType: img.mimeType, data: img.data } },
              { text: `Klasifikasikan otomatis foto ini menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak substansi strategis dan spesifikasi teknis. Glossary: ${glossaryHint}` },
            ],
          };
        } else if (mode === 'cross_modal_fusion' && unifiedContext) {
          geminiContents = `Terapkan Penalaran Analitis Mendalam Perwira Staf TNI AU dan Fusi Lintas-Modal atas seluruh input sesi aktif berikut:
1. DATA STREAM AUDIO: ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. OCR UNDANGAN: ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. MATERI PAPARAN: ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DOKUMENTASI KEGIATAN: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Glossary: ${glossaryHint}`;
        } else if (mode === 'synthesize' && Array.isArray(previousSummaries) && previousSummaries.length > 0) {
          geminiContents = `Gabungkan hasil ekstraksi dari ${previousSummaries.length} segmen rekaman sesi ini beserta pindaian OCR_UNDANGAN dan MATERI_PAPARAN menjadi SATU laporan notulensi utuh dengan pemisah baris kosong ganda (\\n\\n) antar poin:\n\n${JSON.stringify(previousSummaries)}`;
        } else {
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
              ? `\nKonteks Materi Slide Paparan:\n${paparanKnowledge.join('\n')}`
              : '';

          const ocrContextStr =
            Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
              ? `\nKonteks Pindaian Undangan:\n${ocrKnowledge.join('\n')}`
              : '';

          const currentTitleHint = metadata?.judulKegiatan?.trim()
            ? `\nJudul Kegiatan: ${metadata.judulKegiatan.trim()}`
            : '';

          parts.push({
            text: `Transkripsikan, saring basa-basi lisan, terjemahkan istilah asing ke bahasa dinas TNI AU, dan terapkan Penalaran Analitis Mendalam Perwira Staf TNI AU.${currentTitleHint}
Bagian Rekaman: ${chunkIndex + 1} dari ${totalChunks}.
Glossary: ${glossaryHint}.${ocrContextStr}${slideContextStr}
Susun \`isiKegiatan\` dalam poin-poin bernomor tematis (3-5 kalimat rinci per poin) dengan pemisah baris kosong eksplisit (\\n\\n) di antara setiap poin.`,
          });
          geminiContents = { parts };
        }

        const schema = mode === 'autonomous_vision' ? VISION_ROUTER_SCHEMA : REPORT_RESPONSE_SCHEMA;
        const geminiResp = await executeGemini(geminiContents, schema);

        const rawText = (geminiResp.text ?? '{}').trim();
        const parsed = JSON.parse(rawText);
        if (parsed.isiKegiatan) {
          parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
        }
        if (parsed.isiKegiatanDraft) {
          parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
        }
        if (mode === 'autonomous_vision' && overrideCategory) {
          parsed.category = overrideCategory;
        }

        resultPayload = {
          ...parsed,
          modelUsed: 'gemini-flash',
          failoverTriggered: false,
        };
      } catch (geminiErr: any) {
        if (groqApiKey && groqApiKey.trim()) {
          failoverTriggered = true;
          failoverStatus = 'Server Gemini sedang padat. Mengalihkan otomatis ke Groq...';
          const groqRes = await executeGroq();
          resultPayload = {
            ...groqRes.parsed,
            modelUsed: `${groqRes.modelUsed} (Gemini Failover)`,
            failoverTriggered: true,
            failoverStatus,
          };
        } else {
          throw geminiErr;
        }
      }
    }

    return res.status(200).json(resultPayload);
  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(400).json({ error: error?.message || 'Gagal memproses data rapat.' });
  }
}
