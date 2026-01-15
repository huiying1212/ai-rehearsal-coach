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
    
    Create a rehearsal script. Break the performance down into **fine-grained segments**.
    
    **CRITICAL SEGMENT LENGTH RULES:**
    - Each video segment is FIXED at 8 seconds (Veo API limitation with reference images)
    - Each 'spoken_text' should be 1 short sentence or phrase that can be spoken in 4-5 seconds
    - English: approximately 10-15 words per segment (shorter is better)
    - Chinese: approximately 15-25 characters per segment (shorter is better)
    - If content is longer, split it into multiple segments
    - Aim for 3-5 segments total for a typical presentation
    - Leave ~2-3 seconds buffer at the end for the character to return to neutral pose
    
    For each segment, analyze what gesture category is most appropriate:
    
    **Gesture Categories:**
    - "none": No gesture needed - speaker maintains neutral posture (use sparingly, only for pauses or transitions)
    - "beat": Beat gesture - natural rhythmic movements that accompany speech using full body (most common, use for general speaking)
    - "deictic": Deictic/Pointing gesture - pointing to something specific using arms, hands, or body orientation (use when referring to directions, locations, or specific items)
    - "iconic": Iconic gesture - mimics the shape or action of something concrete using full-body movements (use when describing physical objects, sizes, movements, actions)
    - "metaphoric": Metaphoric gesture - represents abstract concepts with physical gestures using expressive body language (use when emphasizing key concepts, abstract ideas, emotions)
    
    **Important Guidelines:**
    - Most segments should use "beat" (natural speaking rhythm)
    - Use "none" only for pauses or transitions between major topics
    - Use "deictic", "iconic", or "metaphoric" when the content is highly visual or emphatic
    - For "deictic", "iconic", or "metaphoric" gestures, you MUST provide a detailed 'gesture_description'
    - For "beat" and "none" gestures, do NOT include 'gesture_description'
    - When writing gesture_description, encourage FULL-BODY movements (arms, legs, torso, stepping, turning) not just hand gestures
    - Make gesture descriptions dynamic and vibrant, describing how the whole body should move
    
    For each segment, provide:
    1. 'spoken_text': What the speaker should say. **Keep it to ONE short sentence or phrase (10-15 words max for English, 15-25 characters max for Chinese)**.
    2. 'gesture_type': One of "none", "beat", "deictic", "iconic", "metaphoric"
    3. 'gesture_description': (ONLY for deictic/iconic/metaphoric) A detailed description of the full-body gesture
       - Include arm/hand movements, body position, leg/foot actions, and overall body engagement
       - Example: "Steps forward with right foot while sweeping both arms wide, then brings hands together at chest level, engaging whole body"
       - Example: "Points to the right with extended arm while turning torso and stepping in that direction"
    
    Additionally, provide:
    - 'character_description': Describes the speaker's appearance (brief, e.g., "A confident woman in a navy blazer with shoulder-length dark hair")
    - 'character_personality': Describes the character's personality, movement style, energy level, and behavioral traits that should guide their actions
      Examples:
      * "Energetic and enthusiastic, moves with quick, animated gestures. Confident and engaging."
      * "Calm and measured, moves slowly and deliberately. Wise and thoughtful demeanor."
      * "Young and nervous, fidgets occasionally. Tentative but earnest in delivery."
      * "Bold and commanding, uses expansive gestures. Authoritative presence."
    
    Return a JSON object with 'script' array, 'character_description' string, and 'character_personality' string.
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

  // Craft a prompt optimized for generating a clean, full-body reference image
  const prompt = `
    Generate an image of: ${characterDescription}.
    
    Full body shot showing the complete character from head to toe.
    Standing upright in a neutral pose (arms relaxed at sides if applicable).
    Front view, eye-level perspective, facing directly forward.
    Isolated on pure white background, no props, no shadows, no other objects.
    Neutral, even lighting with no dramatic shadows.
    Professional reference image style, high resolution, clean and crisp.
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

  // 根据手势类型构建不同的提示词
  let actionPrompt: string;
  
  // 添加场景上下文（如果提供）
  const contextPrefix = scenario ? `Context: This is for a ${scenario}.\n` : '';
  
  // 添加角色性格描述（如果提供）
  const personalityPrefix = characterPersonality 
    ? `Character personality and movement style: ${characterPersonality}\n` 
    : '';
  
  if (gestureType === 'beat') {
    // Beat 手势：根据说话内容和角色特点自然生成动作，不包含具体手势描述
    actionPrompt = `
      ${contextPrefix}${personalityPrefix}A character performing actions naturally based on what they are saying: "${spokenText}"
      
      The character should use FULL-BODY movements including:
      - Arms and hands expressing the content naturally
      - Body posture changes (leaning, turning, rotating torso)
      - Leg movements (stepping, shifting weight, stance changes)
      - Head movements and facial expressions
      - Dynamic, vibrant gestures that engage the whole body
      
      Encourage active, energetic movements that match the character's personality and speaking style.
      The character can move freely within the frame - walking, stepping, gesturing expansively.
      Don't limit movements to just hands and arms - use the entire body to communicate.
    `.trim();
  } else {
    // Deictic/Iconic/Metaphoric 手势：包含具体的手势描述
    actionPrompt = `
      ${contextPrefix}${personalityPrefix}${gestureDescription || 'Natural gesture'}.
      The character is saying: "${spokenText}"
      
      Perform this specific gesture with FULL-BODY engagement:
      - Use arms, hands, and the entire upper body
      - Engage legs and feet (stepping, stance changes, weight shifts)
      - Include torso movements (turning, leaning, rotating)
      - Add dynamic body language beyond just arm gestures
      - Make the gesture vibrant and physically expressive
      
      The character should move actively and dynamically, using their whole body to express themselves naturally.
      Don't just move hands - engage legs, torso, and full body in the performance.
    `.trim();
  }

  // 完整的视频生成提示词
  const prompt = `
    ${actionPrompt}
    
    Camera and scene requirements:
    - Static camera position, no zoom, no panning, no camera movement
    - Frame the character so their ENTIRE BODY (head to feet) is ALWAYS visible in the frame
    - The character can move freely within the frame (walking, stepping, turning)
    - Allow the character to use the full space while keeping them centered and fully visible
    - Pure white background with no shadows or props
    - Smooth, natural, dynamic human movement with full-body engagement
    
    Movement style guidelines:
    - Encourage vibrant, active movements using arms, legs, torso, and whole body
    - Allow stepping, walking, turning, and full-body gestures
    - Make movements expressive and dynamic, not just hand/arm gestures
    - If the character's personality is energetic, use expansive, active movements
    - If the context is theatrical, allow bold, exaggerated full-body expressions
    - Ensure all body parts (head, torso, arms, legs, feet) remain visible throughout
    
    Frame consistency:
    - The video should start and end with the character in the same pose as the reference image
    - Keep the entire character visible from head to toe at all times
  `.trim();

  const logText = gestureType === 'beat' 
    ? spokenText.substring(0, 50) 
    : (gestureDescription?.substring(0, 50) || spokenText.substring(0, 50));
  console.log(`[Veo] Starting ${gestureType} gesture video (${videoDuration}s) for: "${logText}..."`);

  // 将同一张图片同时设置为首帧和尾帧，确保视频首尾一致
  // 参考文档: https://ai.google.dev/gemini-api/docs/video
  // Frame-specific generation: Generate a video by specifying the first and last frames.
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
      aspectRatio: '9:16', // Match the character image aspect ratio
      durationSeconds: videoDuration, // 指定视频时长
      // 设置尾帧为同一张图片，确保视频首尾一致（角色回到初始姿势）
      lastFrame: {
        imageBytes: referenceImageBase64,
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
