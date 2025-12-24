import React, { useState } from 'react';
import { Sparkles, Video, Mic, AlertCircle, Loader2, User, ImageIcon } from 'lucide-react';
import { generateRehearsalScript, generateSpeech, generateActionVideo, generateCharacterImage, base64ToDataUrl } from './services/geminiService';
import { ScriptSegment, SegmentStatus, RehearsalState, GeminiScriptResponse, CharacterStatus } from './types';
import Player from './components/Player';

// Declare global for the key selection
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
        actionDescription: item.action_description,
        audioStatus: SegmentStatus.IDLE,
        videoStatus: SegmentStatus.IDLE,
      }));

      setSegments(newSegments);
      setCharacterDescription(result.character_description);
      
      // Step 2: Generate character image (定妆照)
      setState('generating_character');
      setCharacterStatus(CharacterStatus.GENERATING);
      
      let imageBase64: string | null = null;
      try {
        imageBase64 = await generateCharacterImage(result.character_description);
        setCharacterImageBase64(imageBase64);
        setCharacterStatus(CharacterStatus.COMPLETED);
      } catch (imgErr) {
        console.error("Character image generation failed:", imgErr);
        setCharacterStatus(CharacterStatus.ERROR);
        // Continue without image - video will be generated without reference frame
      }
      
      // Step 3: Generate media (audio + video)
      setState('generating_media');
      await generateMediaForSegments(newSegments, imageBase64);

    } catch (err: any) {
      console.error(err);
      setError("Failed to generate script. Please try again.");
      setState('input');
    }
  };

  const generateMediaForSegments = async (currentSegments: ScriptSegment[], referenceImage: string | null) => {
    // 1. Generate Audio (Parallel)
    const audioPromises = currentSegments.map(async (seg) => {
      try {
        updateSegmentStatus(seg.id, 'audioStatus', SegmentStatus.GENERATING);
        const audioUrl = await generateSpeech(seg.spokenText);
        
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

    // 2. Generate Video (Sequential) - only if we have reference image
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
      for (const seg of currentSegments) {
        try {
          updateSegmentStatus(seg.id, 'videoStatus', SegmentStatus.GENERATING);
          const videoUrl = await generateActionVideo(seg.actionDescription, referenceImage);
          
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
              disabled={state !== 'input' && state !== 'ready'}
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
              disabled={!prompt.trim() || (state !== 'input' && state !== 'ready')}
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

          {/* Character Image Card (定妆照) */}
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
                {/* Character Description */}
                {characterDescription && (
                  <p className="text-sm text-gray-400 mb-4 italic">
                    "{characterDescription}"
                  </p>
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
