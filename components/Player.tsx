import React, { useState, useEffect, useRef } from 'react';
import { ScriptSegment, SegmentStatus, GestureType } from '../types';
import { Play, Pause, RotateCcw, User, Download, Loader2, Hand } from 'lucide-react';
import { base64ToDataUrl } from '../services/geminiService';
import { exportComposedVideo, canExportVideo } from '../services/videoExportService';

// 手势类型标签映射
const getGestureLabel = (type: GestureType): string => {
  const labels: Record<GestureType, string> = {
    [GestureType.NONE]: '无手势',
    [GestureType.BEAT]: '节拍手势',
    [GestureType.DEICTIC]: '指示手势',
    [GestureType.ICONIC]: '形象手势',
    [GestureType.METAPHORIC]: '隐喻手势',
  };
  return labels[type] || '手势';
};

interface PlayerProps {
  segments: ScriptSegment[];
  characterImage?: string | null; // Base64 character reference image
}

interface ExportState {
  isExporting: boolean;
  stage: string;
  progress: number;
}

const Player: React.FC<PlayerProps> = ({ segments, characterImage }) => {
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({
    isExporting: false,
    stage: '',
    progress: 0
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Filter only ready segments to avoid errors during playback
  // 只需要音频完成即可播放，视频可选
  const readySegments = segments.filter(
    (s) => s.audioStatus === SegmentStatus.COMPLETED
  );

  const currentSegment = currentIndex >= 0 ? readySegments[currentIndex] : null;

  // 判断当前段落是否需要视频（非 none 手势类型且视频已完成）
  const hasVideoForSegment = (seg: ScriptSegment | null): boolean => {
    if (!seg) return false;
    return seg.gestureType !== GestureType.NONE && 
           seg.videoStatus === SegmentStatus.COMPLETED && 
           !!seg.videoUrl;
  };

  useEffect(() => {
    if (!isPlaying || !currentSegment) return;

    const hasVideo = hasVideoForSegment(currentSegment);

    // Set up TTS Audio as master timeline
    if (audioRef.current) {
      audioRef.current.src = currentSegment.audioUrl || '';
      audioRef.current.play().catch(e => console.error("Audio play failed", e));
      
      // When TTS audio ends, move to next segment (TTS is the master timeline)
      audioRef.current.onended = () => {
        handleNext();
      };
    }

    // Set up Video - 仅对有视频的段落播放
    if (videoRef.current) {
      if (hasVideo) {
        videoRef.current.src = currentSegment.videoUrl!;
        videoRef.current.muted = true; // 静音视频，使用TTS音频作为主音频
        videoRef.current.loop = false;
        videoRef.current.play().catch(e => console.error("Video play failed", e));
      } else {
        videoRef.current.src = "";
        videoRef.current.pause();
      }
    }

  }, [currentIndex, isPlaying, currentSegment]);

  const handleNext = () => {
    if (currentIndex < readySegments.length - 1) {
      setCurrentIndex(prev => prev + 1);
    } else {
      setIsPlaying(false);
      setCurrentIndex(-1); // Reset
    }
  };

  const togglePlay = () => {
    if (readySegments.length === 0) return;

    if (isPlaying) {
      setIsPlaying(false);
      audioRef.current?.pause();
      videoRef.current?.pause();
    } else {
      setIsPlaying(true);
      if (currentIndex === -1) setCurrentIndex(0);
      else audioRef.current?.play();
    }
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(-1);
    if(audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
    }
  };

  // Handle video export - 使用新的合成导出函数
  const handleExport = async () => {
    if (exportState.isExporting || !characterImage) return;
    
    setExportState({ isExporting: true, stage: 'Preparing...', progress: 0 });
    
    try {
      await exportComposedVideo(segments, characterImage, (progress) => {
        const stageLabels: Record<string, string> = {
          'preparing': 'Preparing...',
          'loading': `Loading media (${progress.currentSegment}/${progress.totalSegments})...`,
          'rendering': `Rendering (${progress.currentSegment}/${progress.totalSegments})...`,
          'mixing_audio': 'Mixing audio tracks...',
          'encoding': 'Encoding video...',
          'complete': 'Complete!'
        };
        
        setExportState({
          isExporting: true,
          stage: stageLabels[progress.stage] || progress.stage,
          progress: progress.progress
        });
      });
      
      // Reset after a short delay
      setTimeout(() => {
        setExportState({ isExporting: false, stage: '', progress: 0 });
      }, 2000);
    } catch (error: any) {
      console.error('Export failed:', error);
      setExportState({ isExporting: false, stage: '', progress: 0 });
      alert(`Export failed: ${error.message}`);
    }
  };

  const showExportButton = canExportVideo(segments) && characterImage;

  // Determine what to show in the stage area
  // 对于有视频的段落显示视频，对于无手势段落显示静态图片
  const hasVideo = hasVideoForSegment(currentSegment);
  // 无手势或视频未完成时，显示静态角色图片
  const showStaticImage = !hasVideo && characterImage && isPlaying;

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl border border-gray-700">
      {/* Stage Area - Updated to 9:16 aspect ratio to match character image */}
      <div className="relative aspect-[9/16] max-h-[600px] bg-black flex items-center justify-center mx-auto">
        {hasVideo ? (
          // 有视频的段落：播放视频（视频静音，使用TTS音频）
          <video 
            ref={videoRef}
            className="w-full h-full object-contain"
            muted 
            playsInline
          />
        ) : showStaticImage ? (
          // 无手势或视频未完成的段落：显示静态角色图片
          <div className="relative w-full h-full">
            <img 
              src={base64ToDataUrl(characterImage)} 
              alt="Character"
              className="w-full h-full object-contain"
            />
            {/* 显示当前段落的手势类型状态 */}
            <div className="absolute top-4 left-4 bg-gray-900/80 text-gray-300 text-xs px-3 py-1 rounded-full flex items-center">
              <Hand className="w-3 h-3 mr-1" />
              {currentSegment?.gestureType === GestureType.NONE ? (
                <span>无手势 - 静态画面</span>
              ) : currentSegment?.videoStatus === SegmentStatus.GENERATING ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  <span>视频生成中...</span>
                </>
              ) : (
                <span>Audio Only</span>
              )}
            </div>
          </div>
        ) : characterImage && !isPlaying ? (
          // Show character image as poster when not playing
          <div className="relative w-full h-full">
            <img 
              src={base64ToDataUrl(characterImage)} 
              alt="Character"
              className="w-full h-full object-contain opacity-60"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="bg-indigo-600/80 p-4 rounded-full mb-3 inline-block">
                  <Play className="w-8 h-8 text-white" />
                </div>
                <p className="text-white font-semibold">Press Play to Start Rehearsal</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center p-8 text-gray-500">
            {isPlaying ? (
              <div className="animate-pulse">
                <p className="text-xl font-bold text-gray-400">Audio Only Rehearsal</p>
                <p className="text-sm">(No video generated for this segment)</p>
              </div>
            ) : (
              <p>Press Play to Start Rehearsal</p>
            )}
          </div>
        )}

        {/* Overlay Text - Subtitles style */}
        {currentSegment && (
          <div className="absolute bottom-8 left-0 right-0 text-center px-4">
            <div className="inline-block bg-black/70 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/10 max-w-full">
              <p className="text-lg md:text-xl font-semibold text-white mb-1">
                "{currentSegment.spokenText}"
              </p>
              <p className="text-xs text-indigo-300 uppercase tracking-wider font-bold">
                {getGestureLabel(currentSegment.gestureType)}
                {currentSegment.gestureDescription && `: ${currentSegment.gestureDescription}`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Hidden Audio Element */}
      <audio ref={audioRef} className="hidden" />

      {/* Controls */}
      <div className="p-4 bg-gray-800 flex items-center justify-between border-t border-gray-700">
        <div className="flex items-center space-x-4">
          <button 
            onClick={togglePlay}
            disabled={readySegments.length === 0}
            className="flex items-center space-x-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-full font-semibold transition-colors"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            <span>{isPlaying ? 'Pause' : 'Start Rehearsal'}</span>
          </button>
          <button 
            onClick={handleReset}
            className="text-gray-400 hover:text-white transition-colors p-2"
            title="Reset"
          >
            <RotateCcw size={20} />
          </button>
          
          {/* Export Button */}
          {showExportButton && (
            <button 
              onClick={handleExport}
              disabled={exportState.isExporting}
              className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full font-semibold transition-colors"
              title="Export video (no subtitles)"
            >
              {exportState.isExporting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-sm">{exportState.stage}</span>
                </>
              ) : (
                <>
                  <Download size={18} />
                  <span>Export Video</span>
                </>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center space-x-4">
          {/* Export Progress Bar */}
          {exportState.isExporting && (
            <div className="flex items-center space-x-2">
              <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${exportState.progress}%` }}
                />
              </div>
              <span className="text-xs text-gray-400">{Math.round(exportState.progress)}%</span>
            </div>
          )}
          <div className="text-gray-400 text-sm">
            {currentIndex >= 0 ? `Segment ${currentIndex + 1} / ${readySegments.length}` : 'Ready'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Player;
