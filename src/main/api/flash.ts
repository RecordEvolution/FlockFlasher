import { automountDriveLinux, waitForMount } from './drives'
import { getNodeModulesResourcePath, killProcessDarwin } from '../utils'
import { ChildProcess } from 'child_process'
import { FlashItem, Progress } from '../../types'
import { elevatedNodeChildProcess } from './permissions'
import { copyFile, rename, unlink, writeFile } from 'fs/promises'
import ImageManager, { REFLASHER_CONFIG_PATH } from './boards'
import path from 'path'
import { Drive } from 'drivelist'
import {
  cleanupISOContents,
  extractISO,
  rebuildISOFromContents,
  unmountISO,
  writeFileISOContents
} from './iso'

const activeFlashProcesses = new Map<number, ChildProcess>()
export const imageManager = new ImageManager()
imageManager.createReflasherDirIfNotExists()

const copyConfigFile = async (drive: Drive, reswarmConfigPath: string) => {
  // For some reason linux doesn't automount the drive, so we have to manually do it
  if (process.platform === 'linux') {
    await automountDriveLinux(drive)
  }

  const mountedDrive = await waitForMount(drive.description)

  if (mountedDrive.mountpoints.length === 0) {
    throw new Error('Mountpoint not found!')
  }

  const targetPath = mountedDrive.mountpoints[0].path
  const fileBaseName = path.basename(reswarmConfigPath)

  // Backwards compatibility for .flock files
  // It will always create a second config file with the name .reswarm in case a .flock file is provided
  try {
    const fileBaseNameSplit = fileBaseName.split(".")
    if (fileBaseNameSplit[1] === 'flock') {
      const dotReswarmFileName = fileBaseNameSplit[0] + '.reswarm'
      console.log("Creating copy of .flock file as .reswarm for backwards compatibility")
      await copyFile(reswarmConfigPath, path.join(targetPath, dotReswarmFileName))  
    }
  } catch (error) {
    console.error("Failed to copy a copy of .flock")
  }

  return copyFile(reswarmConfigPath, path.join(targetPath, fileBaseName))
}

const getReswarmImage = async (
  flashItem: FlashItem,
  updateState: (data: Partial<Progress>) => void
): Promise<string> => {
  const image = flashItem.reswarm?.config?.board.latestImages[0]
  let imagePath = flashItem.fullPath

  // Update .reswarm file (for WiFi information, etc.)
  await writeFile(flashItem.fullPath, JSON.stringify(flashItem.reswarm!.config))

  if (!image) throw new Error('latest image is empty')

  const imageFileExists = await imageManager.checkIfImageFileExists(image)
  if (imageFileExists) {
    imagePath = imageManager.getImagePath(image)
  } else {
    const zippedImageTempPath = path.join(REFLASHER_CONFIG_PATH, 'temp-' + image.file)
    const realImageTempPath = path.join(REFLASHER_CONFIG_PATH, 'temp-' + image.file.slice(0, -3))

    const realImagePath = path.join(REFLASHER_CONFIG_PATH, image.file.slice(0, -3))

    try {
      await imageManager.downloadImageToFile(image, zippedImageTempPath, (progress) => {
        updateState({ ...progress, type: 'downloading' })
      })

      await imageManager.unZipImage(image, zippedImageTempPath, (progress) => {
        updateState({ ...progress, type: 'decompressing' })
      })

      await rename(realImageTempPath, realImagePath)

      imagePath = imageManager.getImagePath(image)
    } finally {
      unlink(zippedImageTempPath)
    }
  }

  if (image?.osvariant !== 'image') {
    const config = flashItem.reswarm!.config!
    const deviceId = flashItem.reswarm!.config?.serial_number!

    // cleanup old ISO contents
    await cleanupISOContents(deviceId)

    const devicePath = await extractISO(imagePath, deviceId, (percentage) => {
      updateState({ percentage, type: 'extracting-iso' })
    })

    await writeFileISOContents(`boot/${config.name}.flock`, JSON.stringify(config), deviceId)

    // Backwards compatibility
    await writeFileISOContents(`boot/${config.name}.reswarm`, JSON.stringify(config), deviceId)

    const recreatedImagePath = await rebuildISOFromContents(imagePath, deviceId, (percentage) => {
      updateState({ percentage, type: 'recreating-iso' })
    })

    unmountISO(deviceId, devicePath).catch(console.error)

    return recreatedImagePath
  }

  return imagePath
}

