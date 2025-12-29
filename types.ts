export enum SegmentStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

// Slide design types matching whiteboard's display_content structure
export interface SlideImage {
  url: string;
  description: string;
}

export interface SlideDesign {
  title: string;
  type: 'text' | 'list' | 'images';
  content?: string; // For text type
  items?: string[]; // For list type
  images?: SlideImage[]; // For images type
}

export interface ScriptSegment {
  id: string;
  spokenText: string;
  actionDescription: string;
  slideDesign: SlideDesign; // New field for slide generation
  audioStatus: SegmentStatus;
  videoStatus: SegmentStatus;
  audioUrl?: string; // Blob URL for audio
  videoUrl?: string; // Remote URL for Veo video
  audioDuration?: number;
}

export interface RehearsalState {
  segments: ScriptSegment[];
  status: 'input' | 'scripting' | 'generating_character' | 'editing' | 'generating_media' | 'ready';
}

export interface GeminiScriptResponse {
  script: Array<{
    spoken_text: string;
    action_description: string;
    slide_design: {
      title: string;
      type: 'text' | 'list' | 'images';
      content?: string;
      items?: string[];
    };
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
