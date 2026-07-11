import { describe, it, expect } from 'vitest'
import { FLASH_SCRIPT, UNMOUNT_SCRIPT } from '../src/main/security/elevated-scripts'

// These scripts run as root. The critical invariant is that they read all
// untrusted input from process.argv and interpolate NOTHING. If someone later
// reintroduces a `${...}` template hole, these tests fail.

describe('FLASH_SCRIPT (runs as root)', () => {
  it('reads image path, drive, final type and module path from argv', () => {
    expect(FLASH_SCRIPT).toContain('process.argv[2]') // imagePath
    expect(FLASH_SCRIPT).toContain('JSON.parse(process.argv[3])') // drive
    expect(FLASH_SCRIPT).toContain('process.argv[4]') // finalType
    expect(FLASH_SCRIPT).toContain('require(process.argv[5])') // etcher-sdk path
  })

  it('contains no template interpolation placeholders', () => {
    expect(FLASH_SCRIPT).not.toContain('${')
  })

  it('does not require() a string literal path (must be argv-driven)', () => {
    expect(FLASH_SCRIPT).not.toMatch(/require\(['"]/)
  })
})

describe('UNMOUNT_SCRIPT (runs as root)', () => {
  it('reads the device path and module path from argv', () => {
    expect(UNMOUNT_SCRIPT).toContain('process.argv[2]')
    expect(UNMOUNT_SCRIPT).toContain('require(process.argv[3])')
  })

  it('contains no template interpolation placeholders', () => {
    expect(UNMOUNT_SCRIPT).not.toContain('${')
    expect(UNMOUNT_SCRIPT).not.toMatch(/require\(['"]/)
  })
})
