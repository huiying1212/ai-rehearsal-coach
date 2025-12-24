import React, { useState, useEffect, useRef } from 'react';
import { ScriptSegment, SegmentStatus } from '../types';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface PlayerProps {
  segments: ScriptSegment[];
}

const Player: React.FC<PlayerProps> = ({ segments }) => {
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
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
       // If we have a generated video, use it. Otherwise, we might want a placeholder or loop the previous?
       // For now, if no video, we just show a placeholder color.
       if (currentSegment.videoUrl && currentSegment.videoStatus === SegmentStatus.COMPLETED) {
         videoRef.current.src = currentSegment.videoUrl;
         videoRef.current.play().catch(e => console.error("Video play failed", e));
         videoRef.current.loop = true; // Loop action while audio plays
       } else {
         videoRef.current.src = "";
         // Ideally clear the poster or show a "No Video" state
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

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden shadow-2xl border border-gray-700">
      {/* Stage Area */}
      <div className="relative aspect-video bg-black flex items-center justify-center">
        {currentSegment?.videoUrl && currentSegment.videoStatus === SegmentStatus.COMPLETED ? (
          <video 
            ref={videoRef}
            className="w-full h-full object-cover"
            muted 
            playsInline
          />
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
                <div className="inline-block bg-black/60 backdrop-blur-sm px-6 py-3 rounded-lg border border-white/10">
                    <p className="text-xl md:text-2xl font-semibold text-white mb-1">
                        "{currentSegment.spokenText}"
                    </p>
                    <p className="text-sm text-indigo-300 uppercase tracking-wider font-bold">
                        Action: {currentSegment.actionDescription}
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
        </div>
        <div className="text-gray-400 text-sm">
            {currentIndex >= 0 ? `Segment ${currentIndex + 1} / ${readySegments.length}` : 'Ready'}
        </div>
      </div>
    </div>
  );
};

export default Player;