/**
 * 图片生成 Prompt
 * 用于 generateCharacterImage 函数
 * 
 * 使用 Gemini 3 Pro Image 模型生成角色定妆照
 * 创建纯白背景的全身参考图，用于后续视频生成
 */

/**
 * 生成角色定妆照的 prompt
 * @param characterDescription - 角色外观描述
 * @returns 完整的 prompt 字符串
 */
export const getImagePrompt = (characterDescription: string): string => `
Generate an image of: ${characterDescription}.

Full body shot showing the complete character from head to toe.
Standing upright in a neutral pose (arms relaxed at sides if applicable).
Front view, eye-level perspective, facing directly forward.
Isolated on pure white background, no props, no shadows, no other objects.
Neutral, even lighting with no dramatic shadows.
Professional reference image style, high resolution, clean and crisp.
`.trim();

