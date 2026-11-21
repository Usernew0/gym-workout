import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    optimizeDeps: {
      entries: [
        'index.html',
        'src/main.tsx',
        'src/App.tsx',
        'src/components/AdminPanel.tsx',
        'src/components/gym/GymApp.tsx',
        'src/lib/sheetParser.ts',
        'src/lib/workoutPdfExport.ts',
      ],
      holdUntilCrawlEnd: true,
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'motion/react',
        'lucide-react',
        'canvas-confetti',
        '@supabase/supabase-js',
        'firebase/app',
        'firebase/firestore',
        'firebase/storage',
        'browser-image-compression',
        'qrcode',
        'jspdf',
        'xlsx',
        'pdfjs-dist/legacy/build/pdf.mjs',
      ],
    },
    build: {
      target: 'es2020',
      modulePreload: false,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});