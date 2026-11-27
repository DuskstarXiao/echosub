# EchoSub 核心架构原理解析 & 技术面试深挖 Q&A

这份文档专门写给你——哪怕你现在对浏览器扩展底层还不熟，花 **10 分钟通读一遍**，就能在求职面试中像资深前端架构师一样从容拆解整个项目。

---

## 一、三句话讲清 EchoSub 是怎么工作的

1. **抓声音但不静音**：点击开启后，后台 `Service Worker` 向浏览器申请当前标签页的音频流权限，交给常驻隐藏页面 `Offscreen Document` 接管；音频进来后**分成两路**——一路直接连回你的电脑扬声器（`AudioContext.destination`）保证视频原声完全不断，另一路送进独立音频线程 `AudioWorklet` 实时转成 `16kHz` 语音数据。
2. **省流量 + 低延迟识别与翻译**：轻量级前端人声检测（VAD）自动过滤静音和纯 BGM；有人说话时才推给云端或本地离线语音引擎（Adapter 模式可热切换）；识别文本经过**稳定前缀锁定**防闪烁处理，再经防抖队列交给大模型带着前几句语境做精准意译。
3. **全屏绝不被挡住的高颜值字幕**：网页里用 `Shadow DOM` 隔离样式防污染，再用浏览器原生 `Top-Layer (popover="manual")` + `fullscreenchange` 动态重挂载双保险，哪怕 YouTube/B站全屏播放，毛玻璃字幕也能稳稳浮在最顶层并自由拖拽。

---

## 二、技术面试高频深挖 Q&A（直接背思路即可）

### Q1：Chrome Manifest V3 下为什么不能直接在 Service Worker 里采集标签页音频？你是怎么解决的？
- **答**：MV3 的 `Service Worker` 没有 DOM 环境，无法调用 `navigator.mediaDevices.getUserMedia` 和 `AudioContext`，且空闲 30 秒会被浏览器挂起回收。
- **方案**：严格遵循 MV3 官方标准链路——由 `Service Worker` 调用 `chrome.tabCapture.getMediaStreamId({ targetTabId })` 拿到 `streamId`，再通过 `chrome.offscreen.createDocument` 创建带 `USER_MEDIA` + `AUDIO_PLAYBACK` 声明的 `Offscreen Document` 接管媒体流并运行 Web Audio 管线。

### Q2：很多开源字幕插件开启后会导致原视频静音或出现回声，你怎么保证不断声且无回声？
- **答**：Chrome 一旦对标签页启动 `tabCapture`，默认会接管并切断标签页到扬声器的直接输出。
- **方案**：在 `Offscreen Document` 中创建**系统原生采样率**的 `AudioContext`，将 `MediaStreamAudioSourceNode` **一分为二**：
  1. 直通支路：`source.connect(audioCtx.destination)`，零额外缓冲延迟、原音质放音；
  2. 分析支路：`source -> AudioWorkletNode -> GainNode(gain=0) -> audioCtx.destination`。
- **关键坑点**：在 Chromium 中，如果 `AudioWorkletNode` 没有连到 `destination` 渲染图，引擎可能会将其裁剪导致 `process()` 根本不触发；所以必须经过一个 `gain = 0` 的静音节点连入 `destination`，既保活音频线程又绝对不产生双声回声。

### Q3：为什么用 `AudioWorklet` 而不是旧的 `ScriptProcessorNode`，且如何规避 MV3 CSP 限制？
- **答**：`ScriptProcessorNode` 已废弃且运行在主线程，页面卡顿时会丢帧爆音；`AudioWorklet` 运行在独立高优先级音频渲染线程，每 128 帧处理一次，通过带状态相位累加的线性插值从 48kHz 重采样至 16kHz Int16 PCM，并通过 Transferable `ArrayBuffer` 零拷贝传回主线程。
- **CSP 坑点**：MV3 禁止动态 `eval` 和内联脚本，因此把 `public/worklets/pcm-processor.js` 作为扩展静态资源，通过 `chrome.runtime.getURL('worklets/pcm-processor.js')` 同源加载，完全符合 `script-src 'self'` 策略。

### Q4：为什么没有在浏览器里用 WebGPU 跑本地 Whisper，而是做 Adapter 解耦架构？
- **答**：这是基于真实工程取舍的结果：
  1. 浏览器内跑 Whisper 需下载数百 MB 模型（国内网络极差）、易触发 MV3 CSP/内存上限，且纯端侧推理常有 4~6 秒高延迟与静音幻觉。
  2. 我们采用 **Adapter 策略模式**解耦 `AsrAdapter` 与 `TranslatorAdapter`：普通用户可直连阿里云百炼 / Groq / Deepgram（< 1.5s 延迟）搭配免 Key 翻译或 DeepSeek 上下文意译；极客用户则通过统一的 `LocalWsAsrAdapter` 对接本机 `WhisperLiveKit` / `SenseVoice`，兼顾低门槛与零 API 费用。

### Q5：浏览器原生 `WebSocket` 不支持自定义 `Authorization` 请求头，阿里云百炼 DashScope 你是怎么直连的？
- **答**：这是非常经典的浏览器安全限制。EchoSub 利用 MV3 的 `declarativeNetRequest.updateSessionRules`，在启动百炼识别时动态注入一条**仅限当前会话、仅匹配 `dashscope.aliyuncs.com` 的 `websocket` 资源类型**的 Header 改写规则，自动附加 `Authorization: Bearer <key>`，停止捕获时立即销毁规则。无需搭建中转后端服务器，同时 Key 只留在用户本地。

