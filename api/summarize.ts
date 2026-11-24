import {
  GEMINI_MODEL,
  GeminiFailoverExhaustedError,
  REPORT_RESPONSE_SCHEMA,
  SYSTEM_INSTRUCTION,
  VISION_ROUTER_SCHEMA,
  callGeminiProWithKeyFailover,
  normalizeAudioMimeType,
  normalizeServerIsiKegiatanSpacing,
  parseDataUrlImage,
} from './_geminiFailover';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
  maxDuration: 60,
};

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
      captureSource = 'camera',
      overrideCategory,
      preserveCategory = false,
      paparanKnowledge = [],
      ocrKnowledge = [],
      unifiedContext,
      visualImagesForFusion = [],
      metadata,
      chunkIndex = 0,
      totalChunks = 1,
      previousSummaries = [],
      mode = 'single',
    } = req.body || {};

    const glossaryHint =
      metadata?.customGlossary ||
      'Diskomlekau, Kadiskomlekau, Sesdiskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau';

    if (mode === 'autonomous_vision') {
      const img = parseDataUrlImage(imageDataUrl || '');
      const slideContextStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nMateri Slide Sesi Ini Sebelumnya: ${paparanKnowledge.join(' | ')}`
          : '';
      const sourceLabel =
        captureSource === 'upload'
          ? 'Unggahan Manual Operator'
          : captureSource === 'screen'
          ? 'Tangkapan Layar'
          : 'Kamera Lapangan';
      const prompt = `Analisis gambar (${sourceLabel}) dan klasifikasikan menjadi "OCR_UNDANGAN", "MATERI_PAPARAN", atau "DOKUMENTASI_KEGIATAN" (${overrideCategory ? `Wajib: ${overrideCategory}` : 'Otomatis'}). Ekstrak substansi strategis, spesifikasi teknis, observasi visual detail (\`visualCorrelationNote\`), dan isi surat dengan penalaran analitis Perwira Staf TNI AU. Pisahkan setiap poin bernomor di isiKegiatanDraft dengan baris kosong ganda (\\n\\n).${slideContextStr} Glossary: ${glossaryHint}`;

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(
          {
            parts: [{ inlineData: { mimeType: img.mimeType, data: img.data } }, { text: prompt }],
          },
          SYSTEM_INSTRUCTION,
          VISION_ROUTER_SCHEMA
        );
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatanDraft) {
        parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
      }
      if (overrideCategory && preserveCategory) {
        parsed.category = overrideCategory;
      } else if (overrideCategory) {
        parsed.category = overrideCategory;
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
      return res.status(200).json(parsed);
    }

    if (mode === 'cross_modal_fusion' && unifiedContext) {
      const fusionPromptText = `Terapkan Penalaran Analitis Perwira Staf TNI AU (TNI AU Staff Officer Analytical Reasoning) dan Fusi & Korelasi Lintas-Modal atas seluruh chunk audio (per 5 menit) dan gambar (kamera & upload manual) sesi aktif berikut:
1. DATA STREAM AUDIO (5-Menit Chunks): ${JSON.stringify(unifiedContext.audioStreamData || [])}
2. DATA PINDAIAN UNDANGAN (OCR_UNDANGAN): ${JSON.stringify(unifiedContext.ocrUndanganData || [])}
3. DATA PINDAIAN SLIDE / MATERI PAPARAN (MATERI_PAPARAN): ${JSON.stringify(unifiedContext.materiPaparanData || [])}
4. DATA DOKUMENTASI KEGIATAN & OBSERVASI VISUAL: ${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {})}
5. METADATA SAAT INI: ${JSON.stringify(unifiedContext.currentMetadata || metadata || {})}
Susun \`isiKegiatan\` (poin bernomor tematis dipisah \\n\\n), \`executiveSummary\`, \`correlationAnalysis\` (korelasi audio vs gambar kamera/upload), \`detailedResume\` (resume detil lengkap), \`actionItems\`, dan \`cleanTranscript\`. Glossary: ${glossaryHint}`;

      const fusionParts: any[] = [{ text: fusionPromptText }];
      if (Array.isArray(visualImagesForFusion) && visualImagesForFusion.length > 0) {
        visualImagesForFusion.slice(0, 4).forEach((item: any) => {
          const dataUrl = typeof item === 'string' ? item : item?.dataUrl;
          const label = typeof item === 'object' && item?.label ? item.label : 'Lampiran Visual';
          if (typeof dataUrl === 'string' && dataUrl.length > 50) {
            const img = parseDataUrlImage(dataUrl);
            fusionParts.push({ text: `[Referensi Gambar Sesi: ${label}]` });
            fusionParts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
          }
        });
      }

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(
          { parts: fusionParts },
          SYSTEM_INSTRUCTION,
          REPORT_RESPONSE_SCHEMA
        );
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
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
      const prompt = `Terapkan penalaran analitis Perwira Staf TNI AU dan Cross-Modal Correlation untuk menggabungkan hasil ekstraksi ${previousSummaries.length} bagian rekaman 5-menit sesi ini beserta gambar kamera & upload manual menjadi satu Laporan Notulensi utuh beserta \`correlationAnalysis\` dan \`detailedResume\` detil:\n\n${JSON.stringify(previousSummaries)}${ocrContextStr}${slideContextStr}`;

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(prompt, SYSTEM_INSTRUCTION, REPORT_RESPONSE_SCHEMA);
      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
      return res.status(200).json(parsed);
    }

    const normalizedMimeType = normalizeAudioMimeType(mimeType);
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
      text: `Saring basa-basi lisan dan terapkan Penalaran Analitis Perwira Staf TNI AU (Cross-Modal Fusion) untuk menyusun judulKegiatan, pimpinanRapat, pesertaRapat, tempat, isiKegiatan (poin bernomor tematis dengan baris kosong ganda \\n\\n antar poin), executiveSummary, correlationAnalysis, detailedResume, actionItems, dan cleanTranscript dari segmen rekaman 5-menit dan materi rapat sesi ini. Bagian ${chunkIndex + 1}/${totalChunks}. Glossary: ${glossaryHint}${ocrContextStr}${slideContextStr}`,
    });

    const { response, modelUsed, keySlotUsed, failoverTriggered } =
      await callGeminiProWithKeyFailover({ parts }, SYSTEM_INSTRUCTION, REPORT_RESPONSE_SCHEMA);
    const parsed = JSON.parse((response.text ?? '{}').trim());
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    parsed.modelUsed = modelUsed;
    parsed.keySlotUsed = keySlotUsed;
    parsed.failoverTriggered = failoverTriggered;
    return res.status(200).json(parsed);
  } catch (error: any) {
    console.error('Vercel API Error:', error);
    const isExhausted = error instanceof GeminiFailoverExhaustedError;
    const failureReason = isExhausted ? error.failureReason : 'GEMINI_ERROR';
    const attemptedKeySlots = isExhausted ? error.attemptedKeySlots : undefined;
    const statusCode = failureReason === 'NO_KEY' ? 400 : 503;

    return res.status(statusCode).json({
      error: error?.message || `Gagal memproses data rapat dengan ${GEMINI_MODEL}.`,
      geminiFailed: true,
      allKeysExhausted: isExhausted,
      failureReason,
      attemptedKeySlots,
      model: GEMINI_MODEL,
    });
  }
}
