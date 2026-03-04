import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // jsdom gives us browser globals: localStorage, window, WebSocket, atob/btoa
    environment: 'jsdom',
    globals: true,
    // Reset all mocks/stubs between every test case automatically
    clearMocks: true,
    restoreMocks: true,
  },
})
