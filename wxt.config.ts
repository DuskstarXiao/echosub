import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  srcDir: 'src',
  publicDir: path.resolve(rootDir, 'public'),
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    // Cast avoids Vite 5 (WXT 0.19) vs Vite 6 (@tailwindcss/vite) plugin type mismatch
    plugins: [tailwindcss() as never],
  }),
  manifest: {
    name: 'EchoSub - Live Bilingual Subtitles',
    short_name: 'EchoSub',
    description:
      'Real-time video & audio bilingual subtitles overlay with fullscreen Top-Layer rendering, transcript timeline, SRT/Markdown export & AI summary.',
    version: '1.0.0',
    permissions: [
      'tabCapture',
      'offscreen',
      'storage',
      'sidePanel',
      'activeTab',
      'scripting',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_title: 'EchoSub - Live Bilingual Subtitles',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    commands: {
      'toggle-capture': {
        suggested_key: {
          default: 'Alt+Shift+S',
          mac: 'MacCtrl+Shift+S',
        },
        description: 'Toggle EchoSub live subtitle capture on current tab',
      },
      'toggle-overlay': {
        suggested_key: {
          default: 'Alt+Shift+H',
          mac: 'MacCtrl+Shift+H',
        },
        description: 'Show or hide EchoSub subtitle overlay',
      },
    },
  },
});
