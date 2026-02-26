/**
 * 视频生成 Prompt
 * 用于 generateActionVideo 函数
 * 
 * 使用 Veo 3.1 模型生成角色动作视频
 * 根据手势类型和台词生成相应的全身动作
 */

// 手势类型值（与 geminiService.ts 中的 GestureTypeValue 一致）
export type GestureTypeValue = 'none' | 'beat' | 'deictic' | 'iconic' | 'metaphoric';

/**
 * 视频生成 prompt 的参数
 */
export interface VideoPromptParams {
  gestureType: GestureTypeValue;
  spokenText: string;
  gestureDescription?: string;
  scenario?: string;
  characterPersonality?: string;
  /**
   * 上一次审查失败时提炼出的修正建议。
   * 有值时会在 prompt 末尾追加 CORRECTION 段落，指引模型规避已知问题。
   */
  reviewFeedback?: string;
}

/**
 * 生成视频动作的 prompt
 * @param params - 视频生成参数
 * @returns 完整的 prompt 字符串
 */
export const getVideoPrompt = (params: VideoPromptParams): string => {
  const { gestureType, spokenText, gestureDescription, scenario, characterPersonality, reviewFeedback } = params;
  
  // 添加场景上下文（如果提供）
  const contextPrefix = scenario ? `Context: This is for a ${scenario}.\n` : '';
  
  // 添加角色性格描述（如果提供）
  const personalityPrefix = characterPersonality 
    ? `Character personality and movement style: ${characterPersonality}\n` 
    : '';
  
  // 根据手势类型构建 SUBJECT AND ACTION 部分
  const subjectAndAction = gestureType === 'beat'
    ? `A character speaks and gestures naturally: "${spokenText}"
Body language matches the speech content with EXPRESSIVE and CHARACTER-DRIVEN gestures.`
    : `A character embodies the feeling: "${gestureDescription || 'Natural expressive gesture'}"
The character speaks: "${spokenText}"
Interpret this high-level description creatively, translating the DESIRED EFFECT into compelling full-body movement.
Body language matches the speech content with EXPRESSIVE and CHARACTER-DRIVEN gestures.`;

  return `
${contextPrefix}${personalityPrefix}
SUBJECT AND ACTION:
${subjectAndAction}

ENVIRONMENT:
Pure white background, clean and minimal. No shadows, no props, no additional objects.

LIGHTING:
Even, neutral lighting with no dramatic shadows. Professional studio quality.

CAMERA:
Static full-body shot, eye-level perspective. The camera does not move, zoom, or pan.
The entire character remains visible from head to toe throughout the video, centered in frame.

AUDIO:
No background music. Silent or dialogue/voice only.

TECHNICAL CONSTRAINTS (Robot Motion Safety):
The movements must be robotically feasible:
- Simple forward or side-to-side steps with feet planted (NO leg crossing, jumping, kneeling, backward walking)
- Smooth 90-180° turns at moderate speed (NO rapid spinning)
- Maintain balanced upright posture, no tilting beyond safe angles
- All movements smooth, controlled, and mechanically feasible for 4-limb robots
- No finger articulation

DURATION: 8 seconds

FRAME CONSISTENCY:
The video starts with the character in the reference image pose, performs the described movements, then smoothly returns to a similar neutral pose by the end.

WHEN DIALOGUE ENDS:
Once the character has finished speaking the given lines, smoothly returns to a similar neutral pose by the end for the remainder of the video. Do not produce any other sounds after the dialogue ends.
${reviewFeedback ? `
CORRECTION (a previous attempt was rejected — address ALL of the following):
${reviewFeedback}
` : ''}`.trim();
};
