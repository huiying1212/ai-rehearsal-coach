import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, decodeAudioData, audioBufferToWavBlobUrl } from "./audioUtils";
import { getScriptPrompt, getImagePrompt, getVideoPrompt } from "../prompts";

// Fix for: Property 'webkitAudioContext' does not exist on type 'Window & typeof globalThis'
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

// Initialize AI Client
// Note: We re-initialize inside functions if we need to ensure the latest key is picked up
// but for general usage we can use a factory function.
const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateRehearsalScript = async (scenario: string) => {
  const ai = getAIClient();
  const prompt = getScriptPrompt(scenario);

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          script: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                spoken_text: { type: Type.STRING },
                gesture_type: { 
                  type: Type.STRING,
                  enum: ['none', 'beat', 'deictic', 'iconic', 'metaphoric']
                },
                gesture_description: { type: Type.STRING }
              },
              required: ['spoken_text', 'gesture_type']
            }
          },
          character_description: { type: Type.STRING },
          character_personality: { type: Type.STRING }
                  },
        required: ['script', 'character_description', 'character_personality']
      }
    }
  });

  const responseText = response.text;
  
  if (!responseText) {
    throw new Error("No response text from script generation");
  }

  try {
    return JSON.parse(responseText);
  } catch (e) {
    console.error("Failed to parse script response:", responseText.substring(0, 500));
    throw new Error("Invalid JSON response from script generation");
  }
};

/**
 * Generate a character "costume photo" (定妆照) based on the character description.
 * Uses Gemini's native image generation to create a full-body shot on a pure white background.
 * The character can be a human, animal, cartoon character, or any other form.
 */
export const generateCharacterImage = async (characterDescription: string): Promise<string> => {
  const ai = getAIClient();

  // 使用拆分出来的 prompt 模板
  const prompt = getImagePrompt(characterDescription);

  // Use Nano Banana Pro (Gemini 3 Pro Image) for high-quality professional image generation
  // Using 1K resolution to avoid connection issues with large responses
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: prompt,
    config: {
      responseModalities: [Modality.IMAGE],  // Only request image, not text
      imageConfig: {
        aspectRatio: '3:4',  // 竖屏 4:3 (宽:高 = 3:4，即高度更大)
        imageSize: '1K'      // 使用 1K 避免响应过大导致连接关闭
      }
    }
  });

  // Extract image from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("No content returned from image generation");
  }

  // Find the image part in the response
  for (const part of parts) {
    if (part.inlineData?.mimeType?.startsWith('image/')) {
      return part.inlineData.data || '';
    }
  }

  throw new Error("No image data found in response");
};

export const generateSpeech = async (text: string): Promise<string> => {
  const ai = getAIClient();
  
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',  // TTS 继续使用 2.5 模型（3.0 暂无 TTS 变体）
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Kore' }, // Professional sounding voice
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  
  if (!base64Audio) {
    throw new Error("No audio data returned");
  }

  // Decode and convert to Blob URL
  const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
  const audioBuffer = await decodeAudioData(decodeBase64(base64Audio), audioContext, 24000, 1);
  return audioBufferToWavBlobUrl(audioBuffer);
};

/**
 * 手势类型定义 - 与 types.ts 保持一致
 */
export type GestureTypeValue = 'none' | 'beat' | 'deictic' | 'iconic' | 'metaphoric';

/**
 * 视频生成结果，包含URL和实际时长
 */
export interface VideoGenerationResult {
  videoUrl: string;
  videoDuration?: number; // 视频实际时长（秒）
}

/**
 * Generate action video using the character reference image as both start and end frame.
 * Video generation differs based on gesture type:
 * - Beat: Generate natural actions based on spoken text and character traits
 * - Deictic/Iconic/Metaphoric: Include detailed gesture description in prompt
 * 
 * NOTE: When using reference images, Veo API only supports 8-second videos.
 * See: https://ai.google.dev/gemini-api/docs/video#limitations
 * "8 seconds only when using reference images"
 */
