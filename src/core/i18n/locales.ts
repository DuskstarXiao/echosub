export type ResolvedLocale = 'zh' | 'en';

export interface LocaleDictionary {
  appName: string;
  tagline: string;
  startCapture: string;
  stopCapture: string;
  starting: string;
  reconnecting: string;
  live: string;
  idle: string;
  error: string;
  openSidePanel: string;
  showOverlay: string;
  hideOverlay: string;
  demoBadge: string;
  demoHint: string;
  setupFreeCta: string;
  audioMonitor: string;
  speaking: string;
  silent: string;
  latency: string;
  captureMode: string;
  modeAuto: string;
  modeAudio: string;
  modeTrack: string;
  timingRealtime: string;
  timingRealtimeDesc: string;
  timingSentence: string;
  timingSentenceDesc: string;
  resetSpeakers: string;
  sourceBadgeTrack: string;
  sourceBadgeAudio: string;
  sourceBadgeDemo: string;
  displayMode: string;
  modeBilingual: string;
  modeTranslated: string;
  modeSource: string;
  tabTranscript: string;
  tabAppearance: string;
  tabSettings: string;
  exportSrt: string;
  exportMd: string;
  aiSummary: string;
  summarizing: string;
  clear: string;
  copyAll: string;
  copied: string;
  noSegmentsTitle: string;
  noSegmentsDesc: string;
  quickPresetsTitle: string;
  quickPresetsSub: string;
  presetSfTitle: string;
  presetSfDesc: string;
  presetSfBadge: string;
  presetLocalTitle: string;
  presetLocalDesc: string;
  presetLocalBadge: string;
  presetGroqTitle: string;
  presetGroqDesc: string;
  presetGroqBadge: string;
  presetDemoTitle: string;
  presetDemoDesc: string;
  presetDemoBadge: string;
  getFreeKeyBtn: string;
  testConnectionBtn: string;
  testingConnection: string;
  advancedSettings: string;
  asrEngine: string;
  translatorEngine: string;
  sourceLang: string;
  targetLang: string;
  uiLanguage: string;
  apiKeyPlaceholder: string;
  savedHint: string;
  vadSensitivity: string;
  fontSize: string;
  bgOpacity: string;
  blurStrength: string;
  maxWidth: string;
  lineOrder: string;
  orderSourceFirst: string;
  orderTranslatedFirst: string;
  accentColor: string;
  speakerColoring: string;
  speakerColoringHint: string;
  speakerSensitivity: string;
  showTranslationDelay: string;
  showTranslationDelayShort: string;
  autoStartTitle: string;
  autoStartDesc: string;
  autoStartToggle: string;
  autoStartCustomPlaceholder: string;
  autoStartAdd: string;
  autoStartMv3Note: string;
  hideNativeCc: string;
  resetPosition: string;
  dragTip: string;
  fullscreenTip: string;
  localWsTip: string;
  llmPreset: string;
  baseUrl: string;
  modelName: string;
  providerDemo: string;
  providerSiliconflow: string;
  providerGroq: string;
  providerDashscope: string;
  providerDeepgram: string;
  providerLocalWs: string;
  translatorChromeAi: string;
  translatorFree: string;
  translatorTencent: string;
  translatorLlm: string;
  translatorNone: string;
  summaryTitle: string;
  close: string;
  autoDetect: string;
}

