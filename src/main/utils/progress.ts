// Pure progress-math helpers, deliberately free of Electron/Node-runtime imports
// so they can be unit-tested in a plain Node environment (see progress.test.ts).

export const calculateSpeed = (
  written: number,
  elapsedTimeSeconds: number
): { speed: number; averageSpeed: number } => {
  if (elapsedTimeSeconds <= 0) return { speed: 0, averageSpeed: 0 }
  // elapsedTimeSeconds is already in seconds; both fields are cumulative bytes/second.
  // (The previous averageSpeed divided by 1000 again, inflating it 1000x.)
  const bytesPerSecond = written / elapsedTimeSeconds
  return { speed: bytesPerSecond, averageSpeed: bytesPerSecond }
}

export const calculateETA = (written: number, speed: number, totalSize: number): number => {
  if (speed <= 0) return 0 // unknown; avoid Infinity/NaN reaching the UI
  const remainingBytes = Math.max(totalSize - written, 0)
  return remainingBytes / speed // Seconds
}
