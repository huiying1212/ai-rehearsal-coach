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
    You are an expert presentation coach and director.
    The user wants to rehearse for the following scenario: "${scenario}".
    
    Create a rehearsal script. Break the performance down into 2 to 3 distinct segments.
    For each segment, provide:
    1. 'spoken_text': What the speaker should say. Keep it concise (1-2 sentences).
    2. 'action_description': A brief visual description of the body language or gesture (e.g., "Spread arms wide", "Point to the right").
    3. 'slide_design': The visual slide content to display alongside this segment. This will be shown as a presentation slide.
       - 'title': A short title for the slide (under 8 words)
       - 'type': Either "text", "list", or "images"
       - For "text" type: provide 'content' with 1-3 sentences (under 100 words)
       - For "list" type: provide 'items' array with 3-5 bullet points (each under 15 words)
       - Focus on KEY POINTS that visualize what the speaker is saying
    
    Additionally, provide a 'character_description' field that describes the speaker's appearance.
    Keep it brief, e.g.: "A confident man in a navy suit with short dark hair"
    
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
                action_description: { type: Type.STRING },
                slide_design: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    type: { 
                      type: Type.STRING,
                      enum: ['text', 'list', 'images']
                    },
                    content: { type: Type.STRING },
                    items: { 
                      type: Type.ARRAY,
                      items: { type: Type.STRING }
                    }
                  },
                  required: ['title', 'type']
                }
              },
              required: ['spoken_text', 'action_description', 'slide_design']
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
 * Generate action video using the character reference image as the starting frame.
 * This ensures visual consistency across all video segments.
 */
export const generateActionVideo = async (
  actionDescription: string, 
  referenceImageBase64: string
): Promise<string> => {
  const ai = getAIClient();

  // Craft a prompt that emphasizes the action while keeping camera static
  // This helps maintain consistency and focus on the body language
  const prompt = `
    ${actionDescription}.
    
    Static camera, no zoom, no panning, no camera movement.
    Character remains centered in frame.
    Maintain consistent scale throughout.
    Minimal background movement, pure white background.
    Smooth, natural human movement.
    Professional demonstration style.
  `.trim();

  console.log(`[Veo] Starting video generation for: "${actionDescription.substring(0, 50)}..."`);

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

  // Append API key for authenticated download
  return `${downloadLink}&key=${process.env.API_KEY}`;
};

/**
 * Helper function to convert base64 image to a data URL for display
 */
export const base64ToDataUrl = (base64: string, mimeType: string = 'image/png'): string => {
  return `data:${mimeType};base64,${base64}`;
};
