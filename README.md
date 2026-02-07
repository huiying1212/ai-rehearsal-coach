<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1R3XRYpjGwFiK42B8kvsWyWZF-0rx3lP-

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

### Optional: RVC 音色统一（导出前）

导出完整视频前，可用 [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) 将各段 TTS/视频音轨统一为同一音色。需本地先起一个兼容 [Retrieval-based-Voice-Conversion-FastAPI](https://github.com/SocAIty/Retrieval-based-Voice-Conversion-FastAPI) 的 `POST /voice2voice` 接口，然后在 [.env.local](.env.local) 中配置：

- `VITE_RVC_API_URL`：RVC 服务地址，如 `http://localhost:8001`
- `VITE_RVC_MODEL_NAME`：已训练好的模型名（.pth 文件名不含后缀）
- （可选）`VITE_RVC_F0_METHOD`：如 `rmvpe`、`crepe`、`harvest`、`pm`，默认 `rmvpe`
- （可选）`VITE_RVC_INDEX_RATE`：0–1，默认 `0.66`

配置后导出时会先对各段音频做 RVC 转换再合成导出。
