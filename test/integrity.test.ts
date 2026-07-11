import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { sha256File, digestsMatch, verifyFileSha256 } from '../src/main/security/integrity'

let dir: string
let filePath: string
const contents = 'flockflasher integrity test payload'
const expected = createHash('sha256').update(contents).digest('hex')

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ff-integrity-'))
  filePath = path.join(dir, 'payload.bin')
  await writeFile(filePath, contents)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sha256File', () => {
  it('computes the expected digest', async () => {
    expect(await sha256File(filePath)).toBe(expected)
  })
})

describe('digestsMatch', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(digestsMatch(expected, expected.toUpperCase())).toBe(true)
    expect(digestsMatch(expected, `  ${expected}\n`)).toBe(true)
    expect(digestsMatch(expected, 'deadbeef')).toBe(false)
  })
})

describe('verifyFileSha256', () => {
  it('resolves when the digest matches', async () => {
    await expect(verifyFileSha256(filePath, expected)).resolves.toBe(expected)
  })

  it('throws on mismatch', async () => {
    await expect(verifyFileSha256(filePath, 'f'.repeat(64))).rejects.toThrow(/SHA-256 mismatch/)
  })
})
