import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root:fileURLToPath(new URL('./platform/client',import.meta.url)),
  plugins:[react()],
  server:{port:5180,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:4080',ws:true}}},
  define:{__APP_VERSION_MAJOR__:JSON.stringify('community-0.2'),__BUILD_COMMIT_COUNT__:JSON.stringify('0'),__BUILD_BRANCH__:JSON.stringify('community'),__BUILD_COMMIT__:JSON.stringify('source-release')},
  build:{outDir:'../dist',emptyOutDir:true,chunkSizeWarningLimit:1500,rollupOptions:{output:{manualChunks(id){if(id.includes('@novnc'))return 'novnc';if(id.includes('@xterm'))return 'xterm';}}}},
});
