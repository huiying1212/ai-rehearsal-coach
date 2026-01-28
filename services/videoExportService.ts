import { ScriptSegment, SegmentStatus, GestureType } from '../types';
import { base64ToDataUrl } from './geminiService';

interface ExportProgress {
  stage: 'preparing' | 'loading' | 'rendering' | 'encoding' | 'complete';
  progress: number; // 0-100
  currentSegment?: number;
  totalSegments?: number;
}

type ProgressCallback = (progress: ExportProgress) => void;

/**
 * 段落媒体数据结构
 */
interface SegmentMedia {
  segment: ScriptSegment;
  ttsAudio: HTMLAudioElement;
  ttsDuration: number;
  // 视频相关（仅对有视频的段落）
  video?: HTMLVideoElement;
  videoDuration?: number;
  hasVideo: boolean;
}

/**
 * Export the final composed video with mixed audio.
 * 使用 MediaRecorder 实时录制，这是最可靠的方案。
 * 
 * 合成逻辑：
 * 1. TTS音频作为"绝对时间轴主尺"
 * 2. 无手势段落：使用静态角色图片
 * 3. 有视频段落：播放视频并用视频音频替换TTS音频
 */
export async function exportComposedVideo(
  segments: ScriptSegment[],
  characterImageBase64: string,
  onProgress?: ProgressCallback
): Promise<void> {
  // 过滤有音频的段落
  const readySegments = segments.filter(
    s => s.audioStatus === SegmentStatus.COMPLETED && s.audioUrl
  );

  if (readySegments.length === 0) {
    throw new Error('No segments with completed audio available for export');
  }

  onProgress?.({ stage: 'preparing', progress: 0 });

  // 创建渲染画布 (720p, 9:16)
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d')!;

  // 加载角色静态图片
  const characterImage = new Image();
  characterImage.src = base64ToDataUrl(characterImageBase64);
  await new Promise<void>((resolve, reject) => {
    characterImage.onload = () => resolve();
    characterImage.onerror = () => reject(new Error('Failed to load character image'));
  });

  onProgress?.({ stage: 'loading', progress: 5 });

  // 加载所有段落的媒体
  const mediaData: SegmentMedia[] = [];

  for (let i = 0; i < readySegments.length; i++) {
    const segment = readySegments[i];
    
    onProgress?.({ 
      stage: 'loading', 
      progress: 5 + (i / readySegments.length) * 20,
      currentSegment: i + 1,
      totalSegments: readySegments.length
    });

    // 加载TTS音频
    const ttsAudio = document.createElement('audio');
    await new Promise<void>((resolve, reject) => {
      ttsAudio.onloadedmetadata = () => resolve();
      ttsAudio.onerror = () => reject(new Error(`Failed to load TTS audio for segment ${i + 1}`));
      ttsAudio.src = segment.audioUrl!;
    });

    const ttsDuration = ttsAudio.duration;
    const hasVideo = segment.gestureType !== GestureType.NONE && 
                     segment.videoStatus === SegmentStatus.COMPLETED && 
                     !!segment.videoUrl;

    let video: HTMLVideoElement | undefined;
    let videoDuration: number | undefined;

    // 如果有视频，加载视频
    if (hasVideo && segment.videoUrl) {
      video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = false; // 需要获取视频音频
      video.playsInline = true;
      
      await new Promise<void>((resolve, reject) => {
        video!.onloadedmetadata = () => resolve();
        video!.onerror = () => reject(new Error(`Failed to load video for segment ${i + 1}`));
        video!.src = segment.videoUrl!;
      });

      videoDuration = video.duration;
    }

    mediaData.push({
      segment,
      ttsAudio,
      ttsDuration,
      video,
      videoDuration,
      hasVideo
    });
  }

  onProgress?.({ stage: 'rendering', progress: 25 });

  // 设置MediaRecorder和音频上下文
  // 使用固定帧率的 captureStream，交给浏览器根据实际刷新率采样，更容易和媒体播放对齐
  const stream = canvas.captureStream(30); // 30 FPS
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();
  
  // 将音频轨道添加到视频流
  const audioTrack = audioDestination.stream.getAudioTracks()[0];
  if (audioTrack) {
    stream.addTrack(audioTrack);
  }

  // 获取支持的 MIME 类型
  const mimeType = getSupportedMimeType();
  console.log(`[Export] Using MIME type: ${mimeType}`);
  
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8000000, // 8 Mbps
  });

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // 开始录制
  mediaRecorder.start(100);

  // 逐段渲染
  for (let i = 0; i < mediaData.length; i++) {
    const { ttsAudio, ttsDuration, video, videoDuration, hasVideo } = mediaData[i];
    
    onProgress?.({
      stage: 'rendering',
      progress: 25 + ((i / mediaData.length) * 60),
      currentSegment: i + 1,
      totalSegments: mediaData.length
    });

    // 确定使用哪个音频源
    let audioSource: MediaElementAudioSourceNode;
    let useVideoAudio = false;

    if (hasVideo && video) {
      // 有视频时，使用视频的音频（更匹配手势）
      video.muted = false;
      audioSource = audioContext.createMediaElementSource(video);
      useVideoAudio = true;
    } else {
      // 无视频时使用TTS音频
      audioSource = audioContext.createMediaElementSource(ttsAudio);
    }

    // 连接音频到输出
    audioSource.connect(audioDestination);
    audioSource.connect(audioContext.destination); // 同时本地播放用于同步

    // 开始播放
    if (useVideoAudio && video) {
      video.currentTime = 0;
      ttsAudio.muted = true;
      ttsAudio.currentTime = 0;
      await Promise.all([
        video.play(),
        ttsAudio.play()
      ]);
    } else {
      ttsAudio.currentTime = 0;
      await ttsAudio.play();
    }

    // 渲染帧 - 按音/视频的实际播放进度来判断结束时间，保证画面和声音对齐
    const actualVideoDuration = videoDuration || 0;
    const segmentDuration = Math.max(ttsDuration, actualVideoDuration);
    
    console.log(
      `[Export] Segment ${i + 1}: TTS=${ttsDuration.toFixed(2)}s, ` +
      `Video=${actualVideoDuration.toFixed(2)}s, Using=${segmentDuration.toFixed(2)}s`
    );

    await new Promise<void>((resolve) => {
      const renderFrame = () => {
        // 清空画布
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (hasVideo && video && !video.ended) {
          // 绘制视频帧
          drawVideoFrame(ctx, video, canvas.width, canvas.height);
        } else {
          // 视频已结束或无视频，绘制静态角色图片
          drawImage(ctx, characterImage, canvas.width, canvas.height);
        }

        // 根据媒体元素的实际播放进度来判断是否结束
        const ttsDone =
          ttsAudio.ended ||
          ttsAudio.currentTime >= Math.max(0, ttsDuration - 0.05); // 留一点点余量，避免浮点误差

        const videoDone =
          !hasVideo ||
          !video ||
          video.ended ||
          video.currentTime >= Math.max(0, actualVideoDuration - 0.05);

        if (ttsDone && videoDone) {
          // 段落完成
          if (video) {
            video.pause();
            video.muted = true;
          }
          ttsAudio.pause();
          ttsAudio.muted = false;
          audioSource.disconnect();
          resolve();
        } else {
          // 继续下一帧，和屏幕刷新同步，时间轴由音/视频元素自己控制
          requestAnimationFrame(renderFrame);
        }
      };
      
      renderFrame();
    });
  }

  onProgress?.({ stage: 'encoding', progress: 85 });

  // 停止录制并获取 blob
  const videoBlob = await new Promise<Blob>((resolve) => {
    mediaRecorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
    mediaRecorder.stop();
  });

  // 清理音频上下文
  await audioContext.close();

  // 确定文件扩展名
  const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
  console.log(`[Export] Video created: ${(videoBlob.size / 1024 / 1024).toFixed(2)} MB (${extension})`);

  onProgress?.({ stage: 'complete', progress: 100 });

  // 触发下载
  const url = URL.createObjectURL(videoBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rehearsal-composed-${Date.now()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 在画布上绘制视频帧
 */
function drawVideoFrame(
  ctx: CanvasRenderingContext2D, 
  video: HTMLVideoElement, 
  canvasWidth: number, 
  canvasHeight: number
) {
  const videoAspect = video.videoWidth / video.videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  
  let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
  
  if (videoAspect > canvasAspect) {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / videoAspect;
    drawX = 0;
    drawY = (canvasHeight - drawHeight) / 2;
  } else {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * videoAspect;
    drawX = (canvasWidth - drawWidth) / 2;
    drawY = 0;
  }
  
  ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

/**
 * 在画布上绘制图片
 */
function drawImage(
  ctx: CanvasRenderingContext2D, 
  image: HTMLImageElement, 
  canvasWidth: number, 
  canvasHeight: number
) {
  const imgAspect = image.width / image.height;
  const canvasAspect = canvasWidth / canvasHeight;
  
  let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
  
  if (imgAspect > canvasAspect) {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / imgAspect;
    drawX = 0;
    drawY = (canvasHeight - drawHeight) / 2;
  } else {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * imgAspect;
    drawX = (canvasWidth - drawWidth) / 2;
    drawY = 0;
  }
  
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

/**
 * 获取浏览器支持的 MIME 类型
 * 优先使用 MP4（如果支持），否则使用 WebM
 */
function getSupportedMimeType(): string {
  // 尝试 MP4 格式（Safari 和部分 Chrome 支持）
  const mp4Types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
  ];
  
  for (const type of mp4Types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  // WebM 格式（Chrome, Firefox, Edge 支持）
  const webmTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
  ];
  
  for (const type of webmTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return 'video/webm'; // Fallback
}

/**
 * 检查是否可以导出视频
 * 只需要有音频完成的段落即可导出
 */
export function canExportVideo(segments: ScriptSegment[]): boolean {
  return segments.some(
    s => s.audioStatus === SegmentStatus.COMPLETED && s.audioUrl
  );
}

// 保留旧的导出函数名作为别名，以保持向后兼容
export const exportVideo = exportComposedVideo;
