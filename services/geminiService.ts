import { GoogleGenAI, Modality, Type } from "@google/genai";
import { decodeBase64, decodeAudioData, audioBufferToWavBlobUrl } from "./audioUtils";

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
  const prompt = `
    You are an expert presentation coach and director specializing in gesture analysis.
    The user wants to rehearse for the following scenario: "${scenario}".
    
    Create a rehearsal script. Break the performance down into 3 to 5 distinct segments.
    
    For each segment, analyze what gesture category is most appropriate:
    
    **Gesture Categories:**
    - "none": No gesture needed - speaker maintains neutral posture
    - "beat": Beat gesture - natural rhythmic hand movements that accompany speech (most common, use for general speaking)
    - "deictic": Deictic/Pointing gesture - pointing to something specific (use when referring to directions, locations, or specific items)
    - "iconic": Iconic gesture - mimics the shape or action of something concrete (use when describing physical objects, sizes, movements)
    - "metaphoric": Metaphoric gesture - represents abstract concepts with physical gestures (use when emphasizing key concepts, abstract ideas, emotions)
    
    **Important Guidelines:**
    - Most segments should use "beat" (natural speaking rhythm) or "none"
    - Only use "deictic", "iconic", or "metaphoric" when the content is highly visual, emphasizes key concepts, or requires specific physical representation
    - For "deictic", "iconic", or "metaphoric" gestures, you MUST provide a detailed 'gesture_description' explaining the specific movement
    - For "beat" and "none" gestures, do NOT include 'gesture_description'
    
    For each segment, provide:
    1. 'spoken_text': What the speaker should say. Keep it concise (1-2 sentences).
    2. 'gesture_type': One of "none", "beat", "deictic", "iconic", "metaphoric"
    3. 'gesture_description': (ONLY for deictic/iconic/metaphoric) A brief description of the specific gesture
    4. 'slide_design': Object with 'title', 'type' ("text" or "list"), and 'content' or 'items'
    
    Additionally, provide a 'character_description' field that describes the speaker's appearance.
    Keep it brief, e.g.: "A confident woman in a navy blazer with shoulder-length dark hair"
    
    Return a JSON object with 'script' array and 'character_description' string.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
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
                gesture_description: { type: Type.STRING },
                slide_design: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ['text', 'list'] },
                    content: { type: Type.STRING },
                    items: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ['title', 'type']
                }
              },
              required: ['spoken_text', 'gesture_type', 'slide_design']
            }
          },
          character_description: { type: Type.STRING }
        },
        required: ['script', 'character_description']
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
 */
export const generateCharacterImage = async (characterDescription: string): Promise<string> => {
  const ai = getAIClient();

  // Craft a prompt optimized for generating a clean, full-body reference image
  const prompt = `
    Generate an image of: ${characterDescription}.
    
    Full body shot from head to toe.
    Standing upright in a neutral pose with arms relaxed at sides.
    Front view, eye-level perspective, looking directly at camera.
    Isolated on pure white background, no props, no shadows, no other objects.
    Neutral, even lighting with no dramatic shadows.
    Professional photography style, high resolution, clean and crisp.
  `.trim();

  // Use Gemini's native image generation capability
  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-exp',
    contents: prompt,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
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
    model: 'gemini-2.5-flash-preview-tts',
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
 * - Beat: Generate natural speaking movements based on spoken text only
 * - Deictic/Iconic/Metaphoric: Include detailed gesture description in prompt
 * 
 * Video duration is determined by the model itself.
 */
export const generateActionVideo = async (
  gestureType: GestureTypeValue,
  spokenText: string,
  gestureDescription: string | undefined, 
  referenceImageBase64: string
): Promise<VideoGenerationResult> => {
  const ai = getAIClient();

  // 根据手势类型构建不同的提示词
  let actionPrompt: string;
  
  if (gestureType === 'beat') {
    // Beat 手势：根据说话内容自然生成动作，不包含具体手势描述
    actionPrompt = `
      A person speaking naturally with rhythmic beat gestures.
      They are saying: "${spokenText}"
      
      Generate natural speaking movements:
      - Subtle hand movements that emphasize speech rhythm
      - Natural head movements and expressions
      - Body language appropriate for conversational speaking
      - No exaggerated or specific gestures, just natural speaking motion
    `.trim();
  } else {
    // Deictic/Iconic/Metaphoric 手势：包含具体的手势描述
    actionPrompt = `
      ${gestureDescription || 'Natural gesture'}.
      The person is saying: "${spokenText}"
      
      Perform this specific gesture while speaking naturally.
    `.trim();
  }

  // 完整的视频生成提示词
  const prompt = `
    ${actionPrompt}
    
    Camera and scene requirements:
    - Static camera, no zoom, no panning, no camera movement
    - Character remains centered in frame
    - Maintain consistent scale throughout
    - Pure white background, minimal background movement
    - Smooth, natural human movement
    - Professional demonstration style
    - The video should start and end with the character in the same pose as the reference image
  `.trim();

  const logText = gestureType === 'beat' 
    ? spokenText.substring(0, 50) 
    : (gestureDescription?.substring(0, 50) || spokenText.substring(0, 50));
  console.log(`[Veo] Starting ${gestureType} gesture video for: "${logText}..."`);

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    image: {
      imageBytes: referenceImageBase64,
      mimeType: 'image/png'
    },
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '9:16' // Match the character image aspect ratio
      // 不指定 durationSeconds，让模型自己决定时长
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
