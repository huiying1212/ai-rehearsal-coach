import React, { useState, useEffect, useRef } from 'react';
import { ScriptSegment, SegmentStatus, GestureType } from '../types';
import { Play, Pause, RotateCcw, User, Download, Loader2, Hand, Settings } from 'lucide-react';
import { base64ToDataUrl } from '../services/geminiService';
import { exportComposedVideo, canExportVideo } from '../services/videoExportService';
import { getRvcOptionsFromEnv, type RvcOptions } from '../services/rvcService';

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

  // RVC configuration state
  const [rvcEnabled, setRvcEnabled] = useState(false);
  const [rvcApiUrl, setRvcApiUrl] = useState('');
  const [rvcModelName, setRvcModelName] = useState('');
  const [rvcF0Method, setRvcF0Method] = useState('rmvpe');
  const [rvcIndexRate, setRvcIndexRate] = useState('0.66');
  const [showRvcSettings, setShowRvcSettings] = useState(false);

  // Initialize RVC settings from environment variables
  useEffect(() => {
    const envOpts = getRvcOptionsFromEnv();
    if (envOpts) {
      setRvcApiUrl(envOpts.apiUrl);
      setRvcModelName(envOpts.modelName);
      if (envOpts.f0method) setRvcF0Method(envOpts.f0method);
      if (envOpts.indexRate != null) setRvcIndexRate(String(envOpts.indexRate));
      setRvcEnabled(true);
    }
  }, []);

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
    
    // 追踪 TTS 和视频是否都已结束
    let ttsEnded = false;
    let videoEnded = !hasVideo; // 如果没有视频，视为已结束

    const checkAndProceed = () => {
      // 只有当 TTS 和视频都结束时才进入下一个段落
      if (ttsEnded && videoEnded) {
        handleNext();
      }
    };

    // 设置 TTS Audio
    if (audioRef.current) {
      audioRef.current.src = currentSegment.audioUrl || '';
      
      if (hasVideo) {
        // 有视频时：TTS静音，但仍然播放用于时间同步
        audioRef.current.muted = true;
      } else {
        // 无视频时：播放TTS声音
        audioRef.current.muted = false;
      }
      
      audioRef.current.play().catch(e => console.error("Audio play failed", e));
      
      // TTS 结束时检查是否可以进入下一段
      audioRef.current.onended = () => {
        ttsEnded = true;
        checkAndProceed();
      };
    }

    // Set up Video - 仅对有视频的段落播放
    if (videoRef.current) {
      if (hasVideo) {
        videoRef.current.src = currentSegment.videoUrl!;
        // 有视频时：使用视频中的声音（更匹配手势动作）
        videoRef.current.muted = false;
        videoRef.current.loop = false;
        videoRef.current.play().catch(e => console.error("Video play failed", e));
        
        // 视频结束时检查是否可以进入下一段
        videoRef.current.onended = () => {
          videoEnded = true;
          checkAndProceed();
        };
      } else {
        videoRef.current.src = "";
        videoRef.current.muted = true;
        videoRef.current.pause();
        videoRef.current.onended = null;
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
      audioRef.current.muted = false; // 重置静音状态
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.src = "";
      videoRef.current.muted = true;
    }
  };

  // Build RVC options from current UI state (null if disabled or incomplete)
  const buildRvcOptions = (): RvcOptions | null => {
    if (!rvcEnabled || !rvcApiUrl.trim() || !rvcModelName.trim()) return null;
    return {
      apiUrl: rvcApiUrl.trim(),
      modelName: rvcModelName.trim(),
      f0method: rvcF0Method || 'rmvpe',
      indexRate: rvcIndexRate ? Number(rvcIndexRate) : 0.66,
    };
  };

  // Handle video export - 使用新的合成导出函数
  const handleExport = async () => {
    if (exportState.isExporting || !characterImage) return;
    
    setExportState({ isExporting: true, stage: 'Preparing...', progress: 0 });
    
    try {
      const rvcOptions = buildRvcOptions();
      console.log('[Export] RVC enabled:', !!rvcOptions, rvcOptions ? `(${rvcOptions.apiUrl}, model=${rvcOptions.modelName})` : '');

      await exportComposedVideo(segments, characterImage, (progress) => {
        const stageLabels: Record<string, string> = {
          'preparing': 'Preparing...',
          'loading': `Loading media (${progress.currentSegment}/${progress.totalSegments})...`,
          'rvc': `Unifying voice / RVC (${progress.currentSegment}/${progress.totalSegments})...`,
          'rendering': `Rendering (${progress.currentSegment}/${progress.totalSegments})...`,
          'encoding': 'Encoding video...',
          'complete': 'Complete!'
        };
        
        setExportState({
          isExporting: true,
          stage: stageLabels[progress.stage] || progress.stage,
          progress: progress.progress
        });
      }, { rvcOptions });
      
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
            <div className="flex items-center space-x-2">
              <button 
                onClick={handleExport}
                disabled={exportState.isExporting}
                className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full font-semibold transition-colors"
                title={rvcEnabled && rvcApiUrl && rvcModelName ? 'Export video with RVC voice unification' : 'Export video (no subtitles)'}
              >
                {exportState.isExporting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">{exportState.stage}</span>
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    <span>Export{rvcEnabled && rvcApiUrl && rvcModelName ? ' (RVC)' : ''}</span>
                  </>
                )}
              </button>
              {/* RVC Settings toggle */}
              <button
                onClick={() => setShowRvcSettings(v => !v)}
                className={`p-2 rounded-full transition-colors ${showRvcSettings ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                title="RVC Voice Conversion Settings"
              >
                <Settings size={18} />
              </button>
            </div>
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

      {/* RVC Settings Panel (collapsible) */}
      {showRvcSettings && (
        <div className="px-4 pb-4 bg-gray-800 border-t border-gray-700 space-y-3">
          <div className="flex items-center justify-between pt-3">
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-semibold text-gray-200">RVC Voice Unification</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={rvcEnabled}
                onChange={(e) => setRvcEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
              <span className="ml-2 text-xs text-gray-400">{rvcEnabled ? 'ON' : 'OFF'}</span>
            </label>
          </div>

          {rvcEnabled && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">API URL</label>
                  <input
                    type="text"
                    value={rvcApiUrl}
                    onChange={(e) => setRvcApiUrl(e.target.value)}
                    placeholder="http://localhost:8001"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-600"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Model Name</label>
                  <input
                    type="text"
                    value={rvcModelName}
                    onChange={(e) => setRvcModelName(e.target.value)}
                    placeholder="my_voice_model"
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder-gray-600"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">F0 Method</label>
                  <select
                    value={rvcF0Method}
                    onChange={(e) => setRvcF0Method(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    <option value="rmvpe">rmvpe</option>
                    <option value="crepe">crepe</option>
                    <option value="harvest">harvest</option>
                    <option value="pm">pm</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Index Rate (0-1)</label>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={rvcIndexRate}
                    onChange={(e) => setRvcIndexRate(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>
              </div>
              {rvcEnabled && (!rvcApiUrl.trim() || !rvcModelName.trim()) && (
                <p className="text-xs text-amber-400">Please fill in both API URL and Model Name to enable RVC during export.</p>
              )}
              {rvcEnabled && rvcApiUrl.trim() && rvcModelName.trim() && (
                <p className="text-xs text-green-400">RVC will be applied during export to unify all audio to a consistent voice.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Player;
