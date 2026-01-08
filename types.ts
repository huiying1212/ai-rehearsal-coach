export enum SegmentStatus {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

// 手势类型分类
export enum GestureType {
  NONE = 'none',           // 无手势 - 使用静态图片
  BEAT = 'beat',           // 节拍手势 - 自然的说话节拍动作
  DEICTIC = 'deictic',     // 指示手势 - 指向某个方向或物体
  ICONIC = 'iconic',       // 形象手势 - 模拟具体事物的形状或动作
  METAPHORIC = 'metaphoric' // 隐喻手势 - 表达抽象概念
}

export interface ScriptSegment {
  id: string;
  spokenText: string;
  gestureType: GestureType;
  gestureDescription?: string; // 仅当 gestureType 为 deictic/iconic/metaphoric 时有值
  slideDesign?: SlideDesign;
  audioStatus: SegmentStatus;
  videoStatus: SegmentStatus;
  audioUrl?: string; // Blob URL for audio
  videoUrl?: string; // Remote URL for Veo video
  audioDuration?: number;
  // 视频相关的时间信息
  videoStartTime?: number; // 在总时间轴上的开始时间
  videoEndTime?: number;   // 在总时间轴上的结束时间
  videoDuration?: number;  // 视频实际时长
}

export interface RehearsalState {
  segments: ScriptSegment[];
  status: 'input' | 'scripting' | 'generating_character' | 'editing' | 'generating_media' | 'ready';
}

export interface SlideDesign {
  title: string;
  type: 'text' | 'list';
  content?: string;
  items?: string[];
}

export interface GeminiScriptResponse {
  script: Array<{
    spoken_text: string;
    gesture_type: 'none' | 'beat' | 'deictic' | 'iconic' | 'metaphoric';
    gesture_description?: string; // 仅当 gesture_type 为 deictic/iconic/metaphoric 时存在
    slide_design: {
      title: string;
      type: 'text' | 'list';
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
