/**
 * vite.config.js
 *
 * Vite build configuration. The only customization here is the PWA
 * plugin, which generates a service worker + web app manifest so the
 * attendance app can be installed on a phone/desktop and used offline.
 */

import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      // Automatically activate a new service worker version as soon as
      // it's available, instead of waiting for the user to close all tabs.
      registerType: 'autoUpdate',

      // Web app manifest: controls how the app appears when installed
      // (home screen icon, splash screen, standalone window, etc.)
      manifest: {
        name: 'School Attendance System',
        short_name: 'Attendance',
        start_url: '/',
        display: 'standalone', // hide the browser UI when launched as an app
        background_color: '#ffffff', // splash screen background
        theme_color: '#4f46e5', // matches the app's header accent color
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})