export const generateActionVideo = async (
  gestureType: GestureTypeValue,
  spokenText: string,
  gestureDescription: string | undefined, 
  referenceImageBase64: string,
  scenario?: string,
  characterPersonality?: string
): Promise<VideoGenerationResult> => {
  const ai = getAIClient();

  // Veo API 视频时长限制：
  // - 纯文本生成：支持 4秒、6秒、8秒
  // - 使用参考图片(reference images)：只支持 8秒
  // 参考：https://ai.google.dev/gemini-api/docs/video#limitations
  // "8 seconds only when using reference images"
  
  // 由于我们使用角色定妆照作为参考图片，所以只能使用 8 秒
  const videoDuration = 8;

  // 使用拆分出来的 prompt 模板
  const prompt = getVideoPrompt({
    gestureType,
    spokenText,
    gestureDescription,
    scenario,
    characterPersonality
  });

  const logText = gestureType === 'beat' 
    ? spokenText.substring(0, 50) 
    : (gestureDescription?.substring(0, 50) || spokenText.substring(0, 50));
  console.log(`[Veo] Starting ${gestureType} gesture video (${videoDuration}s) for: "${logText}..."`);

  // 将同一张图片同时设置为首帧和尾帧，确保视频首尾一致
  // 参考文档: https://ai.google.dev/gemini-api/docs/video
  // Frame-specific generation: Generate a video by specifying the first and last frames.
  
  // 确保 base64 数据不包含 data URL 前缀
  const cleanBase64 = referenceImageBase64.replace(/^data:image\/\w+;base64,/, '');
  
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    image: {
      imageBytes: cleanBase64,
      mimeType: 'image/png'
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '9:16', // 竖屏视频格式 (宽:高 = 9:16)，适合展示全身动作
      durationSeconds: videoDuration, // 指定视频时长
      // 设置尾帧为同一张图片，确保视频首尾一致（角色回到初始姿势）
      lastFrame: {
        imageBytes: cleanBase64,
        mimeType: 'image/png'
      }
    }
  });

  console.log(`[Veo] Operation started, polling for completion...`);

  // Polling loop with timeout (max 5 minutes)
  const maxAttempts = 60; // 60 * 5s = 5 minutes
  let attempts = 0;
  
  while (!operation.done && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
    attempts++;
    console.log(`[Veo] Polling attempt ${attempts}...`);
    
    try {
      operation = await ai.operations.getVideosOperation({ operation: operation });
    } catch (pollError) {
      console.error(`[Veo] Polling error:`, pollError);
      throw new Error(`Video polling failed: ${pollError}`);
    }
  }

  if (!operation.done) {
    throw new Error("Video generation timed out after 5 minutes");
  }

  // Log the full response for debugging
  console.log(`[Veo] Operation completed. Response:`, JSON.stringify(operation.response, null, 2));

  // Check for safety filter rejection
  if (operation.response?.raiMediaFilteredCount && operation.response.raiMediaFilteredCount > 0) {
    const reasons = operation.response.raiMediaFilteredReasons?.join('; ') || 'Unknown reason';
    console.warn(`[Veo] Video was filtered by safety system: ${reasons}`);
    throw new Error(`Video filtered by safety system. Try rephrasing the action description.`);
  }

  // Check for errors in response
  const generatedVideo = operation.response?.generatedVideos?.[0];
  
  if (!generatedVideo) {
    console.error(`[Veo] No generated video in response:`, operation.response);
    throw new Error("Video generation returned no video data");
  }

  const downloadLink = generatedVideo.video?.uri;
  
  if (!downloadLink) {
    console.error(`[Veo] No URI in generated video:`, generatedVideo);
    throw new Error("Video generation completed but returned no URI");
  }

  console.log(`[Veo] Video generated successfully: ${downloadLink.substring(0, 100)}...`);

  // 返回视频URL（带API key）和可能的时长信息
  return {
    videoUrl: `${downloadLink}&key=${process.env.API_KEY}`,
    // 如果API返回了时长信息，可以在这里提取
    videoDuration: undefined // Veo API 目前不在响应中返回时长，需要在客户端加载视频后获取
  };
};

/**
 * Helper function to convert base64 image to a data URL for display
 */
export const base64ToDataUrl = (base64: string, mimeType: string = 'image/png'): string => {
  return `data:${mimeType};base64,${base64}`;
};
