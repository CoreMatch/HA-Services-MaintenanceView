import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 前端只通过同源 /api/* 与后端通信（Gin 托管 dist），开发态把 /api
// 代理到本地 MV 进程即可。
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      // @ha/ui 经 file: 链接以源码消费且自带 node_modules；把
      // react/react-dom/lucide-react 钉到本应用的副本，保证运行时只有
      // 一个 React 实例（hooks 安全），接线对齐 MatchCoreArena-Client。
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
    },
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  server: {
    fs: {
      // @ha/ui 通过 file: 链接以源码方式消费，真实路径在本 vite 工作区
      // 之外（仓根 ha-ui 子模块）；允许其静态资源被伺服。
      allow: ['..'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:18081',
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
});
