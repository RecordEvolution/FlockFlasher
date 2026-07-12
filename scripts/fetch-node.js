// Downloads a standalone Node.js binary into resources/binaries/<platform>/ so the
// elevated FLASH subprocess can run under REAL Node instead of Electron.
//
// Why: Electron's V8 Memory Cage (Electron 21+) forbids external buffers, which
// etcher-sdk's @ronomon/direct-io needs for O_DIRECT block writes. Running the
// flasher via ELECTRON_RUN_AS_NODE therefore aborts. A real Node has no memory
// cage, so it can flash. etcher-sdk's native deps used on the flash path are all
// N-API (drivelist, direct-io, xxhash), which are ABI-stable across Node/Electron,
// so no separate native build is needed. See README "Flashing runtime".
//
// Runs in postinstall (per build machine), so it fetches the current platform's
// binary. The binary is git-ignored; electron-builder bundles it via asarUnpack.

const fs = require('fs')
const os = require('os')
const path = require('path')
const https = require('https')
const { execFileSync } = require('child_process')

const NODE_VERSION = '22.19.0'

const platform = process.platform // 'darwin' | 'win32' | 'linux'
const arch = platform === 'darwin' ? process.arch : 'x64' // mac follows host arch; win/linux x64

const destDir = path.join(__dirname, '..', 'resources', 'binaries', platform)
const destBinary = path.join(destDir, platform === 'win32' ? 'node.exe' : 'node')

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close()
          fs.rmSync(dest, { force: true })
          return download(new URL(res.headers.location, url).toString(), dest).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.rmSync(dest, { force: true })
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
      })
      .on('error', (err) => {
        file.close()
        fs.rmSync(dest, { force: true })
        reject(err)
      })
  })
}

async function main() {
  if (fs.existsSync(destBinary)) {
    console.log(`[fetch-node] ${destBinary} already present, skipping`)
    return
  }

  fs.mkdirSync(destDir, { recursive: true })
  const tmp = path.join(os.tmpdir(), `node-fetch-${process.pid}`)
  fs.mkdirSync(tmp, { recursive: true })

  const base = `https://nodejs.org/dist/v${NODE_VERSION}`

  if (platform === 'win32') {
    // Node publishes the raw node.exe for Windows — no archive to extract.
    const url = `${base}/win-${arch}/node.exe`
    console.log(`[fetch-node] downloading ${url}`)
    await download(url, destBinary)
  } else {
    const osKey = platform === 'darwin' ? 'darwin' : 'linux'
    const name = `node-v${NODE_VERSION}-${osKey}-${arch}`
    const url = `${base}/${name}.tar.gz`
    const tarball = path.join(tmp, `${name}.tar.gz`)
    console.log(`[fetch-node] downloading ${url}`)
    await download(url, tarball)
    // Extract just the node binary (bsdtar/gnutar are present on macOS and Linux).
    execFileSync('tar', ['-xzf', tarball, '-C', tmp, `${name}/bin/node`], { stdio: 'inherit' })
    fs.copyFileSync(path.join(tmp, name, 'bin', 'node'), destBinary)
    fs.chmodSync(destBinary, 0o755)
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  const { size } = fs.statSync(destBinary)
  console.log(`[fetch-node] wrote ${destBinary} (${Math.round(size / 1e6)} MB), node v${NODE_VERSION}`)
}

main().catch((err) => {
  console.error('[fetch-node] failed:', err.message)
  process.exit(1)
})
