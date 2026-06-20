import { fileURLToPath, URL } from 'node:url'

import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'src/services/__tests__/openClaw*.test.ts',
      'src/services/__tests__/openClawToOrchestrator.tvSequence.test.ts',
      'src/services/__tests__/openClawHostAdapter.test.ts',
    ],
    clearMocks: true,
    restoreMocks: true,
  },
})
