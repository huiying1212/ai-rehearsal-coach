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
    
    Create a rehearsal script. Break the performance down into 3 to 5 distinct segments.
    For each segment, provide:
    1. 'spoken_text': What the speaker should say. (Keep it concise, ~1-2 sentences per segment).
    2. 'action_description': A visual description of the body language, gesture, or movement the speaker should perform (e.g., "Spread arms wide to show openness", "Point to a chart on the right").
    
    Return the response strictly as a JSON object with a 'script' array.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
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
                action_description: { type: Type.STRING }
              }
            }
          }
        }
      }
    }
  });

  return JSON.parse(response.text || '{"script": []}');
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

export const generateActionVideo = async (actionDescription: string): Promise<string> => {
  // CRITICAL: Ensure we have a fresh client for Veo calls which might require specific key permissions
  const ai = getAIClient();

  // Veo requires specific prompting to get good results for human actions
  const prompt = `A professional speaker on a stage. ${actionDescription}. High quality, cinematic lighting, 4k.`;

  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: '16:9'
    }
  });

  // Polling loop
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  
  if (!downloadLink) {
    throw new Error("Video generation failed or returned no URI");
  }

  // We need to fetch the video to avoid CORS issues or key appending in the <video> tag if possible,
  // or return the link with the key appended as per instructions.
  // Instruction says: "You must append an API key when fetching from the download link."
  return `${downloadLink}&key=${process.env.API_KEY}`;
};