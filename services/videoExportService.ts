import { ScriptSegment, SegmentStatus, SlideDesign } from '../types';

interface ExportProgress {
  stage: 'preparing' | 'loading' | 'rendering' | 'encoding' | 'complete';
  progress: number; // 0-100
  currentSegment?: number;
  totalSegments?: number;
}

type ProgressCallback = (progress: ExportProgress) => void;

// Canvas dimensions - 16:9 for presentation style
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

// Video overlay dimensions and position (bottom-right)
const VIDEO_WIDTH = 300;
const VIDEO_HEIGHT = 533; // 9:16 aspect ratio
const VIDEO_MARGIN = 30;

/**
 * Render a slide design to canvas
 */
function renderSlideToCanvas(
  ctx: CanvasRenderingContext2D,
  slide: SlideDesign,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  // Background gradient
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, '#f8fafc');
  gradient.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  // Title
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 48px Inter, Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(slide.title, x + width / 2, y + 80, width - 60);

  const contentY = y + 140;
  const contentHeight = height - 180;

  switch (slide.type) {
    case 'list':
      renderListSlide(ctx, slide.items || [], x, contentY, width, contentHeight);
      break;
    case 'text':
    default:
      renderTextSlide(ctx, slide.content || '', x, contentY, width, contentHeight);
      break;
  }
}

function renderTextSlide(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  // Text background card
  const cardPadding = 40;
  const cardX = x + cardPadding;
  const cardY = y + 40;
  const cardWidth = width - cardPadding * 2;
  const cardHeight = height - 80;

  // Draw card
  ctx.fillStyle = 'white';
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 16);
  ctx.fill();

  // Add shadow effect
  ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Text content
  ctx.fillStyle = '#334155';
  ctx.font = '32px Inter, Segoe UI, system-ui, sans-serif';
  ctx.textAlign = 'center';
  
  // Word wrap
  const lines = wrapText(ctx, content, cardWidth - 80);
  const lineHeight = 48;
  const startY = cardY + (cardHeight - lines.length * lineHeight) / 2 + lineHeight / 2;
  
  lines.forEach((line, i) => {
    ctx.fillText(line, x + width / 2, startY + i * lineHeight);
  });
}

function renderListSlide(
  ctx: CanvasRenderingContext2D,
  items: string[],
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const itemHeight = 70;
  const padding = 40;
  const startY = y + 20;

  items.slice(0, 6).forEach((item, index) => {
    const itemY = startY + index * (itemHeight + 12);
    
    // Item background
    ctx.fillStyle = 'white';
    roundRect(ctx, x + padding, itemY, width - padding * 2, itemHeight, 8);
    ctx.fill();
    
    // Left border accent
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(x + padding, itemY, 4, itemHeight);

    // Number circle
    ctx.fillStyle = '#6366f1';
    ctx.beginPath();
    ctx.arc(x + padding + 40, itemY + itemHeight / 2, 18, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px Inter, Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x + padding + 40, itemY + itemHeight / 2);

    // Item text
    ctx.fillStyle = '#334155';
    ctx.font = '24px Inter, Segoe UI, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(item, x + padding + 80, itemY + itemHeight / 2, width - padding * 2 - 100);
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  words.forEach(word => {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  });
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  return lines;
}

/**
 * Export the final composed video with slides and video overlay.
 * Layout: Slides take main area, video appears in bottom-right corner.
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

  // Create a canvas for rendering (16:9 for presentation)
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Load all video and audio elements
  onProgress?.({ stage: 'loading', progress: 5 });
  
  const mediaData: Array<{
    video: HTMLVideoElement;
    audio: HTMLAudioElement;
    duration: number;
    slide: SlideDesign;
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
    
    mediaData.push({ video, audio, duration, slide: segment.slideDesign });
  }

  onProgress?.({ stage: 'rendering', progress: 25 });

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
    videoBitsPerSecond: 8000000, // 8 Mbps for higher quality
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
  for (let i = 0; i < mediaData.length; i++) {
    const { video, audio, duration, slide } = mediaData[i];
    
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
          // Clear canvas with dark background
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          
          // Calculate slide area (main area, leaving space for video)
          const slideMargin = 30;
          const slideWidth = CANVAS_WIDTH - VIDEO_WIDTH - VIDEO_MARGIN * 3;
          const slideHeight = CANVAS_HEIGHT - slideMargin * 2;
          
          // Render slide to main area
          renderSlideToCanvas(ctx, slide, slideMargin, slideMargin, slideWidth, slideHeight);
          
          // Draw video overlay in bottom-right corner
          const videoX = CANVAS_WIDTH - VIDEO_WIDTH - VIDEO_MARGIN;
          const videoY = CANVAS_HEIGHT - VIDEO_HEIGHT - VIDEO_MARGIN;
          
          // Video background/border
          ctx.fillStyle = '#1e293b';
          roundRect(ctx, videoX - 4, videoY - 4, VIDEO_WIDTH + 8, VIDEO_HEIGHT + 8, 16);
          ctx.fill();
          
          // Draw video frame
          ctx.save();
          roundRect(ctx, videoX, videoY, VIDEO_WIDTH, VIDEO_HEIGHT, 12);
          ctx.clip();
          
          // Calculate scaling to fit video while maintaining aspect ratio
          const videoAspect = video.videoWidth / video.videoHeight;
          const targetAspect = VIDEO_WIDTH / VIDEO_HEIGHT;
          
          let drawWidth, drawHeight, drawX, drawY;
          
          if (videoAspect > targetAspect) {
            // Video is wider - fit by height, crop width
            drawHeight = VIDEO_HEIGHT;
            drawWidth = VIDEO_HEIGHT * videoAspect;
            drawX = videoX - (drawWidth - VIDEO_WIDTH) / 2;
            drawY = videoY;
          } else {
            // Video is taller - fit by width, crop height
            drawWidth = VIDEO_WIDTH;
            drawHeight = VIDEO_WIDTH / videoAspect;
            drawX = videoX;
            drawY = videoY - (drawHeight - VIDEO_HEIGHT) / 2;
          }
          
          ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
          ctx.restore();
          
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
  a.download = `rehearsal-presentation-${Date.now()}.${fileExtension}`;
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