export const LOCALES: Record<ResolvedLocale, LocaleDictionary> = {
  zh: {
    appName: 'EchoSub',
    tagline: '实时视频双语字幕 · 全屏顶层渲染',
    startCapture: '开启实时字幕',
    stopCapture: '停止捕获',
    starting: '正在启动…',
    reconnecting: '断线重连中…',
    live: '运行中',
    idle: '待机中',
    error: '异常',
    openSidePanel: '打开完整侧边栏',
    showOverlay: '显示画面字幕',
    hideOverlay: '隐藏画面字幕',
    demoBadge: '当前为演示流',
    demoHint: '想看真实外语视频？去侧边栏选「国内零成本全家桶」，领 1 个硅基流动免费 Key 即可国内直连免费转写 + 翻译。',
    setupFreeCta: '去配置免费方案',
    audioMonitor: '标签页音频监听（原声直通）',
    speaking: '人声活跃',
    silent: '静音休眠',
    latency: '延迟',
    captureMode: '识别模式',
    modeAuto: '智能混合',
    modeAudio: '音频转写',
    modeTrack: '字幕轨直译',
    timingRealtime: '模式 A · 极速实时',
    timingRealtimeDesc: '尽量低延迟，边说边译',
    timingSentence: '模式 B · 整句精翻',
    timingSentenceDesc: '说完完整一句再整句翻译',
    resetSpeakers: '重置声纹',
    sourceBadgeTrack: '字幕轨直译 · 0 识别费用',
    sourceBadgeAudio: '实时音频转写',
    sourceBadgeDemo: '免 Key 演示模式',
    displayMode: '字幕显示',
    modeBilingual: '双语对照',
    modeTranslated: '仅译文',
    modeSource: '仅原文',
    tabTranscript: '逐字稿',
    tabAppearance: '字幕样式',
    tabSettings: '一键配置',
    exportSrt: '导出 .srt',
    exportMd: '导出 .md',
    aiSummary: 'AI 总结',
    summarizing: '正在提炼重点…',
    clear: '清空',
    copyAll: '复制全部',
    copied: '已复制',
    noSegmentsTitle: '等待捕获语音或视频字幕',
    noSegmentsDesc: '播放任意视频后点击「开启实时字幕」：有自带字幕轨时自动 0 费用直译，无字幕生肉/直播时自动抓音频转写且原视频绝不静音。',
    quickPresetsTitle: '选一个免费方案，30 秒直接用',
    quickPresetsSub: '无需理解复杂参数，点选下方方案再点「一键测通」即可确认可用',
    presetSfTitle: '国内免费全家桶（1 个 Key 搞定全部）',
    presetSfDesc: '硅基流动免费 SenseVoiceSmall 语音识别 + 免费 Qwen2.5-7B 翻译与 AI 总结，国内直连无需代理',
    presetSfBadge: '最推荐 · ¥0',
    presetLocalTitle: '纯本地离线引擎（零注册 / 永久免费）',
    presetLocalDesc: '双击运行 local-asr/一键启动本地语音引擎.bat + Chrome 本地离线翻译，完全不出本机',
    presetLocalBadge: '零 Key · 离线',
    presetGroqTitle: '海外高速免费方案（需代理）',
    presetGroqDesc: 'Groq Whisper-large-v3-turbo 免费高额度 + 自动免费机翻，英文技术视频极准',
    presetGroqBadge: '海外免费',
    presetDemoTitle: '免 Key 体验预览流',
    presetDemoDesc: '无需任何配置，立刻预览全屏毛玻璃字幕拖拽、逐字稿与 .srt 导出效果',
    presetDemoBadge: '即开即看',
    getFreeKeyBtn: '前往免费领取 Key',
    testConnectionBtn: '一键测通语音 & 翻译',
    testingConnection: '正在测试连通性…',
    advancedSettings: '高级自定义引擎（阿里云百炼 / 腾讯翻译君 / DeepSeek / 智谱 / Deepgram）',
    asrEngine: '语音识别引擎（ASR）',
    translatorEngine: '翻译引擎',
    sourceLang: '识别源语言',
    targetLang: '目标译文语言',
    uiLanguage: '界面语言',
    apiKeyPlaceholder: '粘贴你的 API Key（仅保存在本机浏览器）',
    savedHint: '设置已自动保存',
    vadSensitivity: 'VAD 人声唤醒阈值 (dB)',
    fontSize: '主字幕字号',
    bgOpacity: '毛玻璃背景不透明度',
    blurStrength: '背景高斯模糊',
    maxWidth: '字幕最大宽度',
    lineOrder: '双语上下顺序',
    orderSourceFirst: '原文在上 · 译文在下',
    orderTranslatedFirst: '译文在上 · 原文在下',
    accentColor: '译文高亮色',
    speakerColoring: '多角色音色分色（自动按音色区分说话人颜色）',
    speakerColoringHint: '本地实时提取音高 F0 与梅尔倒谱 MFCC 声纹，零费用自动给不同说话人配色',
    speakerSensitivity: '音色区分灵敏度（越高越容易分出新角色）',
    showTranslationDelay: '译文末尾显示延迟耗时（如 [2.3s前]）',
    showTranslationDelayShort: '显示延迟 [s前]',
    autoStartTitle: '自动识别视频网站（自动开启字幕）',
    autoStartDesc: '进入下方勾选的视频网站播放页时，自动开启 EchoSub 字幕',
    autoStartToggle: '勾选视频网站自动开启',
    autoStartCustomPlaceholder: '自定义域名，如 netflix.com / zoom.us',
    autoStartAdd: '添加',
    autoStartMv3Note: '说明：有自带字幕轨将零点击自动翻译；受浏览器安全策略限制，纯无字幕生肉音频在自动唤醒后按 Alt+Shift+S 或点一下右上角图标即可授权抓取。',
    hideNativeCc: '字幕轨直译时自动隐藏原视频小字幕（防止重叠）',
    resetPosition: '恢复底部居中',
    dragTip: '视频画面上的字幕条可直接鼠标拖拽到任意位置',
    fullscreenTip: '已启用原生 Top-Layer + 全屏自动重挂载，支持 YouTube / B站 / Twitch 真全屏',
    localWsTip: '双击仓库内 local-asr/一键启动本地语音引擎.bat 即可启动本机离线语音服务（普通 CPU 也能跑）',
    llmPreset: '大模型服务商预设',
    baseUrl: 'API Base URL',
    modelName: '模型名称',
    providerDemo: '内置体验流（免 Key 快速预览）',
    providerSiliconflow: '硅基流动 SenseVoiceSmall（国内直连 · 长期免费）',
    providerGroq: 'Groq Whisper Turbo（海外推荐 · 高免费额度）',
    providerDashscope: '阿里云百炼 Paraformer（国内直连实时流）',
    providerDeepgram: 'Deepgram Nova-2（原生 WebSocket 极速）',
    providerLocalWs: '本地离线 WebSocket（faster-whisper / SenseVoice）',
    translatorChromeAi: 'Chrome 138+ 内置本地离线机翻（零 Key / 零网络）',
    translatorFree: '自动免费机翻（Chrome 本地优先 → 公共兜底）',
    translatorTencent: '腾讯翻译君官方 API（国内直连 · 每月 500 万字符免费）',
    translatorLlm: '大模型上下文意译（硅基流动免费 / 智谱免费 / DeepSeek）',
    translatorNone: '关闭翻译（仅显示识别原文）',
    summaryTitle: 'AI 重点笔记总结',
    close: '收起',
    autoDetect: '自动检测',
  },
  en: {
    appName: 'EchoSub',
    tagline: 'Live Bilingual Video Subtitles · Fullscreen Top-Layer',
    startCapture: 'Start Live Subtitles',
    stopCapture: 'Stop Capture',
    starting: 'Starting…',
    reconnecting: 'Reconnecting…',
    live: 'Live',
    idle: 'Idle',
    error: 'Error',
    openSidePanel: 'Open Side Panel',
    showOverlay: 'Show Overlay',
    hideOverlay: 'Hide Overlay',
    demoBadge: 'Demo Stream Active',
    demoHint: 'Open Side Panel → Setup to activate Free SiliconFlow (1 key for ASR + translation), Local Offline ASR, or Groq in 30s.',
    setupFreeCta: 'Free Setup',
    audioMonitor: 'Tab Audio Monitor (Pass-Through)',
    speaking: 'Speech',
    silent: 'VAD Idle',
    latency: 'Latency',
    captureMode: 'Input Mode',
    modeAuto: 'Smart Hybrid',
    modeAudio: 'Audio ASR',
    modeTrack: 'Track Only',
    timingRealtime: 'Mode A · Low-Latency',
    timingRealtimeDesc: 'Fast streaming draft + polish',
    timingSentence: 'Mode B · Full Sentence',
    timingSentenceDesc: 'Wait for complete sentence',
    resetSpeakers: 'Reset Voices',
    sourceBadgeTrack: 'Native Track · Zero ASR Cost',
    sourceBadgeAudio: 'Live Audio ASR',
    sourceBadgeDemo: 'Zero-Key Demo',
    displayMode: 'Display',
    modeBilingual: 'Bilingual',
    modeTranslated: 'Translated',
    modeSource: 'Source',
    tabTranscript: 'Transcript',
    tabAppearance: 'Style',
    tabSettings: 'Setup',
    exportSrt: 'Export .srt',
    exportMd: 'Export .md',
    aiSummary: 'AI Summary',
    summarizing: 'Summarizing…',
    clear: 'Clear',
    copyAll: 'Copy All',
    copied: 'Copied',
    noSegmentsTitle: 'Ready for Live Subtitles',
    noSegmentsDesc: 'Play any video and click "Start Live Subtitles". Existing video caption tracks translate at zero ASR cost; unsubtitled videos & livestreams automatically capture tab audio without muting.',
    quickPresetsTitle: 'Pick a Free Recipe (30-Second Setup)',
    quickPresetsSub: 'Select a preset below and click "Test ASR & Translation" to verify instantly',
    presetSfTitle: 'All-in-One Free Cloud (SiliconFlow · 1 Key)',
    presetSfDesc: 'Free SenseVoiceSmall ASR + Free Qwen2.5-7B translation & AI summary, China direct',
    presetSfBadge: 'Best · $0',
    presetLocalTitle: '100% Local Offline (Zero Account / Zero Key)',
    presetLocalDesc: 'Run local-asr one-click script + Chrome Built-in on-device translator',
    presetLocalBadge: 'Offline · $0',
    presetGroqTitle: 'Global Free Tier (Groq Whisper Turbo)',
    presetGroqDesc: 'Fast Whisper-large-v3-turbo free quota + automatic free machine translation',
    presetGroqBadge: 'Fast · Free',
    presetDemoTitle: 'Zero-Key Demo Stream',
    presetDemoDesc: 'Preview fullscreen glass captions, drag positioning, and .srt export instantly',
    presetDemoBadge: 'Instant',
    getFreeKeyBtn: 'Get Free API Key',
    testConnectionBtn: 'Test ASR & Translation',
    testingConnection: 'Testing connections…',
    advancedSettings: 'Advanced Custom Engines (DashScope / Tencent TMT / DeepSeek / Zhipu / Deepgram)',
    asrEngine: 'Speech Recognition (ASR)',
    translatorEngine: 'Translation Engine',
    sourceLang: 'Source Language',
    targetLang: 'Target Language',
    uiLanguage: 'UI Language',
    apiKeyPlaceholder: 'Paste API key (stored locally in browser only)',
    savedHint: 'Settings saved automatically',
    vadSensitivity: 'VAD Speech Threshold (dB)',
    fontSize: 'Primary Font Size',
    bgOpacity: 'Glass Background Opacity',
    blurStrength: 'Backdrop Blur',
    maxWidth: 'Max Caption Width',
    lineOrder: 'Line Order',
    orderSourceFirst: 'Source Top · Translation Bottom',
    orderTranslatedFirst: 'Translation Top · Source Bottom',
    accentColor: 'Translation Accent',
    speakerColoring: 'Multi-Speaker Timbre Coloring (Auto Voiceprint)',
    speakerColoringHint: 'On-device F0 pitch + MFCC voiceprint clustering assigns distinct colors per speaker at zero cost',
    speakerSensitivity: 'Speaker Split Sensitivity (Higher = More Sensitive)',
    showTranslationDelay: 'Show translation age after caption (e.g. [2.3s ago])',
    showTranslationDelayShort: 'Delay Tag',
    autoStartTitle: 'Auto-Start on Checked Video Sites',
    autoStartDesc: 'Automatically launch EchoSub when opening video pages on selected sites',
    autoStartToggle: 'Auto-Start on Sites',
    autoStartCustomPlaceholder: 'Custom domain, e.g. netflix.com / zoom.us',
    autoStartAdd: 'Add',
    autoStartMv3Note: 'Note: Video caption tracks start automatically with zero clicks; for raw audio capture on unsubtitled videos, press Alt+Shift+S or click the toolbar icon once to grant Chrome tabCapture.',
    hideNativeCc: 'Hide original player captions in Track mode (avoid overlap)',
    resetPosition: 'Reset Position',
    dragTip: 'Drag the floating subtitle bar anywhere directly on the video',
    fullscreenTip: 'Native Top-Layer + fullscreenchange auto-reparenting enabled for YouTube / Bilibili / Twitch',
    localWsTip: 'Run local-asr/一键启动本地语音引擎.bat (Windows) or start-local-asr.sh (macOS/Linux) for zero-cost offline ASR',
    llmPreset: 'LLM Provider Preset',
    baseUrl: 'API Base URL',
    modelName: 'Model Name',
    providerDemo: 'Built-in Demo Stream (Zero-Key Preview)',
    providerSiliconflow: 'SiliconFlow SenseVoiceSmall (CN Direct · Free)',
    providerGroq: 'Groq Whisper Turbo (Fast · Free Tier)',
    providerDashscope: 'Aliyun DashScope Paraformer (CN Streaming)',
    providerDeepgram: 'Deepgram Nova-2 (Native Streaming WS)',
    providerLocalWs: 'Local Offline WebSocket (faster-whisper / SenseVoice)',
    translatorChromeAi: 'Chrome 138+ Built-in Offline Translator (Zero Key)',
    translatorFree: 'Auto Free Machine Translation (Chrome AI → Web Failover)',
    translatorTencent: 'Tencent Cloud TMT (CN Direct · 5M Free Chars/mo)',
    translatorLlm: 'Context-Aware LLM (SiliconFlow Free / Zhipu Free / DeepSeek)',
    translatorNone: 'Disabled (Source Captions Only)',
    summaryTitle: 'AI Structured Summary',
    close: 'Close',
    autoDetect: 'Auto Detect',
  },
};
