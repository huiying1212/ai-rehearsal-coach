import { ScriptSegment, SegmentStatus, GestureType } from '../types';
import { base64ToDataUrl } from './geminiService';
import { extractAudioBlobFromVideo } from './audioUtils';
import { convertAudioWithRvc, getRvcOptionsFromEnv, type RvcOptions } from './rvcService';

interface ExportProgress {
  stage: 'preparing' | 'loading' | 'rvc' | 'rendering' | 'encoding' | 'complete';
  progress: number; // 0-100
  currentSegment?: number;
  totalSegments?: number;
}

type ProgressCallback = (progress: ExportProgress) => void;

/**
 * 导出选项：可选 RVC 音色统一
 */
export interface ExportOptions {
  /** 启用 RVC 时传入；不传则使用环境变量 VITE_RVC_*；为 null 则禁用 */
  rvcOptions?: RvcOptions | null;
}

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
  /** RVC 统一音色后的音频（若已执行 RVC） */
  unifiedAudio?: HTMLAudioElement;
  unifiedDuration?: number;
  /** RVC 生成的 blob URL，导出结束后需 revoke */
  unifiedAudioUrl?: string;
}

/**
 * Export the final composed video with mixed audio.
 * 使用 MediaRecorder 实时录制，这是最可靠的方案。
 * 若提供 rvcOptions（或配置了 VITE_RVC_*），会在导出前用 RVC 统一各段音色。
 *
 * 合成逻辑：
 * 1. TTS音频作为"绝对时间轴主尺"
 * 2. 无手势段落：使用静态角色图片
 * 3. 有视频段落：播放视频并用视频音频替换TTS音频
 * 4. 若启用 RVC：各段音频（TTS 或视频音轨）先经 RVC 转为统一音色再参与合成
 */
export async function exportComposedVideo(
  segments: ScriptSegment[],
  characterImageBase64: string,
  onProgress?: ProgressCallback,
  options?: ExportOptions
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

  // 可选：RVC 统一音色（使用传入的 rvcOptions 或环境变量）
  const rvcOptions = options?.rvcOptions !== undefined ? options.rvcOptions : getRvcOptionsFromEnv();
  if (rvcOptions) {
    for (let i = 0; i < mediaData.length; i++) {
      const data = mediaData[i];
      onProgress?.({
        stage: 'rvc',
        progress: 25 + (i / mediaData.length) * 15,
        currentSegment: i + 1,
        totalSegments: mediaData.length
      });

      let sourceBlob: Blob;
      if (data.hasVideo && data.video) {
        sourceBlob = await extractAudioBlobFromVideo(data.video);
      } else {
        const res = await fetch(data.segment.audioUrl!);
        if (!res.ok) throw new Error(`Failed to fetch TTS audio for segment ${i + 1}`);
        sourceBlob = await res.blob();
      }

      const convertedBlob = await convertAudioWithRvc(sourceBlob, rvcOptions);
      const convertedUrl = URL.createObjectURL(convertedBlob);
      const unifiedAudio = document.createElement('audio');
      await new Promise<void>((resolve, reject) => {
        unifiedAudio.onloadedmetadata = () => resolve();
        unifiedAudio.onerror = () => reject(new Error(`Failed to load RVC audio for segment ${i + 1}`));
        unifiedAudio.src = convertedUrl;
      });
      data.unifiedAudio = unifiedAudio;
      data.unifiedDuration = unifiedAudio.duration;
      data.unifiedAudioUrl = convertedUrl;
    }
  }

  onProgress?.({ stage: 'rendering', progress: rvcOptions ? 40 : 25 });

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
    const { ttsAudio, ttsDuration, video, videoDuration, hasVideo, unifiedAudio, unifiedDuration } = mediaData[i];

    // 若已做 RVC 统一音色，则用统一后的音频；否则有视频用视频音轨，无视频用 TTS
    const effectiveAudio = unifiedAudio ?? (hasVideo && video ? undefined : ttsAudio);
    const effectiveDuration = unifiedDuration ?? ttsDuration;
    const useUnifiedAudio = !!unifiedAudio;

    onProgress?.({
      stage: 'rendering',
      progress: (rvcOptions ? 40 : 25) + (i / mediaData.length) * 45,
      currentSegment: i + 1,
      totalSegments: mediaData.length
    });

    let audioSource: MediaElementAudioSourceNode;
    if (useUnifiedAudio && unifiedAudio) {
      audioSource = audioContext.createMediaElementSource(unifiedAudio);
    } else if (hasVideo && video) {
      video.muted = false;
      audioSource = audioContext.createMediaElementSource(video);
    } else {
      audioSource = audioContext.createMediaElementSource(ttsAudio);
    }

    audioSource.connect(audioDestination);
    audioSource.connect(audioContext.destination);

    if (useUnifiedAudio && unifiedAudio) {
      unifiedAudio.currentTime = 0;
      await unifiedAudio.play();
      if (hasVideo && video) {
        video.muted = true;
        video.currentTime = 0;
        await video.play();
      }
    } else if (hasVideo && video) {
      video.currentTime = 0;
      ttsAudio.muted = true;
      ttsAudio.currentTime = 0;
      await Promise.all([video.play(), ttsAudio.play()]);
    } else {
      ttsAudio.currentTime = 0;
      await ttsAudio.play();
    }

    const actualVideoDuration = videoDuration || 0;
    const segmentDuration = Math.max(effectiveDuration, actualVideoDuration);

    console.log(
      `[Export] Segment ${i + 1}: Audio=${effectiveDuration.toFixed(2)}s, ` +
      `Video=${actualVideoDuration.toFixed(2)}s, Using=${segmentDuration.toFixed(2)}s` +
      (useUnifiedAudio ? ' (RVC)' : '')
    );

    await new Promise<void>((resolve) => {
      const renderFrame = () => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (hasVideo && video && !video.ended) {
          drawVideoFrame(ctx, video, canvas.width, canvas.height);
        } else {
          drawImage(ctx, characterImage, canvas.width, canvas.height);
        }

        const audioEl = useUnifiedAudio ? unifiedAudio! : ttsAudio;
        const audioDur = effectiveDuration;
        const audioDone =
          audioEl.ended || audioEl.currentTime >= Math.max(0, audioDur - 0.05);

        const videoDone =
          !hasVideo ||
          !video ||
          video.ended ||
          video.currentTime >= Math.max(0, actualVideoDuration - 0.05);

        if (audioDone && videoDone) {
          if (video) {
            video.pause();
            video.muted = true;
          }
          ttsAudio.pause();
          ttsAudio.muted = false;
          if (unifiedAudio) unifiedAudio.pause();
          audioSource.disconnect();
          resolve();
        } else {
          requestAnimationFrame(renderFrame);
        }
      };

      renderFrame();
    });
  }

  onProgress?.({ stage: 'encoding', progress: 85 });

  // 释放 RVC 阶段创建的 blob URL
  if (rvcOptions) {
    for (const data of mediaData) {
      if (data.unifiedAudioUrl) URL.revokeObjectURL(data.unifiedAudioUrl);
    }
  }

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
