import { defineConfig } from 'vitest/config'

// Unit tests target the pure, side-effect-free logic in the main process
// (validators, shell-arg escaping, integrity checks). Elevated flashing and
// drive I/O are covered by the manual per-OS smoke tests documented in the
// hardening plan, not here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globals: false
  }
})
