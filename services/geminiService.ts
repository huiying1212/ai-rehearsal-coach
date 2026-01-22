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
    - "deictic": Deictic/Pointing gesture - directing attention to something specific through body orientation and spatial reference (use when referring to directions, locations, or specific items)
    - "iconic": Iconic gesture - physically embodying or representing the essence of something concrete (use when describing physical objects, sizes, movements, actions)
    - "metaphoric": Metaphoric gesture - physically manifesting abstract concepts through expressive full-body language (use when emphasizing key concepts, abstract ideas, emotions)
    
    **Important Guidelines:**
    - Most segments should use "beat" (natural speaking rhythm)
    - Use "none" only for pauses or transitions between major topics
    - Use "deictic", "iconic", or "metaphoric" when the content is highly visual or emphatic
    - For "deictic", "iconic", or "metaphoric" gestures, you MUST provide a detailed 'gesture_description'
    - For "beat" and "none" gestures, do NOT include 'gesture_description'
    - **CRITICAL APPROACH**: Write gesture_description as HIGH-LEVEL EFFECT descriptions, NOT specific limb movements
    - Describe the FEELING, METAPHOR, or DESIRED VISUAL IMPACT rather than mechanical instructions
    - This allows the AI video model to use its creative understanding to generate natural, expressive movements
    - Think: "What effect do I want?" not "Which body parts should move?"
    - Use experiential language: "feeling the warmth of sunlight", "pushing through resistance", "welcoming embrace"
    - Use metaphorical language: "carrying heavy burden", "reaching for dreams", "building protective walls"
    - Use emotional language: "radiating confidence", "shrinking from fear", "expanding with joy"
    - **ROBOT SAFETY NOTE**: These movements will be executed by ROBOTS with only 4 limbs (2 arms, 2 legs)
      * The effect-based descriptions should naturally lead to robot-safe movements
      * Avoid effects that require: leg crossing, rapid spinning, jumping, kneeling, backward walking, or finger gestures
    
    For each segment, provide:
    1. 'spoken_text': What the speaker should say. **Keep it to ONE short sentence or phrase (10-15 words max for English, 15-25 characters max for Chinese)**.
    2. 'gesture_type': One of "none", "beat", "deictic", "iconic", "metaphoric"
    3. 'gesture_description': (ONLY for deictic/iconic/metaphoric) A HIGH-LEVEL description of the DESIRED EFFECT or FEELING, NOT specific limb movements
       - Describe WHAT THE GESTURE COMMUNICATES or the EMOTIONAL/VISUAL EFFECT it creates
       - Let the video model's imagination determine the specific body movements to achieve that effect
       - Focus on METAPHORICAL, EMOTIONAL, or EXPERIENTIAL descriptions rather than mechanical instructions
       - Examples of EFFECT-BASED gesture descriptions that leverage the video model's creativity:
         * "Basking in warm sunlight, absorbing energy and hope from above"
         * "Pushing through an invisible heavy barrier with determination"
         * "Being pulled back by doubt and hesitation, resisting forward momentum"
         * "Welcoming an old friend with open arms and genuine warmth"
         * "Feeling the weight of responsibility settling on the shoulders"
         * "Reaching for an impossible dream just beyond grasp"
         * "Celebrating a hard-won victory with triumphant energy"
         * "Shrinking away from criticism or harsh judgment"
         * "Expanding with confidence and claiming the space"
         * "Radiating warmth and invitation to draw others in"
         * "Building invisible walls for protection and boundaries"
         * "Releasing all tension and letting go of burdens"
         * "Drawing in focus and concentration from the environment"
         * "Projecting energy and passion outward to inspire"
       - **ROBOT SAFETY REMINDERS** (the video model should naturally avoid these with effect-based prompts):
         * The resulting movements should not include leg crossing, rapid spins, jumps, kneeling, backward walking
         * No finger gestures - only whole limb movements with open/closed hand positions
    
    Additionally, provide:
    - 'character_description': Describes the speaker's appearance (brief, e.g., "A confident woman in a navy blazer with shoulder-length dark hair")
    - 'character_personality': Describes the character's personality, movement style, energy level, and behavioral traits that should guide their actions to be VIVID and EXPRESSIVE
      Examples of personality descriptions that drive compelling movements:
      * "Explosively energetic and passionate, uses forceful arm sweeps and dynamic weight shifts, torso constantly engaged. Commands attention with full-body intensity."
      * "Gracefully controlled and elegant, flows between poses with smooth transitions, arms move in arcs, weight shifts are subtle but deliberate. Every movement has purpose."
      * "Playfully animated and spontaneous, alternates between quick arm gestures and dramatic pauses, takes asymmetric stances, torso sways with rhythm. Unpredictable and charming."
      * "Powerfully confident and dominant, uses wide stances and overhead arm raises, chest forward posture, movements are large and space-claiming. Radiates authority through physicality."
      * "Intensely focused and urgent, leans forward frequently, arms punch forward and pull back with tension, quick weight shifts convey drive. Every gesture shows determination."
      * "Warmly inviting and open, arms sweep outward welcoming, torso opens toward audience, gentle forward steps, movements are rounded and embracing. Physically generous and inclusive."
    
    Return a JSON object with 'script' array, 'character_description' string, and 'character_personality' string.
  `;

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

  // 根据手势类型构建不同的提示词
  let actionPrompt: string;
  
  // 添加场景上下文（如果提供）
  const contextPrefix = scenario ? `Context: This is for a ${scenario}.\n` : '';
  
  // 添加角色性格描述（如果提供）
  const personalityPrefix = characterPersonality 
    ? `Character personality and movement style: ${characterPersonality}\n` 
    : '';
  
  if (gestureType === 'beat') {
    // Beat 手势：根据说话内容和角色特点自然生成动作，使用电影化描述
    actionPrompt = `
      ${contextPrefix}${personalityPrefix}
      
      SUBJECT AND ACTION:
      A character speaks and gestures naturally: "${spokenText}"
      The character uses expressive full-body movements - arms sweeping, torso rotating, weight shifting, stepping forward or to the side.
      Arms move as whole units with hands in simple open or closed positions (no finger gestures).
      Body language matches the speech content with vivid, dynamic gestures.
      
      VISUAL STYLE:
      - Movements are DRAMATICALLY EXPRESSIVE and CHARACTER-DRIVEN
      - Create ASYMMETRIC poses (arms at different heights, weight on one leg) for visual interest
      - Vary SPEED and INTENSITY: sudden arm raises, slow weight shifts, smooth turns
      - Use FULL RANGE OF MOTION: arms fully extended, deep stances, full torso rotation
      - LAYER multiple body parts: arm gesture + torso twist + weight shift working together
      - Match movement QUALITY to emotion:
        * Power/strength: wide stance, arms overhead, closed fists
        * Welcome/openness: arms sweeping outward, open palms, forward steps
        * Urgency/excitement: quick alternating movements, forward lean
        * Importance: slow deliberate gestures, hold positions
      
      ENVIRONMENT:
      Pure white background, clean and minimal. No shadows, no props, no additional objects.
      
      LIGHTING:
      Even, neutral lighting with no dramatic shadows. Professional studio quality.
      
      CAMERA:
      Static full-body shot, eye-level perspective. The camera does not move, zoom, or pan.
      The entire character remains visible from head to toe throughout the video, centered in frame.
      
      TECHNICAL CONSTRAINTS (Robot Motion Safety):
      The movements must be robotically feasible:
      - Simple forward or side-to-side steps with feet planted (NO leg crossing, jumping, kneeling, backward walking)
      - Smooth 90-180° turns at moderate speed (NO rapid spinning)
      - Arms move as whole units at shoulder and elbow (NO finger gestures or hand articulation)
      - Hands in open palm or closed fist positions only
      - Maintain balanced upright posture, no tilting beyond safe angles
      - All movements smooth, controlled, and mechanically feasible for 4-limb robots
    `.trim();
  } else {
    // Deictic/Iconic/Metaphoric 手势：包含高层次效果描述，使用电影化语言
    actionPrompt = `
      ${contextPrefix}${personalityPrefix}
      
      SUBJECT AND ACTION:
      A character embodies the feeling: "${gestureDescription || 'Natural expressive gesture'}"
      The character speaks: "${spokenText}"
      
      Interpret this high-level description creatively, translating the DESIRED EFFECT into compelling full-body movement.
      The character physically manifests this feeling through expressive gestures - arms extending, torso rotating, weight shifting, stepping.
      Movement quality (smooth/sharp, sustained/quick, strong/gentle) matches the emotional effect.
      Use spatial relationships (up/down, in/out, expanding/contracting) to express the meaning.
      Arms move as whole units with hands in simple open or closed positions (no finger gestures).
      
      VISUAL STYLE:
      - DRAMATICALLY EXPRESSIVE and committed physical embodiment
      - Create DYNAMIC SHAPES and movements that embody the feeling
      - STRONG visual choices that clearly communicate the intended effect
      - Use FULL RANGE OF MOTION: arms fully extended, deep stances, full torso rotation
      - LAYER multiple body parts to AMPLIFY expression: arm gesture + torso twist + weight shift
      - Translate abstract description into CONCRETE, COMMITTED physical actions
      
      ENVIRONMENT:
      Pure white background, clean and minimal. No shadows, no props, no additional objects.
      
      LIGHTING:
      Even, neutral lighting with no dramatic shadows. Professional studio quality.
      
      CAMERA:
      Static full-body shot, eye-level perspective. The camera does not move, zoom, or pan.
      The entire character remains visible from head to toe throughout the video, centered in frame.
      
      TECHNICAL CONSTRAINTS (Robot Motion Safety):
      The movements must be robotically feasible:
      - Simple forward or side-to-side steps with feet planted (NO leg crossing, jumping, kneeling, backward walking)
      - Smooth 90-180° turns at moderate speed (NO rapid spinning)
      - Arms move as whole units at shoulder and elbow (NO finger gestures or hand articulation)
      - Hands in open palm or closed fist positions only
      - Maintain balanced upright posture, no tilting beyond safe angles
      - All movements smooth, controlled, and mechanically feasible for 4-limb robots
    `.trim();
  }

  // 完整的视频生成提示词 - 按照 Veo 3.1 最佳实践结构化
  const prompt = `${actionPrompt}
  
DURATION: 8 seconds

FRAME CONSISTENCY:
The video starts with the character in the reference image pose, performs the described movements, then returns to a similar neutral pose by the end.

MOTION QUALITY:
Smooth, natural, fluid human movement. Cinematic realism with lifelike body mechanics and natural timing.`.trim();

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
