import { PowerShell } from 'node-powershell'
import os from 'os'
import fsExtra from 'fs-extra'
import path from 'path'
import { resourcesPath } from 'process'
import { is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { childProcess, elevatedSpawn, spawnAsync } from './permissions'

const unsupportedBinariesMac = ['xorriso']

const getISOMountPath = (deviceId: string) => path.join(os.tmpdir(), 'iso-mount', deviceId)

const getISOContentsPath = (deviceId: string) => path.join(os.tmpdir(), 'iso-contents', deviceId)

const getTempDataPath = (deviceId: string) => path.join(os.tmpdir(), deviceId)

export const resolveBinaryPath = (command: string) => {
  if (process.platform === 'linux') return command

  if (process.platform === 'darwin' && !unsupportedBinariesMac.includes(command)) {
    return command
  }

  const binariesPath = is.dev
    ? path.join(app.getAppPath(), 'resources', 'binaries', process.platform)
    : path.join(resourcesPath, 'app.asar.unpacked', 'resources', 'binaries', process.platform)

  let commandPath = `./${command}`
  if (process.platform === 'win32') {
    commandPath += '.exe'
  }

  return path.resolve(path.join(binariesPath, `./${commandPath}`))
}

const getFolderSize = async (folderPath: string) => {
  const commands: Record<string, { cmd: string; args: string[] }> = {
    win32: {
      cmd: resolveBinaryPath('du'),
      args: ['-nobanner', '-accepteula', '-q', '-c', folderPath]
    },
    darwin: { cmd: 'du', args: ['-sk', folderPath] },
    linux: { cmd: 'du', args: ['-sb', folderPath] }
  }

  const { cmd, args } = commands[process.platform]
  const { stdout } = await elevatedSpawn(cmd, args)
  switch (process.platform) {
    case 'win32': {
      const stats = stdout.split('\n')[1].split(',')
      const bytes = +stats.slice(-2)[0]
      return bytes
    }
    case 'linux': {
      const match = /^(\d+)/.exec(stdout)
      const bytes = Number(match?.[1] ?? 0)
      return bytes
    }
    case 'darwin': {
      const match = /^(\d+)/.exec(stdout)
      const bytes = Number(match?.[1] ?? 0) * 1024
      return bytes
    }
  }

  return 0
}

const unmountISOLinux = async (deviceId: string) => {
  const mountedPath = getISOMountPath(deviceId)
  return elevatedSpawn('umount', [mountedPath])
}

const unmountISOMac = async (attachedDisk: string) => {
  return elevatedSpawn('hdiutil', ['detach', attachedDisk])
}

const remove = (path) => {
  return fsExtra.rm(path, { force: true, recursive: true })
}

const cleanupISOContents = async (deviceId: string, isoPath?: string) => {
  const mountedPath = getISOMountPath(deviceId)
  const contentsPath = getISOContentsPath(deviceId)

  if (isoPath) {
    await remove(isoPath)
  }

  await remove(mountedPath)

  return remove(contentsPath)
}

const unmountISOWindows = async (devicePath: string) => {
  const ps = new PowerShell()
  const unmountCommand = PowerShell.command`Dismount-DiskImage -DevicePath ${devicePath}`

  await ps.invoke(unmountCommand)

  return ps.dispose()
}

const writeFileISOContents = async (fileName: string, data, deviceId) => {
  const contentsPath = getISOContentsPath(deviceId)
  // Guard against path traversal via fileName (e.g. a crafted config.name): the
  // resolved target must stay inside the ISO contents directory.
  const target = path.resolve(contentsPath, fileName)
  const root = path.resolve(contentsPath)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Refusing to write outside the ISO contents directory')
  }
  return fsExtra.writeFile(target, data, { encoding: 'utf8', mode: 0o644 })
}

const blockSizes = {
  k: 1024,
  m: Math.pow(1024, 2),
  g: Math.pow(1024, 3),
  t: Math.pow(1024, 4),
  s: 2048,
  d: 512
}

const handleRecreateProgress = (progress: string, progressCb?: (progress: number) => void) => {
  const match = progress.match(/(\d*\.\d*)%/)

  if (!match || match.length <= 1) return

  const progressPercent = Number(match[1])

  if (progressCb) {
    progressCb(progressPercent)
  }
}

