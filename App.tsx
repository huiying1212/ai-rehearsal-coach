import React, { useState } from 'react';
import { Sparkles, Video, Mic, AlertCircle, Loader2, User, ImageIcon, Edit3, RefreshCw, Check, X, Trash2, Plus, Presentation, Hand } from 'lucide-react';
import { generateRehearsalScript, generateSpeech, generateActionVideo, generateCharacterImage, base64ToDataUrl, GestureTypeValue } from './services/geminiService';
import { ScriptSegment, SegmentStatus, RehearsalState, GeminiScriptResponse, CharacterStatus, SlideDesign, GestureType } from './types';
import Player from './components/Player';

// Declare global for the key selection
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<RehearsalState['status']>('input');
  const [segments, setSegments] = useState<ScriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // New state for character image
  const [characterImageBase64, setCharacterImageBase64] = useState<string | null>(null);
  const [characterDescription, setCharacterDescription] = useState<string | null>(null);
  const [characterStatus, setCharacterStatus] = useState<CharacterStatus>(CharacterStatus.IDLE);

  const handleGenerateScript = async () => {
    if (!prompt.trim()) return;
    
    setState('scripting');
    setError(null);
    setCharacterImageBase64(null);
    setCharacterDescription(null);
    setCharacterStatus(CharacterStatus.IDLE);

    try {
      // Step 1: Generate script with character description
      const result: GeminiScriptResponse = await generateRehearsalScript(prompt);
      
      const newSegments: ScriptSegment[] = result.script.map((item, index) => ({
        id: `seg-${index}-${Date.now()}`,
        spokenText: item.spoken_text,
        gestureType: item.gesture_type as GestureType,
        gestureDescription: item.gesture_description, // 仅对 deictic/iconic/metaphoric 有值
        slideDesign: {
          title: item.slide_design.title,
          type: item.slide_design.type,
          content: item.slide_design.content,
          items: item.slide_design.items,
        },
        audioStatus: SegmentStatus.IDLE,
        videoStatus: item.gesture_type === 'none' ? SegmentStatus.COMPLETED : SegmentStatus.IDLE, // 无手势的段落不需要生成视频
      }));

      setSegments(newSegments);
      setCharacterDescription(result.character_description);
      
      // Step 2: Generate character image (定妆照)
      setState('generating_character');
      setCharacterStatus(CharacterStatus.GENERATING);
      
      try {
        const imageBase64 = await generateCharacterImage(result.character_description);
        setCharacterImageBase64(imageBase64);
        setCharacterStatus(CharacterStatus.COMPLETED);
      } catch (imgErr) {
        console.error("Character image generation failed:", imgErr);
        setCharacterStatus(CharacterStatus.ERROR);
        // Continue without image - user can regenerate later
      }
      
      // Step 3: Enter editing mode - wait for user confirmation before generating media
      setState('editing');

    } catch (err: any) {
      console.error(err);
      setError("Failed to generate script. Please try again.");
      setState('input');
    }
  };

  // Handle user confirmation to proceed with media generation
  const handleConfirmAndGenerate = async () => {
    setState('generating_media');
    await generateMediaForSegments(segments, characterImageBase64);
  };

  // Handle regenerating character image with new description
  const handleRegenerateCharacter = async () => {
    if (!characterDescription) return;
    
    setCharacterStatus(CharacterStatus.GENERATING);
    setCharacterImageBase64(null);
    
    try {
      const imageBase64 = await generateCharacterImage(characterDescription);
      setCharacterImageBase64(imageBase64);
      setCharacterStatus(CharacterStatus.COMPLETED);
    } catch (imgErr) {
      console.error("Character image regeneration failed:", imgErr);
      setCharacterStatus(CharacterStatus.ERROR);
    }
  };

  // Update a specific segment's text
  const handleUpdateSegmentText = (id: string, field: 'spokenText' | 'gestureDescription', value: string) => {
    setSegments(prev => prev.map(seg => 
      seg.id === id ? { ...seg, [field]: value } : seg
    ));
  };

  // Update a specific segment's gesture type
  const handleUpdateGestureType = (id: string, gestureType: GestureType) => {
    setSegments(prev => prev.map(seg => {
      if (seg.id !== id) return seg;
      
      // 如果从无手势改为有手势，需要重置视频状态
      const needsVideo = gestureType !== GestureType.NONE;
      const hadVideo = seg.gestureType !== GestureType.NONE;
      
      return { 
        ...seg, 
        gestureType,
        // 如果改为 deictic/iconic/metaphoric 但没有描述，清空描述
        gestureDescription: ['deictic', 'iconic', 'metaphoric'].includes(gestureType) 
          ? seg.gestureDescription 
          : undefined,
        // 重置视频状态
        videoStatus: needsVideo ? SegmentStatus.IDLE : SegmentStatus.COMPLETED,
        videoUrl: needsVideo && hadVideo ? seg.videoUrl : undefined
      };
    }));
  };

  // Delete a specific segment
  const handleDeleteSegment = (id: string) => {
    setSegments(prev => prev.filter(seg => seg.id !== id));
  };

  // Add a new empty segment
  const handleAddSegment = () => {
    const newSegment: ScriptSegment = {
      id: `seg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      spokenText: '',
      gestureType: GestureType.BEAT, // 默认使用节拍手势
      gestureDescription: undefined,
      slideDesign: {
        title: 'New Slide',
        type: 'text',
        content: '',
      },
      audioStatus: SegmentStatus.IDLE,
      videoStatus: SegmentStatus.IDLE,
    };
    setSegments(prev => [...prev, newSegment]);
  };

  // Update a specific segment's slide design
  const handleUpdateSlideDesign = (id: string, updates: Partial<SlideDesign>) => {
    setSegments(prev => prev.map(seg => 
      seg.id === id ? { ...seg, slideDesign: { ...seg.slideDesign, ...updates } } : seg
    ));
  };

  const generateMediaForSegments = async (currentSegments: ScriptSegment[], referenceImage: string | null) => {
    // 1. Generate Audio (Parallel) - 获取音频时长用于指定视频时长
    // 存储每个段落的音频信息，用于后续视频生成
    const audioResults: Map<string, { audioUrl: string; audioDuration: number }> = new Map();
    
    const audioPromises = currentSegments.map(async (seg) => {
      try {
        updateSegmentStatus(seg.id, 'audioStatus', SegmentStatus.GENERATING);
        const audioUrl = await generateSpeech(seg.spokenText);
        
        // 获取音频时长
        const audioDuration = await getAudioDuration(audioUrl);
        console.log(`[App] Audio for ${seg.id}: ${audioDuration.toFixed(2)}s`);
        
        // 保存音频结果供视频生成使用
        audioResults.set(seg.id, { audioUrl, audioDuration });
        
        setSegments(prev => prev.map(s => 
          s.id === seg.id 
            ? { ...s, audioStatus: SegmentStatus.COMPLETED, audioUrl, audioDuration } 
            : s
        ));
      } catch (e) {
        console.error(`Audio gen failed for ${seg.id}`, e);
        updateSegmentStatus(seg.id, 'audioStatus', SegmentStatus.ERROR);
      }
    });

    await Promise.all(audioPromises);

    // 2. Generate Video (Sequential) - 仅对需要视频的段落生成
    // 使用音频时长来指定视频时长，确保视频能覆盖整个音频
    let canGenVideo = referenceImage !== null;
    
    // Also check API key
    if (canGenVideo) {
      try {
        if (window.aistudio) {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          if (!hasKey) {
            canGenVideo = false;
          }
        }
      } catch(e) {
        canGenVideo = false;
      }
    }

    if (canGenVideo && referenceImage) {
      // 过滤出需要生成视频的段落（非 none 手势类型）
      const segmentsNeedingVideo = currentSegments.filter(seg => seg.gestureType !== GestureType.NONE);
      
      for (const seg of segmentsNeedingVideo) {
        try {
          updateSegmentStatus(seg.id, 'videoStatus', SegmentStatus.GENERATING);
          
          // 获取该段落的音频时长（用于日志）
          const audioInfo = audioResults.get(seg.id);
          const audioDuration = audioInfo?.audioDuration;
          
          // 注意：使用参考图片时，Veo API 只支持 8 秒视频
          // https://ai.google.dev/gemini-api/docs/video#limitations
          if (audioDuration) {
            if (audioDuration > 8) {
              console.warn(`[App] ⚠️ Segment ${seg.id} audio is ${audioDuration.toFixed(2)}s (>8s), but video is fixed at 8s. Consider splitting this segment.`);
            } else {
              console.log(`[App] Segment ${seg.id} audio is ${audioDuration.toFixed(2)}s, video will be 8s (fixed when using reference image)`);
            }
          }
          
          // 根据手势类型调用视频生成（使用参考图片时固定为8秒）
          const result = await generateActionVideo(
            seg.gestureType as GestureTypeValue,
            seg.spokenText,
            seg.gestureDescription,
            referenceImage
          );
          
          console.log(`[App] Video generated for ${seg.id}, URL: ${result.videoUrl.substring(0, 80)}...`);
          
          // 获取视频实际时长（可能会因为CORS失败，使用超时保护）
          console.log(`[App] Getting video duration for ${seg.id}...`);
          const videoDuration = await getVideoDuration(result.videoUrl);
          console.log(`[App] Video duration for ${seg.id}: ${videoDuration}s (target was ${targetDuration?.toFixed(2)}s)`);
          
          console.log(`[App] Updating segment ${seg.id} status to COMPLETED`);
          setSegments(prev => prev.map(s => 
            s.id === seg.id 
              ? { 
                  ...s, 
                  videoStatus: SegmentStatus.COMPLETED, 
                  videoUrl: result.videoUrl,
                  videoDuration 
                } 
              : s
          ));
          console.log(`[App] Segment ${seg.id} updated`);
        } catch (e) {
          console.error(`Video gen failed for ${seg.id}`, e);
          updateSegmentStatus(seg.id, 'videoStatus', SegmentStatus.ERROR);
        }
      }
    }

    setState('ready');
  };

  // 获取音频时长的辅助函数
  const getAudioDuration = (audioUrl: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        resolve(audio.duration);
      };
      audio.onerror = () => {
        resolve(0);
      };
      audio.src = audioUrl;
    });
  };

  // 获取视频时长的辅助函数（带超时）
  const getVideoDuration = (videoUrl: string): Promise<number> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      
      // 设置超时，避免无限等待
      const timeout = setTimeout(() => {
        console.warn('[getVideoDuration] Timeout - using default duration');
        resolve(0);
      }, 10000); // 10秒超时
      
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve(video.duration);
      };
      video.onerror = (e) => {
        clearTimeout(timeout);
        console.warn('[getVideoDuration] Error loading video:', e);
        resolve(0);
      };
      // 有些浏览器需要这个事件
      video.oncanplaythrough = () => {
        if (video.duration && video.duration !== Infinity) {
          clearTimeout(timeout);
          resolve(video.duration);
        }
      };
      video.src = videoUrl;
      video.load(); // 显式触发加载
    });
  };

  const updateSegmentStatus = (id: string, type: 'audioStatus' | 'videoStatus', status: SegmentStatus) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, [type]: status } : s));
  };

  // Handle regenerating video for a specific segment
  const handleRegenerateVideo = async (segmentId: string) => {
    const segment = segments.find(s => s.id === segmentId);
    if (!segment || !characterImageBase64) return;

    // 无手势类型不需要生成视频
    if (segment.gestureType === GestureType.NONE) {
      setError("This segment doesn't need video generation (no gesture).");
      return;
    }

    // Check API key
    try {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setError("Please select an API key first to generate videos.");
          return;
        }
      }
    } catch(e) {
      setError("Failed to check API key. Please try again.");
      return;
    }

    updateSegmentStatus(segmentId, 'videoStatus', SegmentStatus.GENERATING);
    
    try {
      // 使用参考图片时，Veo API 只支持 8 秒视频
      const result = await generateActionVideo(
        segment.gestureType as GestureTypeValue,
        segment.spokenText,
        segment.gestureDescription,
        characterImageBase64
      );
      
      // 获取视频实际时长
      const videoDuration = await getVideoDuration(result.videoUrl);
      
      setSegments(prev => prev.map(s => 
        s.id === segmentId 
          ? { 
              ...s, 
              videoStatus: SegmentStatus.COMPLETED, 
              videoUrl: result.videoUrl,
              videoDuration 
            } 
          : s
      ));
    } catch (e) {
      console.error(`Video regeneration failed for ${segmentId}`, e);
      updateSegmentStatus(segmentId, 'videoStatus', SegmentStatus.ERROR);
    }
  };

  const handleApiKeySelection = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
      } catch (e) {
        console.error("API Key selection failed", e);
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center p-6 lg:p-12 max-w-7xl mx-auto">
      <header className="w-full text-center mb-12 space-y-4">
        <div className="flex items-center justify-center space-x-3">
          <div className="bg-indigo-600 p-3 rounded-lg">
            <Video className="text-white w-8 h-8" />
          </div>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-cyan-400">
            Robot Rehearsal Coach
          </h1>
        </div>

        
      </header>

      {/* Main Content Area */}
      <main className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Input & Script List */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Input Box */}
          <div className="bg-gray-800 p-6 rounded-2xl border border-gray-700 shadow-xl">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              What do you want to rehearse?
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={state !== 'input' && state !== 'ready' && state !== 'editing'}
              placeholder="e.g., You are giving a toast at a best friend's wedding..."
              className="w-full h-32 bg-gray-900 border border-gray-700 rounded-xl p-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-all disabled:opacity-50"
            />
            
            {error && (
              <div className="mt-3 flex items-center text-red-400 text-sm bg-red-400/10 p-2 rounded-lg">
                <AlertCircle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}

            <button
              onClick={handleGenerateScript}
              disabled={!prompt.trim() || (state !== 'input' && state !== 'ready' && state !== 'editing')}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-lg flex items-center justify-center transition-all shadow-lg hover:shadow-indigo-500/25"
            >
              {state === 'scripting' ? (
                <>
                  <Loader2 className="animate-spin mr-2" /> Scripting...
                </>
              ) : state === 'generating_character' ? (
                <>
                  <Loader2 className="animate-spin mr-2" /> Creating Character...
                </>
              ) : state === 'generating_media' ? (
                <>
                  <Loader2 className="animate-spin mr-2" /> Generating Media...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2" /> Generate Rehearsal
                </>
              )}
            </button>
          </div>

          {/* Character Image Card (定妆照) - Editable in editing state */}
          {(characterStatus !== CharacterStatus.IDLE || characterDescription) && (
            <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-xl">
              <div className="p-4 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <User className="w-4 h-4 text-indigo-400" />
                  <h3 className="font-semibold text-gray-200">Character Profile</h3>
                </div>
                <CharacterStatusBadge status={characterStatus} />
              </div>
              
              <div className="p-4">
                {/* Character Description - Editable in editing state */}
                {characterDescription !== null && (
                  <div className="mb-4">
                    {state === 'editing' ? (
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block flex items-center">
                          <Edit3 className="w-3 h-3 mr-1" />
                          Character Description (edit to regenerate)
                        </label>
                        <textarea
                          value={characterDescription}
                          onChange={(e) => setCharacterDescription(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-sm text-gray-300 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          rows={3}
                        />
                        <button
                          onClick={handleRegenerateCharacter}
                          disabled={characterStatus === CharacterStatus.GENERATING}
                          className="mt-2 w-full bg-indigo-600/50 hover:bg-indigo-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center transition-all"
                        >
                          {characterStatus === CharacterStatus.GENERATING ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                              Regenerating...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Regenerate Character Image
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">
                        "{characterDescription}"
                      </p>
                    )}
                  </div>
                )}
                
                {/* Character Image */}
                <div className="aspect-[9/16] max-h-[400px] bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center">
                  {characterStatus === CharacterStatus.GENERATING ? (
                    <div className="text-center text-gray-500">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                      <p className="text-sm">Generating character...</p>
                    </div>
                  ) : characterStatus === CharacterStatus.COMPLETED && characterImageBase64 ? (
                    <img 
                      src={base64ToDataUrl(characterImageBase64)} 
                      alt="Character reference"
                      className="w-full h-full object-contain"
                    />
                  ) : characterStatus === CharacterStatus.ERROR ? (
                    <div className="text-center text-red-400">
                      <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm">Failed to generate character</p>
                      {state === 'editing' && (
                        <button
                          onClick={handleRegenerateCharacter}
                          className="mt-2 text-xs text-indigo-400 hover:text-indigo-300 underline"
                        >
                          Try again
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-gray-600">
                      <ImageIcon className="w-8 h-8 mx-auto mb-2" />
                      <p className="text-sm">Character image will appear here</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Script Segment List - Editable in editing state */}
          {segments.length > 0 && (
            <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-xl">
              <div className="p-4 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between">
                <h3 className="font-semibold text-gray-200">Scene Breakdown</h3>
                {state === 'editing' && (
                  <span className="text-xs text-amber-400 flex items-center">
                    <Edit3 className="w-3 h-3 mr-1" />
                    Click to edit
                  </span>
                )}
              </div>
              <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
                {segments.map((seg, idx) => (
                  <div key={seg.id} className="bg-gray-900/50 p-4 rounded-xl border border-gray-700/50">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-mono text-gray-500 uppercase">Segment {idx + 1}</span>
                      <div className="flex items-center space-x-2">
                        <div className="flex space-x-2">
                          <StatusBadge type="Audio" status={seg.audioStatus} />
                          <StatusBadge type="Video" status={seg.videoStatus} />
                        </div>
                        {state === 'editing' && (
                          <button
                            onClick={() => handleDeleteSegment(seg.id)}
                            className="ml-2 p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-all"
                            title="Delete segment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* Spoken Text - Editable in editing state */}
                    {state === 'editing' ? (
                      <div className="mb-3">
                        <label className="text-xs text-gray-500 mb-1 block flex items-center">
                          <Mic className="w-3 h-3 mr-1" />
                          Spoken Text
                        </label>
                        <textarea
                          value={seg.spokenText}
                          onChange={(e) => handleUpdateSegmentText(seg.id, 'spokenText', e.target.value)}
                          className="w-full bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          rows={2}
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-gray-300 mb-2 italic">"{seg.spokenText}"</p>
                    )}
                    
                    {/* Gesture Type & Description - Editable in editing state or when video failed */}
                    {state === 'editing' || seg.videoStatus === SegmentStatus.ERROR ? (
                      <div className="space-y-2">
                        <label className="text-xs text-gray-500 mb-1 block flex items-center">
                          <Hand className="w-3 h-3 mr-1" />
                          Gesture Type
                          {seg.videoStatus === SegmentStatus.ERROR && (
                            <span className="ml-2 text-red-400">(Video generation failed - edit and regenerate)</span>
                          )}
                        </label>
                        <select
                          value={seg.gestureType}
                          onChange={(e) => handleUpdateGestureType(seg.id, e.target.value as GestureType)}
                          className="w-full bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        >
                          <option value={GestureType.NONE}>无手势 (None) - 使用静态图片</option>
                          <option value={GestureType.BEAT}>节拍手势 (Beat) - 自然说话节奏</option>
                          <option value={GestureType.DEICTIC}>指示手势 (Deictic) - 指向特定方向</option>
                          <option value={GestureType.ICONIC}>形象手势 (Iconic) - 描绘具体事物</option>
                          <option value={GestureType.METAPHORIC}>隐喻手势 (Metaphoric) - 表达抽象概念</option>
                        </select>
                        
                        {/* 仅对 deictic/iconic/metaphoric 显示手势描述输入 */}
                        {['deictic', 'iconic', 'metaphoric'].includes(seg.gestureType) && (
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block flex items-center">
                              <Video className="w-3 h-3 mr-1" />
                              Gesture Description (具体手势描述)
                            </label>
                            <textarea
                              value={seg.gestureDescription || ''}
                              onChange={(e) => handleUpdateSegmentText(seg.id, 'gestureDescription', e.target.value)}
                              placeholder="描述具体的手势动作，如：双手向外展开表示范围..."
                              className="w-full bg-gray-800 border border-gray-600 rounded-lg p-2 text-sm text-indigo-300 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              rows={2}
                            />
                          </div>
                        )}
                        
                        {seg.videoStatus === SegmentStatus.ERROR && seg.gestureType !== GestureType.NONE && (
                          <button
                            onClick={() => handleRegenerateVideo(seg.id)}
                            disabled={seg.videoStatus === SegmentStatus.GENERATING || !characterImageBase64}
                            className="mt-2 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center transition-all"
                          >
                            {seg.videoStatus === SegmentStatus.GENERATING ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                                Regenerating Video...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Regenerate Video
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center text-xs bg-indigo-900/20 px-2 py-1 rounded w-fit">
                        <Hand className="w-3 h-3 mr-1" />
                        <GestureTypeBadge type={seg.gestureType} />
                        {seg.gestureDescription && (
                          <span className="ml-2 text-indigo-300">: {seg.gestureDescription}</span>
                        )}
                      </div>
                    )}
                    
                    {/* Slide Design - Editable in editing state */}
                    {state === 'editing' ? (
                      <div className="mt-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                        <label className="text-xs text-gray-500 mb-2 block flex items-center">
                          <Presentation className="w-3 h-3 mr-1" />
                          Slide Design
                        </label>
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={seg.slideDesign.title}
                            onChange={(e) => handleUpdateSlideDesign(seg.id, { title: e.target.value })}
                            placeholder="Slide Title"
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                          <select
                            value={seg.slideDesign.type}
                            onChange={(e) => handleUpdateSlideDesign(seg.id, { type: e.target.value as 'text' | 'list' })}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          >
                            <option value="text">Text</option>
                            <option value="list">List</option>
                          </select>
                          {seg.slideDesign.type === 'text' && (
                            <textarea
                              value={seg.slideDesign.content || ''}
                              onChange={(e) => handleUpdateSlideDesign(seg.id, { content: e.target.value })}
                              placeholder="Slide content..."
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              rows={2}
                            />
                          )}
                          {seg.slideDesign.type === 'list' && (
                            <textarea
                              value={(seg.slideDesign.items || []).join('\n')}
                              onChange={(e) => handleUpdateSlideDesign(seg.id, { items: e.target.value.split('\n').filter(l => l.trim()) })}
                              placeholder="One item per line..."
                              className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm text-gray-200 resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                              rows={3}
                            />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center text-xs text-emerald-300 bg-emerald-900/20 px-2 py-1 rounded w-fit">
                        <Presentation className="w-3 h-3 mr-1" />
                        Slide: {seg.slideDesign.title} ({seg.slideDesign.type})
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              {/* Add Segment & Confirm Buttons - Only in editing state */}
              {state === 'editing' && (
                <div className="p-4 border-t border-gray-700 bg-gray-800/50 space-y-3">
                  <button
                    onClick={handleAddSegment}
                    className="w-full bg-indigo-600/50 hover:bg-indigo-600 text-white py-2.5 rounded-xl font-medium flex items-center justify-center transition-all"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add New Segment
                  </button>
                  <button
                    onClick={handleConfirmAndGenerate}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-bold flex items-center justify-center transition-all shadow-lg hover:shadow-emerald-500/25"
                  >
                    <Check className="w-5 h-5 mr-2" />
                    Confirm & Generate Media
                  </button>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Column: Player */}
        <div className="lg:col-span-8 flex flex-col">
          {segments.length > 0 ? (
            <Player segments={segments} characterImage={characterImageBase64} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center bg-gray-800/30 rounded-2xl border-2 border-dashed border-gray-700 min-h-[400px]">
              <div className="bg-gray-800 p-4 rounded-full mb-4">
                <Video className="w-10 h-10 text-gray-600" />
              </div>
              <p className="text-gray-500 font-medium">Your stage is empty.</p>
              <p className="text-gray-600 text-sm mt-1">Generate a script to begin rehearsing.</p>
            </div>
          )}
          
          {/* Info Section */}
          {state === 'editing' && (
            <div className="mt-6 p-4 bg-amber-900/20 border border-amber-500/30 rounded-xl text-amber-200 text-sm flex items-start">
              <Edit3 className="w-5 h-5 mr-3 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Review & Edit Your Script</p>
                <p className="opacity-80 mt-1">
                  Review and edit the generated script and character description. You can modify the spoken text, action descriptions, 
                  and regenerate the character image if needed. Click "Confirm & Generate Media" when you're satisfied.
                </p>
              </div>
            </div>
          )}
          
          {(state === 'generating_character' || state === 'generating_media') && (
            <div className="mt-6 p-4 bg-indigo-900/20 border border-indigo-500/30 rounded-xl text-indigo-200 text-sm flex items-start">
              <Loader2 className="w-5 h-5 mr-3 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Production in progress...</p>
                <p className="opacity-80 mt-1">
                  {state === 'generating_character' 
                    ? "Creating your character's reference image. This will be used for all video segments."
                    : "Audio generation is fast. Video generation (Veo) takes longer (several minutes). The player will update automatically as assets become available."
                  }
                </p>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

const StatusBadge = ({ type, status }: { type: string, status: SegmentStatus }) => {
  let color = "bg-gray-700 text-gray-400"; // Idle
  let icon = null;

  if (status === SegmentStatus.GENERATING) {
    color = "bg-yellow-900/50 text-yellow-500 border border-yellow-700/50";
    icon = <Loader2 className="w-3 h-3 animate-spin mr-1" />;
  } else if (status === SegmentStatus.COMPLETED) {
    color = "bg-green-900/50 text-green-400 border border-green-700/50";
    icon = type === 'Audio' ? <Mic className="w-3 h-3 mr-1" /> : <Video className="w-3 h-3 mr-1" />;
  } else if (status === SegmentStatus.ERROR) {
    color = "bg-red-900/50 text-red-400";
  }

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center ${color}`}>
      {icon}
      {type}
    </span>
  );
};

