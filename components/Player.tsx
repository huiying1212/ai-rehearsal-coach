import React, { useState, useEffect, useRef } from 'react';
import { ScriptSegment, SegmentStatus } from '../types';
import { Play, Pause, RotateCcw, User, Download, Loader2, Presentation } from 'lucide-react';
import { base64ToDataUrl } from '../services/geminiService';
import { exportVideo, canExportVideo } from '../services/videoExportService';
import SlideRenderer from './SlideRenderer';
import './SlideRenderer.scss';

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
  const readySegments = segments.filter(
    (s) => s.audioStatus === SegmentStatus.COMPLETED
  );

  const currentSegment = currentIndex >= 0 ? readySegments[currentIndex] : null;

  useEffect(() => {
    if (!isPlaying || !currentSegment) return;

    // Set up Audio
    if (audioRef.current) {
      audioRef.current.src = currentSegment.audioUrl || '';
      audioRef.current.play().catch(e => console.error("Audio play failed", e));
      
      // When audio ends, move to next
      audioRef.current.onended = () => {
        handleNext();
      };
    }

    // Set up Video
    if (videoRef.current) {
      if (currentSegment.videoUrl && currentSegment.videoStatus === SegmentStatus.COMPLETED) {
        videoRef.current.src = currentSegment.videoUrl;
        videoRef.current.loop = false; // Play once only
        videoRef.current.play().catch(e => console.error("Video play failed", e));
      } else {
        videoRef.current.src = "";
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

  // Handle video export
  const handleExport = async () => {
    if (exportState.isExporting) return;
    
    setExportState({ isExporting: true, stage: 'Preparing...', progress: 0 });
    
    try {
      await exportVideo(segments, (progress) => {
        const stageLabels: Record<string, string> = {
          'preparing': 'Preparing...',
          'loading': `Loading media (${progress.currentSegment}/${progress.totalSegments})...`,
          'rendering': `Rendering (${progress.currentSegment}/${progress.totalSegments})...`,
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

  const showExportButton = canExportVideo(segments);

  // Determine what to show in the video area
  const hasVideo = currentSegment?.videoUrl && currentSegment.videoStatus === SegmentStatus.COMPLETED;
  const showCharacterFallback = !hasVideo && characterImage;

  // Get current slide design
  const currentSlide = currentSegment?.slideDesign || null;

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl border border-gray-700">
      {/* Main Stage Area - 16:9 aspect ratio for presentation style */}
      <div className="relative aspect-video bg-gradient-to-br from-slate-900 to-slate-800">
        {/* Slide Area - Main content */}
        <div className="absolute inset-0 p-4 pr-[220px]">
          <div className="w-full h-full rounded-xl overflow-hidden shadow-2xl">
            {currentSlide ? (
              <SlideRenderer slide={currentSlide} />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-400">
                <Presentation className="w-16 h-16 mb-4 opacity-30" />
                <p className="text-lg font-medium">Presentation Slides</p>
                <p className="text-sm opacity-60">Start rehearsal to see slides</p>
              </div>
            )}
          </div>
        </div>

        {/* Video/Character Area - Bottom right corner */}
        <div className="absolute right-4 bottom-4 w-[200px] aspect-[9/16] max-h-[calc(100%-2rem)] bg-black rounded-xl overflow-hidden shadow-2xl border-2 border-slate-600">
          {hasVideo ? (
            <video 
              ref={videoRef}
              className="w-full h-full object-cover"
              muted 
              playsInline
            />
          ) : showCharacterFallback ? (
            <div className="relative w-full h-full">
              <img 
                src={base64ToDataUrl(characterImage)} 
                alt="Character"
                className={`w-full h-full object-cover ${isPlaying ? '' : 'opacity-70'}`}
              />
              {isPlaying && (
                <div className="absolute bottom-2 left-2 right-2 bg-yellow-900/90 text-yellow-300 text-[10px] px-2 py-1 rounded flex items-center justify-center">
                  <User className="w-3 h-3 mr-1" />
                  Audio Only
                </div>
              )}
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500">
              <User className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs text-center px-2">Presenter</p>
            </div>
          )}
        </div>

        {/* Play overlay when not playing */}
        {!isPlaying && segments.length > 0 && (
          <div 
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center cursor-pointer bg-black/20 hover:bg-black/30 transition-colors"
          >
            <div className="bg-indigo-600/90 p-5 rounded-full shadow-lg transform hover:scale-110 transition-transform">
              <Play className="w-10 h-10 text-white" />
            </div>
          </div>
        )}

        {/* Subtitle bar at bottom */}
        {currentSegment && (
          <div className="absolute bottom-4 left-4 right-[230px]">
            <div className="bg-black/80 backdrop-blur-sm px-4 py-2.5 rounded-lg border border-white/10">
              <p className="text-sm text-white font-medium leading-relaxed">
                "{currentSegment.spokenText}"
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
              title="Export video with slides"
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
