export enum SegmentStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface ScriptSegment {
  id: string;
  spokenText: string;
  actionDescription: string;
  audioStatus: SegmentStatus;
  videoStatus: SegmentStatus;
  audioUrl?: string; // Blob URL for audio
  videoUrl?: string; // Remote URL for Veo video
  audioDuration?: number;
}

export interface RehearsalState {
  segments: ScriptSegment[];
  status: 'input' | 'scripting' | 'generating_character' | 'generating_media' | 'ready';
}

export interface GeminiScriptResponse {
  script: Array<{
    spoken_text: string;
    action_description: string;
  }>;
  character_description: string;
}

// Character image generation status
export enum CharacterStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}
