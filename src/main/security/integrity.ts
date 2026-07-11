import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

// SHA-256 helpers used to verify downloaded artifacts before they are flashed to a
// device or executed. No Electron imports so these can be unit-tested.

/** Stream a file through SHA-256 and return the lowercase hex digest. */
export const sha256File = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Compare two hex digests without regard to case or surrounding whitespace. */
export const digestsMatch = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Verify a file's SHA-256 against an expected hex digest; throws on mismatch.
 * Returns the computed digest on success.
 */
export const verifyFileSha256 = async (filePath: string, expected: string): Promise<string> => {
  const actual = await sha256File(filePath)
  if (!digestsMatch(actual, expected)) {
    throw new Error(`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`)
  }
  return actual
}
