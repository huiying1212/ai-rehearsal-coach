import { ScriptSegment, SegmentStatus } from '../types';

interface ExportProgress {
  stage: 'preparing' | 'loading' | 'rendering' | 'encoding' | 'complete';
  progress: number; // 0-100
  currentSegment?: number;
  totalSegments?: number;
}

type ProgressCallback = (progress: ExportProgress) => void;

/**
 * Export the final composed video with audio to a local file.
 * The exported video contains only the video and audio - no subtitles or text overlays.
 */
export async function exportVideo(
  segments: ScriptSegment[],
  onProgress?: ProgressCallback
): Promise<void> {
  // Filter only segments with completed video and audio
  const readySegments = segments.filter(
    s => s.videoStatus === SegmentStatus.COMPLETED && 
         s.audioStatus === SegmentStatus.COMPLETED &&
         s.videoUrl && 
         s.audioUrl
  );

  if (readySegments.length === 0) {
    throw new Error('No segments with completed video and audio available for export');
  }

  onProgress?.({ stage: 'preparing', progress: 0 });

  // Create a canvas for rendering
  const canvas = document.createElement('canvas');
  // Use 720p resolution with 9:16 aspect ratio (matching Veo output)
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d')!;

  // Load all video and audio elements
  onProgress?.({ stage: 'loading', progress: 5 });
  
  const mediaData: Array<{
    video: HTMLVideoElement;
    audio: HTMLAudioElement;
    duration: number;
  }> = [];

  for (let i = 0; i < readySegments.length; i++) {
    const segment = readySegments[i];
    
    onProgress?.({ 
      stage: 'loading', 
      progress: 5 + (i / readySegments.length) * 20,
      currentSegment: i + 1,
      totalSegments: readySegments.length
    });

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    
    const audio = document.createElement('audio');
    
    // Load video
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error(`Failed to load video for segment ${i + 1}`));
      video.src = segment.videoUrl!;
    });

    // Load audio
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error(`Failed to load audio for segment ${i + 1}`));
      audio.src = segment.audioUrl!;
    });

    // Use audio duration as the segment duration (video may be longer/shorter)
    const duration = audio.duration;
    
    mediaData.push({ video, audio, duration });
  }

  onProgress?.({ stage: 'rendering', progress: 25 });

  // Calculate total duration
  const totalDuration = mediaData.reduce((sum, m) => sum + m.duration, 0);

  // Set up MediaRecorder with canvas stream
  const stream = canvas.captureStream(30); // 30 FPS
  
  // Create audio context for mixing audio tracks
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();
  
  // Add audio track to the stream
  const audioTrack = audioDestination.stream.getAudioTracks()[0];
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }

  // Determine supported MIME type
  const mimeType = getSupportedMimeType();
  
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 5000000, // 5 Mbps
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // Start recording
  mediaRecorder.start(100); // Collect data every 100ms

  // Render each segment sequentially
  let currentTime = 0;
  
  for (let i = 0; i < mediaData.length; i++) {
    const { video, audio, duration } = mediaData[i];
    
    onProgress?.({
      stage: 'rendering',
      progress: 25 + ((i / mediaData.length) * 60),
      currentSegment: i + 1,
      totalSegments: mediaData.length
    });

    // Connect audio to the destination
    const audioSource = audioContext.createMediaElementSource(audio);
    audioSource.connect(audioDestination);
    audioSource.connect(audioContext.destination); // Also play locally for sync

    // Start playing both video and audio
    video.currentTime = 0;
    audio.currentTime = 0;
    
    await Promise.all([
      video.play(),
      audio.play()
    ]);

    // Render frames for this segment's duration
    const startTime = performance.now();
    const segmentDurationMs = duration * 1000;

    await new Promise<void>((resolve) => {
      const renderFrame = () => {
        const elapsed = performance.now() - startTime;
        
        if (elapsed < segmentDurationMs && !audio.ended) {
          // Draw the current video frame to canvas (no text overlays)
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          // Calculate scaling to fit video in canvas while maintaining aspect ratio
          const videoAspect = video.videoWidth / video.videoHeight;
          const canvasAspect = canvas.width / canvas.height;
          
          let drawWidth, drawHeight, drawX, drawY;
          
          if (videoAspect > canvasAspect) {
            // Video is wider - fit by width
            drawWidth = canvas.width;
            drawHeight = canvas.width / videoAspect;
            drawX = 0;
            drawY = (canvas.height - drawHeight) / 2;
          } else {
            // Video is taller - fit by height
            drawHeight = canvas.height;
            drawWidth = canvas.height * videoAspect;
            drawX = (canvas.width - drawWidth) / 2;
            drawY = 0;
          }
          
          ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
          
          requestAnimationFrame(renderFrame);
        } else {
          // Segment complete
          video.pause();
          audio.pause();
          audioSource.disconnect();
          resolve();
        }
      };
      
      renderFrame();
    });

    currentTime += duration;
  }

  onProgress?.({ stage: 'encoding', progress: 90 });

  // Stop recording and get the final blob
  await new Promise<void>((resolve) => {
    mediaRecorder.onstop = () => resolve();
    mediaRecorder.stop();
  });

  // Clean up audio context
  await audioContext.close();

  // Create the final video blob
  const fileExtension = mimeType.includes('webm') ? 'webm' : 'mp4';
  const blob = new Blob(chunks, { type: mimeType });
  
  onProgress?.({ stage: 'complete', progress: 100 });

  // Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rehearsal-video-${Date.now()}.${fileExtension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get a supported MIME type for MediaRecorder
 */
function getSupportedMimeType(): string {
  const types = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return 'video/webm'; // Fallback
}

/**
 * Check if video export is available (has completed segments)
 */
export function canExportVideo(segments: ScriptSegment[]): boolean {
  return segments.some(
    s => s.videoStatus === SegmentStatus.COMPLETED && 
         s.audioStatus === SegmentStatus.COMPLETED &&
         s.videoUrl && 
         s.audioUrl
  );
}

