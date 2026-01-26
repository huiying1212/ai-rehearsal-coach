/**
 * Prompts 模块入口
 * 
 * 导出所有 prompt 生成函数，方便统一导入
 */

export { getScriptPrompt } from './scriptPrompt';
export { getImagePrompt } from './imagePrompt';
export { getVideoPrompt, type VideoPromptParams, type GestureTypeValue } from './videoPrompt';