export const flashDevice = async (
  flashItem: FlashItem,
  updateState: (data: Partial<Progress>) => void
) => {
  if (!flashItem.drive || !flashItem.fullPath) throw new Error('drive not set')

  let imagePath = flashItem.fullPath
  const image = flashItem.reswarm?.config?.board.latestImages[0]

  if (flashItem.reswarm) {
    imagePath = await getReswarmImage(flashItem, updateState)
  }

  let stringifiedDrive = JSON.stringify(flashItem.drive)
  if (process.platform === 'win32') {
    imagePath = imagePath.replace(/\\/g, '\\\\')
    stringifiedDrive = stringifiedDrive.replace(/\\/g, '\\\\')
  }

  const etcherSDKRequire = getNodeModulesResourcePath('etcher-sdk')
  const scriptContent = `
    const { sourceDestination, multiWrite } = require('${etcherSDKRequire}')
    let progressData;

    process.on('SIGTERM', () => {
      process.stdout.write(\`{"canceled":true, "type": "\${progressData.type}" }\`)
      process.exit(1)
    });

    async function flash() {
      const _imageFile = new sourceDestination.File({
        path: "${imagePath}"
      })
    
      const drive = JSON.parse('${stringifiedDrive}')
      const _blockDevice = new sourceDestination.BlockDevice({
        drive,
        write: true,
        unmountOnSuccess: false
      })

      const source = await _imageFile.getInnerSource()

      await multiWrite.decompressThenFlash({
        source,
        destinations: [_blockDevice],
        onFail: (_, error) => {
          console.log(error)
          process.exit(1)
        },
        onProgress: (progress) => {
          progressData = progress
          process.stdout.write(JSON.stringify(progress))
        },
        verify: true
      })
      
      progressData.type = "${flashItem.reswarm ? 'configuring' : 'finished'}"
      const finalPayload = JSON.stringify(progressData)
      process.stdout.write(finalPayload)
    }

    flash()
  `

  async function handleOnExit(code: number | null, signal: NodeJS.Signals | null) {
    activeFlashProcesses.delete(flashItem.id)

    // Copy the file over when the flashing process has exited without an error code
    if (code === 0 && signal === null && flashItem.reswarm) {
      if (image?.osvariant === 'image') {
        try {
          await copyConfigFile(flashItem.drive!, flashItem.fullPath)
        } catch (error) {
          if (process.platform !== 'win32') throw error

          // For some reason, the first time this fails on windows, doing it again works.
          await copyConfigFile(flashItem.drive!, flashItem.fullPath)
        }
      }

      updateState({ type: 'finished' })
    }
  }

  updateState({ type: 'starting' })

  const childProcess = await elevatedNodeChildProcess(
    scriptContent,
    (data) => {
      try {
        updateState(JSON.parse(data))
      } catch (error) {
        console.error('An error occurred while flashing:', data)
        updateState({ type: 'failed' })
      }
    },
    console.error,
    handleOnExit
  )

  activeFlashProcesses.set(flashItem.id, childProcess)
}

export const cancelFlashing = async (id: number) => {
  const flashProcess = activeFlashProcesses.get(id)
  if (flashProcess && flashProcess.pid) {
    if (process.platform === 'darwin') {
      killProcessDarwin(15, flashProcess.pid) // SIGTERM
    } else {
      flashProcess.kill('SIGTERM')
    }
  }
}
