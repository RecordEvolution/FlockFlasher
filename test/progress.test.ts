import { describe, it, expect } from 'vitest'
import { calculateSpeed, calculateETA } from '../src/main/utils/progress'

describe('calculateSpeed', () => {
  it('reports bytes/second for elapsed time given in seconds', () => {
    const { speed, averageSpeed } = calculateSpeed(1_000_000, 2)
    expect(speed).toBe(500_000)
    // Regression: averageSpeed used to be 1000x too large (divided seconds by 1000 again).
    expect(averageSpeed).toBe(500_000)
  })

  it('does not divide the elapsed seconds by 1000', () => {
    const { averageSpeed } = calculateSpeed(1000, 1)
    expect(averageSpeed).toBe(1000)
    expect(averageSpeed).not.toBe(1_000_000)
  })

  it('returns zero for a non-positive elapsed time instead of Infinity/NaN', () => {
    expect(calculateSpeed(1000, 0)).toEqual({ speed: 0, averageSpeed: 0 })
    expect(calculateSpeed(1000, -1)).toEqual({ speed: 0, averageSpeed: 0 })
  })
})

describe('calculateETA', () => {
  it('computes remaining seconds from cumulative speed', () => {
    // 10MB total, 4MB written, 2MB/s -> 6MB remaining -> 3s
    expect(calculateETA(4_000_000, 2_000_000, 10_000_000)).toBe(3)
  })

  it('returns 0 (unknown) when speed is zero, never Infinity', () => {
    expect(calculateETA(0, 0, 1000)).toBe(0)
  })

  it('never returns a negative ETA once the download overshoots the size', () => {
    expect(calculateETA(1200, 100, 1000)).toBe(0)
  })
})
