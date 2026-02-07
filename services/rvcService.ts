/**
 * RVC (Retrieval-based Voice Conversion) 服务
 * 调用本地或远程 RVC FastAPI 接口，将音频统一为指定音色。
 * 兼容 SocAIty/Retrieval-based-Voice-Conversion-FastAPI 的 POST /voice2voice 接口。
 */

export interface RvcOptions {
  /** RVC API 根地址，例如 http://localhost:8001 */
  apiUrl: string;
  /** 模型名称（对应 RVC 训练后的 .pth 文件名，不含后缀） */
  modelName: string;
  /** 可选：f0 方法，如 rmvpe / crepe / harvest / pm */
  f0method?: string;
  /** 可选：index 检索比例 0–1 */
  indexRate?: number;
}

/**
 * 将一段音频通过 RVC 转换为目标音色
 * @param audioBlob WAV 格式的音频 Blob
 * @param options RVC API 地址与模型配置
 * @returns 转换后的 WAV Blob
 */
export async function convertAudioWithRvc(
  audioBlob: Blob,
  options: RvcOptions
): Promise<Blob> {
  const baseUrl = options.apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/voice2voice`;

  const form = new FormData();
  form.append('input_file', audioBlob, 'input.wav');
  form.append('model_name', options.modelName);
  if (options.f0method != null) form.append('f0method', options.f0method);
  if (options.indexRate != null) form.append('index_rate', String(options.indexRate));

  const res = await fetch(url, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RVC 转换失败 (${res.status}): ${text || res.statusText}`);
  }

  return res.blob();
}

/**
 * 从环境或参数获取 RVC 配置（可选）
 * 未配置时返回 null，导出流程将不进行音色统一。
 */
export function getRvcOptionsFromEnv(): RvcOptions | null {
  const apiUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_RVC_API_URL
      ? String(import.meta.env.VITE_RVC_API_URL).trim()
      : '';
  const modelName =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_RVC_MODEL_NAME
      ? String(import.meta.env.VITE_RVC_MODEL_NAME).trim()
      : '';

  if (!apiUrl || !modelName) return null;

  return {
    apiUrl,
    modelName,
    f0method: import.meta.env?.VITE_RVC_F0_METHOD || 'rmvpe',
    indexRate:
      import.meta.env?.VITE_RVC_INDEX_RATE != null
        ? Number(import.meta.env.VITE_RVC_INDEX_RATE)
        : 0.66,
  };
}