const rebuildISOFromContents = async (
  originalISOPath: string,
  deviceId: string,
  progressCb?: (progress: number) => void
) => {
  if (progressCb) {
    progressCb(0)
  }

  const xorrisoPath = resolveBinaryPath('xorriso')
  const { stdout } = await elevatedSpawn(xorrisoPath, [
    '-indev',
    originalISOPath,
    '-report_el_torito',
    'as_mkisofs'
  ])

  const contentsPath = getISOContentsPath(deviceId)
  const tempMetaDataPath = getTempDataPath(deviceId)

  await fsExtra.mkdirp(contentsPath)
  await fsExtra.mkdirp(tempMetaDataPath)

  const regexp = new RegExp("--interval:(.*):(.*):(.*):'(.*)'")
  const match = regexp.exec(stdout)

  if (!match) throw new Error('failed to get interval')

  match.shift()

  const [fs, interval, zero] = match
  const splitInterval = interval.split('-')
  const [startBlock, stopBlock] = splitInterval.map((e) => Number(e.match(/\d*/)?.[0] ?? 0))
  const [blockSizeUnit] = splitInterval.map((s) => s.match(/\D/)?.[0] ?? 0)
  const blockSize = blockSizes[blockSizeUnit]
  const blockCount = stopBlock - startBlock + 1
  const skipBlock = startBlock
  const bootPartitionImagePath = `${tempMetaDataPath}/partition.img`

  // Extract boot partition from ISO
  const ddPath = resolveBinaryPath('dd')
  await elevatedSpawn(ddPath, [
    `if=${originalISOPath}`,
    `bs=${blockSize}`,
    `skip=${skipBlock}`,
    `count=${blockCount}`,
    `of=${bootPartitionImagePath}`
  ])

  let newISOPathSplit = originalISOPath.split('.')
  newISOPathSplit.pop()

  const newISOPath = newISOPathSplit.join('.') + `-${deviceId}.iso`

  // `${xorrisoPath} -as mkisofs \
  // -r \
  // -J \
  // -joliet-long \
  // -l \
  // -iso-level 3 \
  // -V 'ReswarmOS' \
  // -isohybrid-mbr \
  // --interval:${fs}:${interval}:${zero}:'${bootPartitionImagePath}' \
  // -partition_cyl_align off \
  // -partition_offset 0 \
  // --mbr-force-bootable \
  // -apm-block-size 2048 \
  // -iso_mbr_part_type 0x00 \
  // -c '/isolinux/boot.cat' \
  // -b '/isolinux/isolinux.bin' \
  // -no-emul-boot \
  // -boot-load-size 4 \
  // -boot-info-table \
  // -eltorito-alt-boot \
  // -e '/boot/grub/efi.img' \
  // -no-emul-boot \
  // -boot-load-size 8000 \
  // -isohybrid-gpt-basdat \
  // -isohybrid-apm-hfsplus \
  // -o ${newISOPath} \
  // .`,

  const args = [
    '-as',
    'mkisofs',
    '-r',
    '-J',
    '-joliet-long',
    '-l',
    '-iso-level',
    '3',
    '-V',
    'ReswarmOS',
    '-isohybrid-mbr',
    `--interval:${fs}:${interval}:${zero}:${bootPartitionImagePath}`,
    '-partition_cyl_align',
    'off',
    '-partition_offset',
    '0',
    '--mbr-force-bootable',
    '-apm-block-size',
    '2048',
    '-iso_mbr_part_type',
    '0x00',
    '-c',
    '/isolinux/boot.cat',
    '-b',
    '/isolinux/isolinux.bin',
    '-no-emul-boot',
    '-boot-load-size',
    '4',
    '-boot-info-table',
    '-eltorito-alt-boot',
    '-e',
    '/boot/grub/efi.img',
    '-no-emul-boot',
    '-boot-load-size',
    '8000',
    '-isohybrid-gpt-basdat',
    '-isohybrid-apm-hfsplus',
    '-o',
    newISOPath,
    '.'
  ]

  // Rebuild ISO
  await new Promise((res, rej) => {
    childProcess(
      xorrisoPath,
      args,
      undefined,
      // For some reason xorriso update progress is piped to stderr
      (stderr) => handleRecreateProgress(stderr, progressCb),
      (code, signal) => {
        if (code === 0 && signal === null) {
          res(true)
        } else {
          rej(false)
        }
      },
      { cwd: contentsPath, elevated: true }
    )
  })

  // remove temp directory
  const tempPath = getTempDataPath(deviceId)
  await remove(tempPath)

  return newISOPath
}

const handleRsyncProgress = (stdout, legacy, onProgress?: (progress: number) => void) => {
  const entries = stdout.split('\r').filter((e) => e) // remove empty spaces

  const parsedEntries = entries.map((str) => {
    const match = legacy ? str.match(/to-check=(\d*)\/(\d*)/) : str.match(/(\d*)%/)
    if (!match) return undefined

    if (legacy) {
      const [, toTransferString, totalString] = match
      const filesLeftToTransfer = Number(toTransferString)
      const totalFilesToTransfer = Number(totalString)
      return Math.floor((1 - filesLeftToTransfer / totalFilesToTransfer) * 100)
    }

    return Number(match[1])
  })

  const percentageValues = parsedEntries.filter((e) => e) // filter out undefined values
  percentageValues.forEach((pNum) => {
    if (onProgress) {
      onProgress(pNum)
    }
  })
}

