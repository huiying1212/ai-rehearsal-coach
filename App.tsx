import React, { useState } from 'react';
import { Sparkles, Video, Mic, AlertCircle, Loader2 } from 'lucide-react';
import { generateRehearsalScript, generateSpeech, generateActionVideo } from './services/geminiService';
import { ScriptSegment, SegmentStatus, RehearsalState, GeminiScriptResponse } from './types';
import Player from './components/Player';

// Declare global for the key selection
// Fix: We define the AIStudio interface instead of redefining Window property
// to match the existing global declaration that TypeScript is complaining about.
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<RehearsalState['status']>('input');
  const [segments, setSegments] = useState<ScriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGenerateScript = async () => {
    if (!prompt.trim()) return;
    
    setState('scripting');
    setError(null);

    try {
      const result: GeminiScriptResponse = await generateRehearsalScript(prompt);
      
      const newSegments: ScriptSegment[] = result.script.map((item, index) => ({
        id: `seg-${index}-${Date.now()}`,
        spokenText: item.spoken_text,
        actionDescription: item.action_description,
        audioStatus: SegmentStatus.IDLE,
        videoStatus: SegmentStatus.IDLE,
      }));

      setSegments(newSegments);
      setState('generating_media');
      
      // Start media generation in background
      generateMediaForSegments(newSegments);

    } catch (err: any) {
      console.error(err);
      setError("Failed to generate script. Please try again.");
      setState('input');
    }
  };

  const generateMediaForSegments = async (currentSegments: ScriptSegment[]) => {
    // We process segments sequentially for logic simplicity, 
    // but we can fire audio and video in parallel for a single segment.
    // However, Video (Veo) is heavy, so we might want to respect rate limits.
    // Let's do Audio first for all (fast), then Video for all.

    // 1. Generate Audio (Parallel-ish)
    const segmentsWithAudio = [...currentSegments];
    
    const audioPromises = segmentsWithAudio.map(async (seg, index) => {
        try {
            updateSegmentStatus(seg.id, 'audioStatus', SegmentStatus.GENERATING);
            const audioUrl = await generateSpeech(seg.spokenText);
            
            // Update local state
            setSegments(prev => prev.map(s => 
                s.id === seg.id 
                ? { ...s, audioStatus: SegmentStatus.COMPLETED, audioUrl } 
                : s
            ));
        } catch (e) {
            console.error(`Audio gen failed for ${seg.id}`, e);
            updateSegmentStatus(seg.id, 'audioStatus', SegmentStatus.ERROR);
        }
    });

    await Promise.all(audioPromises);

    // 2. Generate Video (Sequential to avoid overwhelming browser/api or hitting rate limits hard)
    // Veo needs a key check first
    let canGenVideo = true;
    try {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            if (!hasKey) {
                 // We don't block audio, but we can't do video without key selection
                 // Usually the user does this before. If not, we skip video auto-generation.
                 canGenVideo = false;
            }
        }
    } catch(e) {
        canGenVideo = false;
    }

    if (canGenVideo) {
        for (const seg of segmentsWithAudio) {
            try {
                updateSegmentStatus(seg.id, 'videoStatus', SegmentStatus.GENERATING);
                const videoUrl = await generateActionVideo(seg.actionDescription);
                
                setSegments(prev => prev.map(s => 
                    s.id === seg.id 
                    ? { ...s, videoStatus: SegmentStatus.COMPLETED, videoUrl } 
                    : s
                ));
            } catch (e) {
                console.error(`Video gen failed for ${seg.id}`, e);
                updateSegmentStatus(seg.id, 'videoStatus', SegmentStatus.ERROR);
            }
        }
    }

    setState('ready');
  };

  const updateSegmentStatus = (id: string, type: 'audioStatus' | 'videoStatus', status: SegmentStatus) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, [type]: status } : s));
  };

  const handleApiKeySelection = async () => {
      if (window.aistudio) {
          try {
              await window.aistudio.openSelectKey();
              // Assume success as per guidelines, but we can check hasSelectedApiKey again if needed
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
                AI Rehearsal Coach
            </h1>
        </div>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Transform your text prompt into a fully staged rehearsal with AI-generated voice and performance video.
        </p>
        
        {/* Veo Key Selection Button */}
        <div className="pt-2">
             <button 
                onClick={handleApiKeySelection}
                className="text-xs text-gray-500 hover:text-indigo-400 underline decoration-dotted underline-offset-4"
             >
                Manage API Key (Required for Video)
             </button>
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
              disabled={state !== 'input' && state !== 'ready' && state !== 'scripting'} // Allow retry if ready
              placeholder="e.g., You are giving a toast at a best friend's wedding..."
              className="w-full h-32 bg-gray-900 border border-gray-700 rounded-xl p-4 text-white placeholder-gray-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-all"
            />
            
            {error && (
              <div className="mt-3 flex items-center text-red-400 text-sm bg-red-400/10 p-2 rounded-lg">
                <AlertCircle className="w-4 h-4 mr-2" />
                {error}
              </div>
            )}

            <button
              onClick={handleGenerateScript}
              disabled={!prompt.trim() || state === 'scripting' || state === 'generating_media'}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-bold text-lg flex items-center justify-center transition-all shadow-lg hover:shadow-indigo-500/25"
            >
              {state === 'scripting' ? (
                <>
                  <Loader2 className="animate-spin mr-2" /> Scripting...
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

          {/* Script Segment List Status */}
          {segments.length > 0 && (
            <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden shadow-xl">
               <div className="p-4 bg-gray-800/50 border-b border-gray-700">
                  <h3 className="font-semibold text-gray-200">Scene Breakdown</h3>
               </div>
               <div className="max-h-[500px] overflow-y-auto p-4 space-y-3">
                  {segments.map((seg, idx) => (
                    <div key={seg.id} className="bg-gray-900/50 p-4 rounded-xl border border-gray-700/50">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-xs font-mono text-gray-500 uppercase">Segment {idx + 1}</span>
                            <div className="flex space-x-2">
                                <StatusBadge type="Audio" status={seg.audioStatus} />
                                <StatusBadge type="Video" status={seg.videoStatus} />
                            </div>
                        </div>
                        <p className="text-sm text-gray-300 mb-2 italic">"{seg.spokenText}"</p>
                        <div className="flex items-center text-xs text-indigo-300 bg-indigo-900/20 px-2 py-1 rounded w-fit">
                            <Video className="w-3 h-3 mr-1" />
                            {seg.actionDescription}
                        </div>
                    </div>
                  ))}
               </div>
            </div>
          )}

        </div>

        {/* Right Column: Player */}
        <div className="lg:col-span-8 flex flex-col">
            {segments.length > 0 ? (
                <Player segments={segments} />
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
            {state === 'generating_media' && (
                <div className="mt-6 p-4 bg-indigo-900/20 border border-indigo-500/30 rounded-xl text-indigo-200 text-sm flex items-start">
                    <Loader2 className="w-5 h-5 mr-3 animate-spin shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold">Production in progress...</p>
                        <p className="opacity-80 mt-1">
                            Audio generation is fast. Video generation (Veo) takes longer (several minutes). 
                            The player will update automatically as assets become available.
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