import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' es más simple para el usuario final, se actualiza en segundo plano.
      // 'prompt' requiere que el usuario haga clic en un botón para actualizar (como lo tienes ahora).
      registerType: 'autoUpdate', 
      manifest: {
        name: 'Infractor Ambiental',
        short_name: 'Infractor',
        description: 'Reporta incidentes ambientales de forma anónima.',
        theme_color: '#4F46E5',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon-192x192.png', // Usa el ícono simplificado
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512x512.png', // Usa el ícono simplificado
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512x512.png', // Ícono adaptable para diferentes formas en Android
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          }
        ]
      },
      // Opciones para desarrollo (opcional, pero muy útil)
      devOptions: {
        enabled: true
      },
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          pdflib: ['pdf-lib'],
        },
      },
    },
  },
})
