import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
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
} from './api/_geminiFailover';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

    const glossaryHint = metadata?.customGlossary?.trim()
      ? metadata.customGlossary.trim()
      : 'Kadiskomlekau, Sesdiskomlekau, Diskomlekau, Subdisrudal, Kasubdis, Kasatkomlek, Kabag, Kemhan, Mabesau, TNI AU, Vicon';

    // 1. AUTONOMOUS MULTI-MODAL VISION ROUTER (Camera & Manual Upload Images)
    if (mode === 'autonomous_vision') {
      if (!imageDataUrl || typeof imageDataUrl !== 'string') {
        res.status(400).end(JSON.stringify({ error: 'Data foto tidak ditemukan.' }));
        return;
      }
      startHeartbeat();
      const img = parseDataUrlImage(imageDataUrl);
      const sourceLabel =
        captureSource === 'upload'
          ? 'Unggahan Manual Operator'
          : captureSource === 'screen'
          ? 'Tangkapan Layar Presentasi/Vicon'
          : 'Kamera Lapangan';

      const forcedCategoryInstruction = overrideCategory
        ? `klasifikasikan wajib sebagai "${overrideCategory}" sesuai instruksi operator`
        : `klasifikasikan secara OTOMATIS ke dalam salah satu dari 3 kategori berikut:
1. "OCR_UNDANGAN": Jika foto berupa surat undangan rapat, nota dinas, telegram, jadwal kegiatan, atau daftar hadir. Ekstrak otomatis judulKegiatan, hariTanggal, pukul, tempat, pimpinanRapat, dan pesertaRapat via OCR.
2. "MATERI_PAPARAN": Jika foto berupa slide presentasi, layar proyektor, diagram teknis, tabel spesifikasi, atau papan tulis. Ekstrak seluruh substansi strategis, spesifikasi teknis, kesiapan peralatan, parameter pengadaan/kontrak, tabel, dan angka ke dalam \`extractedKnowledge\` (dalam bahasa dinas TNI AU yang analitis) serta susun \`isiKegiatanDraft\` dengan spasi baris kosong (\\n\\n) antar poin bernomor.
3. "DOKUMENTASI_KEGIATAN": Jika foto berupa situasi ruang rapat, personel di lapangan, perangkat/alutsista fisik, atau kegiatan fisik. Jelaskan secara detil kondisi visual, perangkat/lokasi/personel yang tampak pada \`extractedKnowledge\` dan \`visualCorrelationNote\` untuk dikorelasikan dengan audio rapat.`;

      const slideKnowledgeStr =
        Array.isArray(paparanKnowledge) && paparanKnowledge.length > 0
          ? `\nPengetahuan Slide Paparan Sesi Ini Sebelumnya:\n${paparanKnowledge.join('\n')}`
          : '';

      const visionPrompt = `Analisis gambar (${sourceLabel}) ini menggunakan Autonomous Multi-Modal Vision Router AEGIS-BRIEF DISKOMLEKAU dengan penalaran analitis Perwira Staf TNI AU, dan ${forcedCategoryInstruction}.
Ekstrak HANYA informasi yang tertulis atau terlihat secara faktual pada gambar ini, serta isi \`visualCorrelationNote\` untuk keperluan korelasi lintas-modal dengan rekaman audio rapat.${slideKnowledgeStr}
Glosarium Istilah: ${glossaryHint}`;

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(
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
      if (parsed.isiKegiatanDraft) {
        parsed.isiKegiatanDraft = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatanDraft);
      }
      if (overrideCategory && preserveCategory) {
        parsed.category = overrideCategory;
      } else if (overrideCategory) {
        parsed.category = overrideCategory;
      } else if (
        parsed.category !== 'OCR_UNDANGAN' &&
        parsed.category !== 'MATERI_PAPARAN' &&
        parsed.category !== 'DOKUMENTASI_KEGIATAN'
      ) {
        parsed.category = 'DOKUMENTASI_KEGIATAN';
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
      res.end(JSON.stringify(parsed));
      return;
    }

    // 2. UNIFIED CROSS-MODAL CORRELATION & DETAILED RESUME ENGINE
    if (mode === 'cross_modal_fusion' && unifiedContext) {
      startHeartbeat();
      const fusionPromptText = `Terapkan PENALARAN ANALITIS PERWIRA STAF TNI AU (TNI AU Staff Officer Analytical Reasoning) dan FUSI & KORELASI LINTAS-MODAL (CROSS-MODAL CORRELATION) atas seluruh data rekaman audio (chunk per 5 menit) dan gambar hasil kamera maupun unggahan manual pada sesi aktif berikut:

=== PAYLOAD KONTEKS MULTI-MODAL SESI AKTIF ===
1. DATA STREAM REKAMAN AUDIO PER 5 MENIT (Transkrip & Ringkasan Seluruh Chunk):
${JSON.stringify(unifiedContext.audioStreamData || [], null, 2)}

2. DATA PINDAIAN UNDANGAN (\`OCR_UNDANGAN\` — Kamera & Upload Manual):
${JSON.stringify(unifiedContext.ocrUndanganData || [], null, 2)}

3. DATA PINDAIAN SLIDE / MATERI PAPARAN (\`MATERI_PAPARAN\` — Kamera & Upload Manual):
${JSON.stringify(unifiedContext.materiPaparanData || [], null, 2)}

4. DATA DOKUMENTASI KEGIATAN & OBSERVASI VISUAL (\`DOKUMENTASI_KEGIATAN\` — Kamera & Upload Manual):
${JSON.stringify(unifiedContext.dokumentasiKegiatanData || {}, null, 2)}

5. METADATA RAPAT SAAT INI:
${JSON.stringify(unifiedContext.currentMetadata || metadata || {}, null, 2)}

Glosarium Resmi TNI AU / DISKOMLEKAU: ${glossaryHint}

Instruksi Wajib:
- Gabungkan SEMUA data dari seluruh chunk rekaman audio (per 5 menit) dengan hasil analisa gambar kamera maupun upload manual.
- Lakukan analisis korelasi mendalam (\`correlationAnalysis\`): jelaskan keterkaitan, penguatan, ataupun perbedaan antara pernyataan pembicara di rekaman audio dengan bukti visual pada gambar (surat undangan, slide paparan, tabel/spesifikasi teknis, serta foto dokumentasi).
- Susun \`detailedResume\` berupa RESUME RAPAT YANG SANGAT DETIL, terstruktur rapi, mencakup gambaran umum, rincian pembahasan tiap topik/segmen, data teknis & angka presisi, temuan korelasi audio-visual, kendala/risiko, keputusan komando, dan langkah tindak lanjut.
- Susun \`isiKegiatan\` dalam poin-poin bernomor tematis (1., 2., 3., dst.) sesuai prioritas strategis dengan pemisah baris kosong eksplisit (\\n\\n) antar poin.
- Sinkronkan \`actionItems\` (\`task\`, \`pic\`, \`deadline\`) dan \`cleanTranscript\` secara utuh.`;

      const fusionParts: any[] = [{ text: fusionPromptText }];
      if (Array.isArray(visualImagesForFusion) && visualImagesForFusion.length > 0) {
        visualImagesForFusion.slice(0, 6).forEach((item: any) => {
          const dataUrl = typeof item === 'string' ? item : item?.dataUrl;
          const label = typeof item === 'object' && item?.label ? item.label : 'Lampiran Visual';
          if (typeof dataUrl === 'string' && dataUrl.length > 50) {
            const img = parseDataUrlImage(dataUrl);
            fusionParts.push({ text: `[Referensi Gambar Sesi: ${label}]` });
            fusionParts.push({
              inlineData: { mimeType: img.mimeType, data: img.data },
            });
          }
        });
      }

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(
          { parts: fusionParts },
          SYSTEM_INSTRUCTION,
          REPORT_RESPONSE_SCHEMA
        );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
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

      const combinedPrompt = `Terapkan penalaran analitis Perwira Staf TNI AU dan Cross-Modal Correlation untuk menggabungkan hasil ekstraksi dari ${previousSummaries.length} segmen rekaman 5-menitan sesi ini beserta pindaian gambar kamera maupun upload manual (OCR_UNDANGAN, MATERI_PAPARAN, DOKUMENTASI_KEGIATAN) menjadi SATU laporan notulensi utuh beserta \`correlationAnalysis\` dan \`detailedResume\` yang detil:

${JSON.stringify(previousSummaries, null, 2)}${ocrContextStr}${slideContextStr}${unifiedContextStr}

Istilah Khusus (Glossary): ${glossaryHint}`;

      const { response, modelUsed, keySlotUsed, failoverTriggered } =
        await callGeminiProWithKeyFailover(
          combinedPrompt,
          SYSTEM_INSTRUCTION,
          REPORT_RESPONSE_SCHEMA
        );
      stopHeartbeat();
      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);
      if (parsed.isiKegiatan) {
        parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
      }
      parsed.modelUsed = modelUsed;
      parsed.keySlotUsed = keySlotUsed;
      parsed.failoverTriggered = failoverTriggered;
      res.end(JSON.stringify(parsed));
      return;
    }

    // 4. SINGLE 5-MINUTE AUDIO CHUNK (+ CURRENT SESSION OCR_UNDANGAN, MATERI_PAPARAN & SCREEN FRAMES)
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
        ? `\nKonteks Materi Slide Paparan (MATERI_PAPARAN — gunakan sebagai Visual Spelling Anchor & integrasikan langsung ke dalam poin-poin analitis isiKegiatan):\n${paparanKnowledge.join('\n')}`
        : '';

    const ocrContextStr =
      Array.isArray(ocrKnowledge) && ocrKnowledge.length > 0
        ? `\nKonteks Pindaian Undangan (OCR_UNDANGAN — gunakan sebagai rujukan ejaan resmi Judul, Waktu, Tempat, Pimpinan & Peserta):\n${ocrKnowledge.join('\n')}`
        : '';

    const currentTitleHint = metadata?.judulKegiatan?.trim()
      ? `\nJudul Kegiatan Sesi Ini (dari Undangan/Input): ${metadata.judulKegiatan.trim()}`
      : '';

    parts.push({
      text: `Transkripsikan secara lengkap, saring basa-basi lisan, terjemahkan istilah asing ke bahasa dinas TNI AU, dan terapkan Penalaran Analitis Perwira Staf TNI AU (Cross-Modal Fusion) antara segmen rekaman suara 5-menit ini dengan data gambar (OCR_UNDANGAN & MATERI_PAPARAN) sesi ini.${currentTitleHint}
Bagian Rekaman (Chunk 5 Menit): ${chunkIndex + 1} dari ${totalChunks}.
Daftar Istilah / Singkatan Resmi (Glossary): ${glossaryHint}.${ocrContextStr}${slideContextStr}
Susun \`isiKegiatan\`, \`executiveSummary\`, \`correlationAnalysis\`, \`detailedResume\`, \`actionItems\`, dan \`cleanTranscript\` sesuai skema.`,
    });

    const { response, modelUsed, keySlotUsed, failoverTriggered } =
      await callGeminiProWithKeyFailover(
        { parts },
        SYSTEM_INSTRUCTION,
        REPORT_RESPONSE_SCHEMA
      );

    stopHeartbeat();
    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText);
    if (parsed.isiKegiatan) {
      parsed.isiKegiatan = normalizeServerIsiKegiatanSpacing(parsed.isiKegiatan);
    }
    parsed.modelUsed = modelUsed;
    parsed.keySlotUsed = keySlotUsed;
    parsed.failoverTriggered = failoverTriggered;
    res.end(JSON.stringify(parsed));
  } catch (error: any) {
    stopHeartbeat();
    console.error('Gemini API Error:', error);

    const isExhausted = error instanceof GeminiFailoverExhaustedError;
    const failureReason = isExhausted ? error.failureReason : 'GEMINI_ERROR';
    const attemptedKeySlots = isExhausted ? error.attemptedKeySlots : undefined;
    const statusCode = failureReason === 'NO_KEY' ? 400 : 503;

    const message =
      error?.message ||
      `Terjadi kesalahan saat memproses data rapat dengan model ${GEMINI_MODEL}.`;
    if (!res.headersSent) {
      res.status(statusCode);
    }
    res.end(
      JSON.stringify({
        error: message,
        geminiFailed: true,
        allKeysExhausted: isExhausted,
        failureReason,
        attemptedKeySlots,
        model: GEMINI_MODEL,
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
    console.log(
      `AEGIS-BRIEF DISKOMLEKAU Server (${GEMINI_MODEL}) listening on http://0.0.0.0:${PORT}`
    );
  });
}

startServer();
