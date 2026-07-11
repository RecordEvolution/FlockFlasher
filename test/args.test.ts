import { describe, it, expect } from 'vitest'
import { buildSudoArgs } from '../src/main/security/args'

describe('buildSudoArgs', () => {
  it('prefixes -E -S and the command, keeping each arg discrete', () => {
    expect(buildSudoArgs('dd', ['if=/img', 'of=/dev/disk2'])).toEqual([
      '-E',
      '-S',
      'dd',
      'if=/img',
      'of=/dev/disk2'
    ])
  })

  it('keeps an argument containing spaces as ONE element (regression: no split on space)', () => {
    const args = buildSudoArgs('mount', ['/Volumes/My Disk/image.iso', '/mnt/target'])
    expect(args).toContain('/Volumes/My Disk/image.iso')
    // The space must not have produced two separate argv entries.
    expect(args.filter((a) => a.includes('My Disk'))).toHaveLength(1)
    expect(args).toHaveLength(5)
  })

  it('does not interpret shell metacharacters in an argument', () => {
    // A malicious serial_number / drive path used to break out of the command
    // string. As a discrete argv element it is passed verbatim to the program,
    // which treats it as a (nonexistent) path, never as shell syntax.
    const evil = 'x; rm -rf / #'
    const args = buildSudoArgs('umount', [evil])
    expect(args[args.length - 1]).toBe(evil)
    expect(args).toHaveLength(4)
  })

  it('handles an empty argument list', () => {
    expect(buildSudoArgs('ls')).toEqual(['-E', '-S', 'ls'])
  })
})
