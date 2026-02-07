// Decodes base64 string to byte array
export function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Decodes raw PCM data into an AudioBuffer
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Builds WAV ArrayBuffer from AudioBuffer (shared for Blob and Blob URL)
function audioBufferToWavArrayBuffer(buffer: AudioBuffer): ArrayBuffer {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArray = new ArrayBuffer(length);
  const view = new DataView(bufferArray);
  const channels: Float32Array[] = [];
  let i: number;
  let sample: number;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }
  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16);
  setUint16(1); // PCM
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16); // 16-bit
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }
  return bufferArray;
}

/** Returns a WAV Blob (for upload to RVC etc.) */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  return new Blob([audioBufferToWavArrayBuffer(buffer)], { type: 'audio/wav' });
}

// Converts an AudioBuffer to a WAV Blob URL for easy playback in <audio> elements
export function audioBufferToWavBlobUrl(buffer: AudioBuffer): string {
  const blob = new Blob([audioBufferToWavArrayBuffer(buffer)], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Extract audio track from a video element as a WAV Blob.
 *
 * Strategy:
 * 1. Fast path – fetch the video as ArrayBuffer and decode the audio directly (near-instant).
 * 2. Slow path – clone the video element, play it through Web Audio MediaRecorder in real-time.
 *
 * IMPORTANT: We never call createMediaElementSource on the *original* video element,
 * because that permanently reroutes the element's audio output through the Web Audio API
 * and would break subsequent normal playback / recording during the export rendering phase.
 */
export async function extractAudioBlobFromVideo(video: HTMLVideoElement): Promise<Blob> {
  // --- Fast path: fetch + decodeAudioData (works if CORS allows fetching the src) ---
  try {
    const response = await fetch(video.src);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try {
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      return audioBufferToWavBlob(audioBuffer);
    } finally {
      await ctx.close();
    }
  } catch (e) {
    console.warn('[extractAudioBlobFromVideo] Fast extraction failed, falling back to real-time recording:', e);
  }

  // --- Slow path: clone the video element and record via MediaRecorder ---
  const clonedVideo = document.createElement('video');
  clonedVideo.crossOrigin = 'anonymous';
  clonedVideo.playsInline = true;
  clonedVideo.src = video.src;

  await new Promise<void>((resolve, reject) => {
    clonedVideo.onloadedmetadata = () => resolve();
    clonedVideo.onerror = () => reject(new Error('Failed to load cloned video for audio extraction'));
  });

  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const source = ctx.createMediaElementSource(clonedVideo);
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);

  const recorder = new MediaRecorder(dest.stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const ended = new Promise<void>((resolve) => { clonedVideo.onended = () => resolve(); });
  clonedVideo.currentTime = 0;
  recorder.start(100);
  clonedVideo.play().catch(() => {});

  await ended;
  recorder.stop();
  await new Promise<void>((r) => { recorder.onstop = () => r(); });

  // Clean up cloned element and audio context
  source.disconnect();
  clonedVideo.src = '';

  const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();
  return audioBufferToWavBlob(audioBuffer);
}