### Q6：流式字幕为什么容易闪烁重排？你的防闪烁算法是怎么设计的？
- **答**：流式 ASR 会不断修正刚说出口的词（例如 `"going to"` → `"gonna"`）。我们在 `src/core/subtitle/stabilizer.ts` 实现了 **LocalAgreement-2 稳定前缀锁定算法**：
  - 使用中英文无损混合分词器（CJK 逐字、英文逐词，保留原始空白），比较相邻两次识别结果的最长公共前缀（LCP）；
  - 连续达成一致的词元单调锁入 `committedSource`（永不回退修改），未确认尾部放在 `speculativeSource` 中以淡斜体呈现；
  - 翻译层在 `src/core/subtitle/translation-queue.ts` 中采用 **防抖（280ms）+ 最小增量门槛 + `AbortController` + 递增序列号竞态拦截**，确保慢响应绝不会覆盖新字幕，同时把前 3 句已确认双语对作为滑动上下文喂给大模型提升译文连贯性。

### Q7：为什么普通 `z-index: 2147483647` 在全屏视频里会失效？你怎么实现真全屏字幕？
- **答**：元素进入 Fullscreen API 全屏后会被浏览器提升至独立的 **Top Layer（顶层渲染层）**，常规 DOM 树里再高的 `z-index` 都在 Top Layer 之下。
- **双保险方案**（`src/entrypoints/content/index.tsx`）：
  1. 在 Shadow DOM 宿主节点上启用原生 `popover="manual"`，调用 `showPopover()` 直接进入浏览器 Top Layer；
  2. 监听 `fullscreenchange` 事件：若 `document.fullscreenElement` 是容器元素（YouTube/B站/Twitch 播放器），自动重挂载并触发一次 `hidePopover → showPopover` 将字幕推到 Top Layer 栈顶；若 `fullscreenElement` 是原生 `<video>`（无法挂载子 DOM），则留在 `body` 仅依靠 Top Layer 栈顺序浮在视频上方，且全程 `pointer-events: none` 透传鼠标点击不挡播放器控件。

### Q8：你们的项目工程质量与可测试性如何保障？
- **答**：严格分层——将音频重采样/WAV 编码、双特征自适应 VAD、环形预录缓冲区、稳定前缀锁定状态机、防抖上下文翻译队列、`.srt`/`.md` 导出器、纯 Web Crypto 腾讯翻译 TC3 签名及本地 WS 协议解析全部沉淀在零浏览器依赖的 `src/core/` 纯 TypeScript 层，编写了完整的 Vitest 单元测试套件（24/24 全通过），并接入 GitHub Actions CI 自动执行 TypeScript 严格模式检查、单测与 Chrome/Edge 双端打包。

### Q9：EchoSub v2.0 的「智能混合路由」与「零成本翻译降级」是怎么设计的？
- **答**：这是面向真实用户成本与网络环境的架构演进：
  1. **字幕轨优先 + 音频转写兜底（Hybrid Routing）**：`VideoTrackReader` 通过 `MutationObserver` 与 `<video>.textTracks` 实时检测 YouTube/B站/HTML5 课程的自带字幕轨；一旦检测到外语字幕流，Background 自动下发 `OFFSCREEN_SET_AUDIO_ASR_PAUSED(true)` 暂停云端 ASR 推流（0 语音费用、15ms 延迟），并用 `opacity: 0`（而非 `display: none`）隐藏原播放器小字幕避免重叠且不影响 DOM 字幕更新；若超过 7 秒无字幕轨输出则无缝恢复音频转写。
  2. **多级免费翻译容灾与国内友好**：优先在 Offscreen 的 Window 上下文中调用 **Chrome 138+ 原生端侧翻译 API (`self.Translator`)** 实现零网络、零 Key 本地毫秒级翻译；不支持时支持直连国内免费的**硅基流动 Qwen2.5-7B**、**智谱 GLM-4-Flash** 或纯 Web Crypto `TC3-HMAC-SHA256` 签名的**腾讯翻译君（500 万免费字符/月）**，并对 Google 公共通道设置 2.2s 短超时 + 60s 熔断冷却，彻底避免国内无代理环境下死等超时。

### Q10：如何在零额外云端成本下实现「多说话人音色分色字幕」？
- **答**：在 `src/core/audio/speaker-diarizer.ts` 中，我们直接复用 `Offscreen` 已采集的 16kHz PCM 人声缓冲，实现了一套纯 TypeScript 零依赖实时声纹聚类引擎（单句推理 `< 0.5ms`）：
  1. **声学特征提取**：对有效人声帧（512 采样点加 Hann 窗）同时计算 **归一化自相关基频 F0（75–380Hz，区分男低音与高音/女声）**、**512 点基-2 FFT → 12 频带梅尔滤波器组 → DCT 倒谱系数 MFCC（取 `c1..c10` 舍弃代表音量的 `c0` 实现音量无关的声道共振峰刻画）** 以及 **频谱质心**；
  2. **在线流式聚类**：使用加权相似度（MFCC 余弦相似度 + 半音音高距离 + 频谱质心）与已有说话人质心比对，超过阈值则归类并用 EMA 平滑更新质心，低于阈值则在 5 角色上限内自动创建新角色并分配高对比度电影级配色；
  3. **联动翻译与总结**：角色标签同步透传给大模型翻译的滑动上下文窗口与 Markdown/AI 总结，显著改善多人对话场景下的人称代词一致性。
