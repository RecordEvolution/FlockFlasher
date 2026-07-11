// Pure validation helpers for data that crosses the renderer -> main IPC boundary
// or is parsed from untrusted .flock/.reswarm config files. Electron-free so it
// can be unit-tested. Even though the privileged sinks are now parameterized
// (no shell/code interpolation), these guards are defense-in-depth: they keep a
// malicious device path off a real disk and a crafted serial_number / name /
// image filename from escaping the temp/cache directories via `..`.

// Matches any C0 control character (U+0000..U+001F).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F]/

/** A string usable as a single path segment: no separators, no traversal, no control chars. */
export const isSafePathSegment = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('/') || value.includes('\\')) return false
  if (value === '.' || value === '..') return false
  if (CONTROL_CHARS.test(value)) return false
  return true
}

/** Validate a block-device path the way each platform names it. */
export const isValidDevicePath = (
  devicePath: unknown,
  platform: NodeJS.Platform = process.platform
): devicePath is string => {
  if (typeof devicePath !== 'string' || devicePath.length === 0) return false
  if (CONTROL_CHARS.test(devicePath)) return false

  if (platform === 'win32') {
    // \\.\PhysicalDrive0 (drivelist / mountutils form) or a drive letter
    return /^\\\\[.?]\\[A-Za-z0-9]+$/.test(devicePath) || /^[A-Za-z]:\\?$/.test(devicePath)
  }

  // darwin: /dev/disk2 (or /dev/rdisk2); linux: /dev/sdb — restrict to /dev/*.
  return /^\/dev\/[A-Za-z0-9/]+$/.test(devicePath)
}

export const assertSafePathSegment = (value: unknown, label: string): string => {
  if (!isSafePathSegment(value)) {
    throw new Error(`Invalid ${label}: must be a single safe path segment`)
  }
  return value
}

export const assertValidDevicePath = (
  devicePath: unknown,
  platform: NodeJS.Platform = process.platform
): string => {
  if (!isValidDevicePath(devicePath, platform)) {
    throw new Error(`Invalid device path: ${String(devicePath)}`)
  }
  return devicePath
}

/** An https: URL is required for every remote artifact we download. */
export const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export const assertHttpsUrl = (value: unknown, label: string): string => {
  if (!isHttpsUrl(value)) {
    throw new Error(`Invalid ${label}: expected an https URL`)
  }
  return value as string
}

type MinimalImage = { file?: unknown; download?: unknown }
type MinimalConfig = {
  name?: unknown
  serial_number?: unknown
  board?: { latestImages?: MinimalImage[] }
}

/**
 * Validate the fields of a parsed .flock/.reswarm config that flow into
 * filesystem paths and download URLs. Throws on the first offending field.
 */
export const assertValidReswarmConfig = (config: MinimalConfig): void => {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid config: not an object')
  }

  // serial_number becomes the deviceId used to build temp/ISO directories.
  assertSafePathSegment(config.serial_number, 'serial_number')
  // name is written as boot/<name>.flock inside the ISO contents.
  assertSafePathSegment(config.name, 'device name')

  const images = config.board?.latestImages
  if (images && Array.isArray(images)) {
    for (const image of images) {
      // image.file is joined onto the ~/.Reflasher cache path.
      if (image.file !== undefined) assertSafePathSegment(image.file, 'image file name')
      // image.download is fetched over the network.
      if (image.download !== undefined) assertHttpsUrl(image.download, 'image download URL')
    }
  }
}
