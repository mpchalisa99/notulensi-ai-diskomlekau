import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  MonitorSpeaker,
  Upload,
  Square,
  Pause,
  Play,
  Sparkles,
  Camera,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import type { AudioChunkItem, CaptureMode } from '../types';
import { formatDurationHMS } from '../utils/reportFormatter';

interface AudioRecorderProps {
  chunks: AudioChunkItem[];
  screenFrames: string[];
  onAddScreenFrame: (dataUrl: string) => void;
  onRemoveScreenFrame: (idx: number) => void;
  onAddChunk: (chunk: AudioChunkItem) => void;
  onClearChunks: () => void;
  onRemoveChunk: (id: string) => void;
  onProcessWithAI: (chunksToProcess?: AudioChunkItem[]) => void;
  isProcessingAI: boolean;
  processingStatusText: string;
}

const CHUNK_DURATION_MS = 10 * 60 * 1000;
const AUTO_SCREENSHOT_INTERVAL_MS = 15 * 60 * 1000;
const MAX_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  chunks,
  screenFrames,
  onAddScreenFrame,
  onAddChunk,
  onClearChunks,
  onProcessWithAI,
  isProcessingAI,
  processingStatusText,
}) => {
  const [captureMode, setCaptureMode] = useState<CaptureMode>('dual');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentChunkNumber, setCurrentChunkNumber] = useState(1);

  const [screenVideoActive, setScreenVideoActive] = useState(false);
  const [systemAudioActive, setSystemAudioActive] = useState(false);
  const [micAudioActive, setMicAudioActive] = useState(false);
  const [recorderWarning, setRecorderWarning] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rightCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const displayVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamsRef = useRef<MediaStream[]>([]);
  const mixedDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const chunkStartElapsedRef = useRef<number>(0);
  const elapsedSecondsRef = useRef<number>(0);
  const chunkCounterRef = useRef<number>(0);
  const chunkTimerRef = useRef<number | null>(null);
  const screenSnapIntervalRef = useRef<number | null>(null);
  const clockIntervalRef = useRef<number | null>(null);
  const capturedFramesRef = useRef<string[]>([]);
  const autoProcessOnStopRef = useRef<boolean>(false);

  useEffect(() => {
    capturedFramesRef.current = screenFrames;
  }, [screenFrames]);

  const captureFrameFromDisplayTrack = useCallback((): string | null => {
    const track = displayVideoTrackRef.current;
    const videoEl = displayVideoRef.current;

    if (!track || track.readyState !== 'live' || !videoEl) {
      return null;
    }

    if (videoEl.readyState < 2 || videoEl.videoWidth === 0 || videoEl.videoHeight === 0) {
      return null;
    }

    const snapCanvas = document.createElement('canvas');
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(videoEl.videoWidth, videoEl.videoHeight));
    snapCanvas.width = Math.round(videoEl.videoWidth * scale);
    snapCanvas.height = Math.round(videoEl.videoHeight * scale);

    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoEl, 0, 0, snapCanvas.width, snapCanvas.height);

    const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.78);
    onAddScreenFrame(dataUrl);
    return dataUrl;
  }, [onAddScreenFrame]);

  useEffect(() => {
    if (!isRecording || !screenVideoActive) {
      if (screenSnapIntervalRef.current) {
        window.clearInterval(screenSnapIntervalRef.current);
        screenSnapIntervalRef.current = null;
      }
      return;
    }

    screenSnapIntervalRef.current = window.setInterval(() => {
      if (!isPaused && displayVideoTrackRef.current?.readyState === 'live') {
        captureFrameFromDisplayTrack();
      }
    }, AUTO_SCREENSHOT_INTERVAL_MS);

    return () => {
      if (screenSnapIntervalRef.current) {
        window.clearInterval(screenSnapIntervalRef.current);
        screenSnapIntervalRef.current = null;
      }
    };
  }, [isRecording, isPaused, screenVideoActive, captureFrameFromDisplayTrack]);

  const drawTacticalWaveforms = () => {
    const analyser = analyserRef.current;
    let dataArray: Uint8Array | null = null;
    if (analyser && isRecording && !isPaused) {
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>);
    }

    const renderWing = (canvas: HTMLCanvasElement | null, invertSide: boolean) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const centerY = height / 2;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      const barCount = 26;
      const barGap = 2.5;
      const barWidth = Math.max(2, (width - barGap * (barCount - 1)) / barCount);

      for (let i = 0; i < barCount; i++) {
        const idx = invertSide ? barCount - 1 - i : i;
        let normalized = 0.1;

        if (dataArray && isRecording && !isPaused) {
          const binIdx = Math.min(
            dataArray.length - 1,
            Math.floor((idx / barCount) * (dataArray.length * 0.6))
          );
          const val = dataArray[binIdx] / 255;
          const envelope = 1 - (Math.abs(i - barCount / 2) / (barCount / 2)) * 0.4;
          normalized = Math.max(0.08, Math.min(0.95, val * envelope));
        } else {
          const wave =
            Math.sin(idx * 0.65) * 0.35 +
            Math.cos(idx * 1.3) * 0.25 +
            (idx % 3 === 0 ? 0.22 : 0.08);
          const envelope = Math.sin((i / (barCount - 1)) * Math.PI);
          normalized = Math.max(0.06, Math.abs(wave) * envelope * 0.85);
        }

        const barH = Math.max(3, normalized * (height * 0.88));
        const x = i * (barWidth + barGap);
        const y = centerY - barH / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barH);
        grad.addColorStop(0, '#6EE7B7');
        grad.addColorStop(0.5, '#10B981');
        grad.addColorStop(1, '#047857');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1.5);
        ctx.fill();
      }
    };

    renderWing(leftCanvasRef.current, true);
    renderWing(rightCanvasRef.current, false);

    if (isRecording && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(drawTacticalWaveforms);
    }
  };

  useEffect(() => {
    drawTacticalWaveforms();
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRecording, isPaused]);

  useEffect(() => {
    return () => {
      cleanupAudioResources();
    };
  }, []);

  const cleanupAudioResources = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (chunkTimerRef.current) {
      window.clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (screenSnapIntervalRef.current) {
      window.clearInterval(screenSnapIntervalRef.current);
      screenSnapIntervalRef.current = null;
    }
    if (clockIntervalRef.current) {
      window.clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    if (displayVideoRef.current) {
      displayVideoRef.current.srcObject = null;
    }
    displayVideoTrackRef.current = null;
    activeStreamsRef.current.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    activeStreamsRef.current = [];
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    mixedDestinationRef.current = null;
    setScreenVideoActive(false);
    setSystemAudioActive(false);
    setMicAudioActive(false);
  };

  const getSupportedMimeType = (): string => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const mime of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return '';
  };

  const createAndStartRecorder = (stream: MediaStream, mimeType: string) => {
    const options: MediaRecorderOptions = {
      audioBitsPerSecond: 32000,
    };
    if (mimeType) {
      options.mimeType = mimeType;
    }

    const recorder = new MediaRecorder(stream, options);
    const localBlobParts: BlobPart[] = [];
    const thisChunkStartSec = elapsedSecondsRef.current;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        localBlobParts.push(event.data);
      }
    };

    recorder.onstop = () => {
      if (localBlobParts.length > 0) {
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(localBlobParts, { type: finalMime });
        const durationSec = Math.max(1, elapsedSecondsRef.current - thisChunkStartSec);
        const idx = chunkCounterRef.current;
        chunkCounterRef.current += 1;

        const newChunk: AudioChunkItem = {
          id: `chunk-${Date.now()}-${idx}`,
          index: idx,
          blob,
          mimeType: finalMime,
          sizeBytes: blob.size,
          durationSec,
          timestampLabel: `${formatDurationHMS(thisChunkStartSec)} – ${formatDurationHMS(
            elapsedSecondsRef.current
          )}`,
          status: 'ready',
          screenFrames: [...capturedFramesRef.current],
        };
        onAddChunk(newChunk);

        if (autoProcessOnStopRef.current) {
          autoProcessOnStopRef.current = false;
          setTimeout(() => {
            onProcessWithAI([...chunks, newChunk]);
          }, 250);
        }
      }
    };

    recorder.start(1000);
    mediaRecorderRef.current = recorder;
    chunkStartElapsedRef.current = elapsedSecondsRef.current;
  };

  const rotateChunk = () => {
    const currentRecorder = mediaRecorderRef.current;
    const dest = mixedDestinationRef.current;
    if (!currentRecorder || !dest || currentRecorder.state === 'inactive') return;

    captureFrameFromDisplayTrack();
    const mimeType = currentRecorder.mimeType || getSupportedMimeType();
    currentRecorder.stop();
    setCurrentChunkNumber((prev) => prev + 1);
    createAndStartRecorder(dest.stream, mimeType);
  };

  const handleStartRecording = async () => {
    setRecorderError(null);
    setRecorderWarning(null);
    autoProcessOnStopRef.current = false;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      await audioCtx.resume();
      audioContextRef.current = audioCtx;

      const destination = audioCtx.createMediaStreamDestination();
      mixedDestinationRef.current = destination;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.78;
      analyserRef.current = analyser;

      const streamsToCleanup: MediaStream[] = [];
      let hasSysAudio = false;
      let hasMicAudio = false;
      let hasDisplayVideo = false;

      if (captureMode === 'dual') {
        try {
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            } as MediaTrackConstraints,
          });
          streamsToCleanup.push(displayStream);

          const sysAudioTracks = displayStream.getAudioTracks();
          if (sysAudioTracks.length === 0) {
            setRecorderWarning(
              'Peringatan: Audio sistem Zoom tidak terdeteksi. Pastikan mencentang "Share system audio" / "Bagikan audio tab" saat memilih layar.'
            );
          } else {
            const sysSource = audioCtx.createMediaStreamSource(
              new MediaStream([sysAudioTracks[0]])
            );
            const sysGain = audioCtx.createGain();
            sysGain.gain.value = 1.0;
            sysSource.connect(sysGain);
            sysGain.connect(destination);
            sysGain.connect(analyser);
            hasSysAudio = true;

            sysAudioTracks[0].onended = () => {
              setSystemAudioActive(false);
            };
          }

          // Capture initial frame then manage video track cleanly
          const videoTracks = displayStream.getVideoTracks();
          if (videoTracks.length > 0 && displayVideoRef.current) {
            const videoTrack = videoTracks[0];
            displayVideoTrackRef.current = videoTrack;

            const videoEl = displayVideoRef.current;
            videoEl.srcObject = new MediaStream([videoTrack]);
            hasDisplayVideo = true;

            videoEl.onloadeddata = () => {
              captureFrameFromDisplayTrack();
            };
            await videoEl.play().catch(() => {});

            videoTrack.onended = () => {
              displayVideoTrackRef.current = null;
              setScreenVideoActive(false);
            };
          }
        } catch {
          setRecorderWarning(
            'Berbagi layar Zoom dilewati; melanjutkan perekaman menggunakan Mikrofon.'
          );
        }
      }

      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamsToCleanup.push(micStream);

        if (micStream.getAudioTracks().length > 0) {
          const micSource = audioCtx.createMediaStreamSource(micStream);
          const micGain = audioCtx.createGain();
          micGain.gain.value = 1.0;
          micSource.connect(micGain);
          micGain.connect(destination);
          micGain.connect(analyser);
          hasMicAudio = true;
        }
      } catch {
        if (!hasSysAudio) {
          throw new Error(
            'Gagal mengakses Audio Sistem maupun Mikrofon. Izinkan akses mikrofon pada browser.'
          );
        }
      }

      if (!hasSysAudio && !hasMicAudio) {
        cleanupAudioResources();
        setRecorderError('Tidak ada sumber audio aktif yang terdeteksi.');
        return;
      }

      activeStreamsRef.current = streamsToCleanup;
      setSystemAudioActive(hasSysAudio);
      setScreenVideoActive(hasDisplayVideo);
      setMicAudioActive(hasMicAudio);

      elapsedSecondsRef.current = 0;
      chunkCounterRef.current = chunks.length;
      setElapsedSeconds(0);
      setCurrentChunkNumber(chunks.length + 1);

      const mimeType = getSupportedMimeType();
      createAndStartRecorder(destination.stream, mimeType);

      setIsRecording(true);
      setIsPaused(false);

      clockIntervalRef.current = window.setInterval(() => {
        elapsedSecondsRef.current += 1;
        setElapsedSeconds(elapsedSecondsRef.current);
      }, 1000);

      chunkTimerRef.current = window.setInterval(() => {
        rotateChunk();
      }, CHUNK_DURATION_MS);
    } catch (err: any) {
      cleanupAudioResources();
      setRecorderError(
        err?.message || 'Gagal memulai perekaman. Periksa izin perangkat audio Anda.'
      );
    }
  };

  const handlePauseResume = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    if (recorder.state === 'recording') {
      recorder.pause();
      setIsPaused(true);
      if (clockIntervalRef.current) {
        window.clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setIsPaused(false);
      clockIntervalRef.current = window.setInterval(() => {
        elapsedSecondsRef.current += 1;
        setElapsedSeconds(elapsedSecondsRef.current);
      }, 1000);
    }
  };

  const handleStopAndAutoProcess = () => {
    if (displayVideoTrackRef.current?.readyState === 'live') {
      captureFrameFromDisplayTrack();
    }
    autoProcessOnStopRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
    cleanupAudioResources();
  };

  const handleFileUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setRecorderError(null);
    setRecorderWarning(null);

    const allowedAudioExts = ['.mp3', '.wav', '.webm', '.m4a', '.ogg', '.mp4', '.aac'];
    let nextIdx = chunks.length;
    const newlyUploaded: AudioChunkItem[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            onAddScreenFrame(reader.result);
          }
        };
        reader.readAsDataURL(file);
        continue;
      }

      if (!file.type.startsWith('audio/') && !allowedAudioExts.includes(ext)) {
        setRecorderError(`Format "${file.name}" tidak didukung.`);
        continue;
      }

      const inferredMime =
        file.type ||
        (ext === '.mp3'
          ? 'audio/mpeg'
          : ext === '.wav'
          ? 'audio/wav'
          : ext === '.m4a'
          ? 'audio/mp4'
          : ext === '.ogg'
          ? 'audio/ogg'
          : 'audio/webm');

      if (file.size > MAX_UPLOAD_CHUNK_BYTES) {
        const totalParts = Math.ceil(file.size / MAX_UPLOAD_CHUNK_BYTES);
        for (let p = 0; p < totalParts; p++) {
          const startByte = p * MAX_UPLOAD_CHUNK_BYTES;
          const endByte = Math.min(file.size, (p + 1) * MAX_UPLOAD_CHUNK_BYTES);
          const slicedBlob = file.slice(startByte, endByte, inferredMime);
          const estimatedSec = Math.max(30, Math.round((slicedBlob.size / 4000) * 0.25));

          const chunkObj: AudioChunkItem = {
            id: `upload-${Date.now()}-${nextIdx}`,
            index: nextIdx,
            blob: slicedBlob,
            mimeType: inferredMime,
            sizeBytes: slicedBlob.size,
            durationSec: estimatedSec,
            timestampLabel: `${file.name} (${p + 1}/${totalParts})`,
            status: 'ready',
            screenFrames: [...capturedFramesRef.current],
          };
          onAddChunk(chunkObj);
          newlyUploaded.push(chunkObj);
          nextIdx += 1;
        }
      } else {
        const estimatedSec = Math.max(15, Math.round(file.size / 16000));
        const chunkObj: AudioChunkItem = {
          id: `upload-${Date.now()}-${nextIdx}`,
          index: nextIdx,
          blob: file,
          mimeType: inferredMime,
          sizeBytes: file.size,
          durationSec: estimatedSec,
          timestampLabel: file.name,
          status: 'ready',
          screenFrames: [...capturedFramesRef.current],
        };
        onAddChunk(chunkObj);
        newlyUploaded.push(chunkObj);
        nextIdx += 1;
      }
    }

    if (newlyUploaded.length > 0) {
      setTimeout(() => {
        onProcessWithAI([...chunks, ...newlyUploaded]);
      }, 200);
    }
  };

  return (
    <div className="space-y-1">
      {/* Section Header: ANALYZER & CONTROLS + Dual-Stream Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-1 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
            ANALYZER &amp; CONTROLS
          </span>
          {isRecording && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              {systemAudioActive ? 'SYS+MIC' : micAudioActive ? 'MIC AKTIF' : 'AUDIO'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isRecording}
            onClick={() => setCaptureMode('dual')}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
              captureMode === 'dual'
                ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/60'
                : 'bg-[#111827] text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
            title="Zoom / System Audio + Microphone Dual-Stream Mixer"
          >
            <MonitorSpeaker className="w-2.5 h-2.5" />
            Zoom + Mic
          </button>

          <button
            type="button"
            disabled={isRecording}
            onClick={() => setCaptureMode('mic')}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
              captureMode === 'mic'
                ? 'bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/60'
                : 'bg-[#111827] text-slate-400 border border-slate-800 hover:text-slate-200'
            }`}
            title="Microphone Only (Ruang Rapat / Tatap Muka)"
          >
            <Mic className="w-2.5 h-2.5" />
            Mic Only
          </button>

          <button
            type="button"
            disabled={isRecording}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#111827] text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
            title="Unggah File Audio (.mp3, .wav, .webm, .m4a, .ogg)"
          >
            <Upload className="w-2.5 h-2.5 text-[#F59E0B]" />
            Upload Audio
          </button>
        </div>
      </div>

      {/* Tactical HUD Waveform Console */}
      <div className="relative bg-[#111827] border border-[#1E293B] rounded-xl px-3 py-2.5 select-none shadow-inner">
        <video ref={displayVideoRef} className="hidden" muted playsInline />
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,.webm,.m4a,.ogg,audio/*"
          multiple
          onChange={(e) => handleFileUpload(e.target.files)}
          className="hidden"
        />

        {/* 4 Tactical Amber HUD Corner Brackets */}
        <div className="pointer-events-none absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-[#F59E0B]/85 rounded-tl-sm" />
        <div className="pointer-events-none absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-[#F59E0B]/85 rounded-tr-sm" />
        <div className="pointer-events-none absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-[#F59E0B]/85 rounded-bl-sm" />
        <div className="pointer-events-none absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-[#F59E0B]/85 rounded-br-sm" />

        {/* Top Center Status & Timer */}
        <div className="text-center leading-tight">
          <div className="inline-flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-bold tracking-wider text-red-500">
            <span
              className={`w-2 h-2 rounded-full bg-red-500 ${
                isRecording && !isPaused ? 'animate-ping' : ''
              }`}
            />
            <span>
              {isProcessingAI
                ? processingStatusText || 'MEMPROSES SINTESIS AI...'
                : isRecording
                ? isPaused
                  ? 'PAUSED RECORDING'
                  : 'LIVE RECORDING'
                : 'LIVE RECORDING'}
            </span>
          </div>

          <div className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-200">
            {formatDurationHMS(elapsedSeconds)} (Chunk {currentChunkNumber})
          </div>
        </div>

        {/* Central Tactical Waveform + Red Circular Record Button */}
        <div className="flex items-center justify-between gap-2 my-1.5 px-1">
          <canvas
            ref={leftCanvasRef}
            width={160}
            height={48}
            className="flex-1 h-11 sm:h-12 min-w-0"
          />

          <button
            type="button"
            disabled={isProcessingAI}
            onClick={isRecording ? handleStopAndAutoProcess : handleStartRecording}
            className="group relative shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-slate-900 border-2 border-red-500/80 p-1 shadow-[0_0_20px_rgba(239,68,68,0.35)] active:scale-95 transition-transform cursor-pointer disabled:opacity-50 flex items-center justify-center"
            title={
              isRecording
                ? 'Hentikan & Sintesis Laporan Otomatis'
                : 'Mulai Rekam Rapat (32kbps Opus • Auto-Chunk 10m)'
            }
          >
            <span
              className={`w-full h-full rounded-full bg-gradient-to-b from-red-500 to-red-600 flex items-center justify-center transition-all ${
                isRecording ? 'scale-90' : 'group-hover:brightness-110'
              }`}
            >
              {isProcessingAI ? (
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              ) : isRecording ? (
                <Square className="w-4 h-4 text-white fill-current" />
              ) : null}
            </span>
          </button>

          <canvas
            ref={rightCanvasRef}
            width={160}
            height={48}
            className="flex-1 h-11 sm:h-12 min-w-0"
          />
        </div>

        {/* Bottom Tactical Button: JEDA / REKAM */}
        <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
          <button
            type="button"
            disabled={isProcessingAI}
            onClick={isRecording ? handlePauseResume : handleStartRecording}
            className="inline-flex items-center justify-center gap-1.5 min-h-[30px] px-3.5 py-1 rounded-md bg-[#1E293B] hover:bg-slate-700 border border-slate-600/80 text-[11px] font-bold tracking-wider text-slate-100 shadow-inner transition-colors cursor-pointer disabled:opacity-50"
          >
            {isRecording ? (
              isPaused ? (
                <>
                  <Play className="w-3 h-3 text-[#10B981] fill-current" />
                  <span>LANJUTKAN REKAM</span>
                </>
              ) : (
                <>
                  <Pause className="w-3 h-3 text-[#F59E0B] fill-current" />
                  <span>JEDA / REKAM</span>
                </>
              )
            ) : (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                <span>JEDA / REKAM</span>
              </>
            )}
          </button>

          {isRecording && screenVideoActive && (
            <button
              type="button"
              onClick={() => captureFrameFromDisplayTrack()}
              className="inline-flex items-center gap-1 min-h-[30px] px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] font-semibold text-[#38BDF8] cursor-pointer"
              title="Ambil Screenshot Layar Zoom Sekarang"
            >
              <Camera className="w-3 h-3" />
              <span>SNAP LAYAR</span>
            </button>
          )}

          {chunks.length > 0 && !isRecording && (
            <button
              type="button"
              disabled={isProcessingAI}
              onClick={() => onProcessWithAI()}
              className="inline-flex items-center gap-1 min-h-[30px] px-3 py-1 rounded-md bg-[#38BDF8]/20 hover:bg-[#38BDF8]/30 border border-[#38BDF8]/60 text-[11px] font-bold text-[#38BDF8] cursor-pointer disabled:opacity-50"
            >
              {isProcessingAI ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>SINTESIS AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  <span>SINTESIS AI ({chunks.length} CHUNK)</span>
                </>
              )}
            </button>
          )}

          {chunks.length > 0 && !isRecording && !isProcessingAI && (
            <button
              type="button"
              onClick={onClearChunks}
              className="inline-flex items-center justify-center min-h-[30px] px-2 py-1 rounded-md bg-slate-900 hover:bg-red-950/60 border border-slate-700 text-slate-400 hover:text-red-300 text-[10px] cursor-pointer"
              title="Hapus rekaman audio"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {(recorderWarning || recorderError) && (
          <div className="mt-2 flex items-start gap-1.5 bg-amber-950/60 border border-amber-700/70 rounded px-2 py-1 text-[10px] text-amber-200">
            <AlertTriangle className="w-3 h-3 text-[#F59E0B] shrink-0 mt-0.5" />
            <span>{recorderError || recorderWarning}</span>
          </div>
        )}
      </div>
    </div>
  );
};