const extractISOContentsMac = async (
  absoluteISOPath: string,
  deviceId: string,
  onProgress?: (progress: number) => void
) => {
  if (onProgress) {
    onProgress(0)
  }

  const srcPath = getISOMountPath(deviceId)
  const destPath = getISOContentsPath(deviceId)

  await fsExtra.mkdirp(srcPath)
  await fsExtra.mkdirp(destPath)

  const { stdout } = await elevatedSpawn('hdiutil', ['attach', '-nomount', absoluteISOPath])
  const attachedDisk = stdout.split('\n')[0].split('\t')[0].trim()

  let progressInterval: NodeJS.Timeout | undefined
  try {
    await elevatedSpawn('mount', ['-t', 'cd9660', attachedDisk, srcPath])

    const src = await getFolderSize(srcPath)
    progressInterval = setInterval(async () => {
      const dest = await getFolderSize(destPath)
      const progressPercent = Math.min((dest / src) * 100, 100)
      if (onProgress) {
        onProgress(progressPercent)
      }
    }, 1000)

    // Do NOT swallow rsync failures — a partial copy would flash a corrupt image.
    await spawnAsync('rsync', ['-az', `${srcPath}/`, `${destPath}/`])
    clearInterval(progressInterval)
    progressInterval = undefined

    await elevatedSpawn('chmod', ['-R', '777', destPath])
  } finally {
    // Always release the interval and unmount/detach the source ISO, even on failure,
    // so a thrown error can't leak an attached disk image.
    if (progressInterval) clearInterval(progressInterval)
    await elevatedSpawn('umount', [srcPath]).catch(() => undefined)
    await elevatedSpawn('hdiutil', ['detach', attachedDisk]).catch(() => undefined)
  }

  return attachedDisk
}

const extractISOContentsLinux = async (
  absoluteISOPath: string,
  deviceId: string,
  onProgress?: (progress: number) => void
) => {
  if (onProgress) {
    onProgress(0)
  }

  const srcPath = getISOMountPath(deviceId)
  const destPath = getISOContentsPath(deviceId)

  await fsExtra.mkdirp(srcPath)
  await fsExtra.mkdirp(destPath)
  await elevatedSpawn('mount', [absoluteISOPath, srcPath])

  if (onProgress) {
    onProgress(0)
  }

  const command = `rsync`
  const args = ['-az', '--info=progress2', `${srcPath}/`, `${destPath}/`]

  await new Promise((res, rej) => {
    childProcess(
      command,
      args,

      (stdout) => {
        handleRsyncProgress(stdout, false, onProgress)
      },
      console.error,
      (code, signal) => {
        if (code === 0 && signal === null) {
          res(true)
        } else {
          rej(false)
        }
      }
    )
  })

  await elevatedSpawn('umount', [srcPath])

  await elevatedSpawn('chmod', ['-R', '777', destPath])

  return null
}

const extractISOContentsWin = async (
  absoluteISOPath: string,
  deviceId: string,
  onProgress?: (progress: number) => void
) => {
  if (onProgress) {
    onProgress(0)
  }

  const destPath = getISOContentsPath(deviceId)
  await fsExtra.mkdirp(destPath)

  const ps = new PowerShell()
  const mountCommand = PowerShell.command`Mount-DiskImage -ImagePath ${absoluteISOPath} -PassThru | Select-Object -ExpandProperty DevicePath`
  const { raw: devicePath } = await ps.invoke(mountCommand)
  // stateManager.setValue(deviceId, 'devicePath', devicePath)

  const volumeCommand = PowerShell.command`Get-Volume -DiskImage (Get-DiskImage -DevicePath ${devicePath}) | Select-Object -ExpandProperty DriveLetter`
  const { raw: driveLetter } = await ps.invoke(volumeCommand)
  // stateManager.setValue(deviceId, 'driveLetter', driveLetter)

  const src = await getFolderSize(`${driveLetter}:\\`)
  const progressInterval = setInterval(async () => {
    const dest = await getFolderSize(destPath)
    const progressPercent = (dest / src) * 100
    if (onProgress) {
      onProgress(progressPercent)
    }
  }, 1000)

  await fsExtra.copy(`${driveLetter}:\\`, destPath)
  clearInterval(progressInterval)

  const unmountCommand = PowerShell.command`Dismount-DiskImage -ImagePath ${absoluteISOPath}`

  await ps.invoke(unmountCommand)
  await ps.dispose()

  return devicePath
}

const unmountISO = (deviceId: string, drivePath: string | null) => {
  switch (process.platform) {
    case 'win32':
      if (!drivePath) throw Error('drive path is missing!')
      return unmountISOWindows(drivePath)
    case 'darwin':
      if (!drivePath) throw Error('drive path is missing!')
      return unmountISOMac(drivePath)
    case 'linux':
      return unmountISOLinux(deviceId)
  }

  throw new Error('unsupported platform')
}

const extractISO = (
  absoluteISOPath: string,
  deviceId: string,
  onProgress?: (progress: number) => void
): Promise<string | null> => {
  switch (process.platform) {
    case 'win32':
      return extractISOContentsWin(absoluteISOPath, deviceId, onProgress)
    case 'darwin':
      return extractISOContentsMac(absoluteISOPath, deviceId, onProgress)
    case 'linux':
      return extractISOContentsLinux(absoluteISOPath, deviceId, onProgress)
  }

  throw new Error('unsupported platform')
}

export { extractISO, unmountISO, rebuildISOFromContents, cleanupISOContents, writeFileISOContents }
