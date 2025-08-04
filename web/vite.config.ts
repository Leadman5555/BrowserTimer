import {defineConfig} from 'vite';
import {resolve} from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
    root: __dirname,
    publicDir: 'public',
    plugins: [react()],
    build: {
        outDir: 'dist',
        target: 'esnext',
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'src/popup/popup.html'),
                background: resolve(__dirname, 'src/background.ts'),
                connection_service: resolve(__dirname, 'src/connection_service.ts'),
                result_view: resolve(__dirname, 'src/result_view/result_view.tsx')
            },
            output: {
                entryFileNames: 'scripts/[name].js',
                format: 'esm',
            },
        },
        emptyOutDir: true,
        sourcemap: false,
    },
});

