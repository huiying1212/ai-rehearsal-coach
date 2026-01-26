/**
 * 文字生成 Prompt
 * 用于 generateRehearsalScript 函数
 * 
 * 使用 Gemini 3 Pro 模型生成排练脚本
 * 将用户的场景描述转换为分段的表演脚本，包含台词和手势建议
 */

/**
 * 生成排练脚本的 prompt
 * @param scenario - 用户描述的排练场景
 * @returns 完整的 prompt 字符串
 */
export const getScriptPrompt = (scenario: string): string => `
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