const CharacterStatusBadge = ({ status }: { status: CharacterStatus }) => {
  let color = "bg-gray-700 text-gray-400";
  let text = "Pending";
  let icon = null;

  if (status === CharacterStatus.GENERATING) {
    color = "bg-yellow-900/50 text-yellow-500 border border-yellow-700/50";
    text = "Generating";
    icon = <Loader2 className="w-3 h-3 animate-spin mr-1" />;
  } else if (status === CharacterStatus.COMPLETED) {
    color = "bg-green-900/50 text-green-400 border border-green-700/50";
    text = "Ready";
    icon = <User className="w-3 h-3 mr-1" />;
  } else if (status === CharacterStatus.ERROR) {
    color = "bg-red-900/50 text-red-400";
    text = "Error";
    icon = <AlertCircle className="w-3 h-3 mr-1" />;
  }

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center ${color}`}>
      {icon}
      {text}
    </span>
  );
};

// 手势类型徽章组件
const GestureTypeBadge = ({ type }: { type: GestureType }) => {
  const configs: Record<GestureType, { color: string; label: string }> = {
    [GestureType.NONE]: { color: "text-gray-400", label: "无手势" },
    [GestureType.BEAT]: { color: "text-blue-400", label: "节拍" },
    [GestureType.DEICTIC]: { color: "text-amber-400", label: "指示" },
    [GestureType.ICONIC]: { color: "text-emerald-400", label: "形象" },
    [GestureType.METAPHORIC]: { color: "text-purple-400", label: "隐喻" },
  };

  const config = configs[type] || configs[GestureType.BEAT];

  return <span className={config.color}>{config.label}</span>;
};
