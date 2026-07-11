import { homedir } from 'node:os'
import { createGunzip } from 'node:zlib'
import { access, mkdir, readFile } from 'node:fs/promises'
import { createWriteStream, createReadStream } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { ImageInfo, Progress, SupportedBoard } from '../../types'
import { calculateETA, calculateSpeed, downloadFile } from '../utils'

const CONFIG_PATH = '.Reflasher'
const AVAILABLE_IMAGES = 'supportedBoardsImages.json'
const BUCKET_URL = 'https://instance-registry.ironflock.com/dl/reswarmos/'
export const REFLASHER_CONFIG_PATH = path.join(homedir(), CONFIG_PATH)

export default class ImageManager {
  getImagePath(image: ImageInfo) {
    return path.join(REFLASHER_CONFIG_PATH, image.file.slice(0, -3))
  }

  async createReflasherDirIfNotExists() {
    try {
      await access(REFLASHER_CONFIG_PATH)
    } catch {
      console.log(`Creating config folder at ${REFLASHER_CONFIG_PATH}`)
      try {
        await mkdir(REFLASHER_CONFIG_PATH)
      } catch (error) {
        console.log('Could not create config folder')
        throw error
      }
    }
  }

  async readSupportedBoards(): Promise<SupportedBoard[]> {
    const fileContent = await readFile(path.join(REFLASHER_CONFIG_PATH, AVAILABLE_IMAGES))
    const parsed = JSON.parse(fileContent.toString())
    return parsed.boards
  }

  downloadSupportedBoards(): Promise<SupportedBoard[]> {
    let file = ''
    return new Promise((resolve, reject) => {
      https
        .get(BUCKET_URL + AVAILABLE_IMAGES, (req) => {
          req.on('data', (d) => {
            file = file + d.toString()
          })
          req.on('error', (err) => reject(err))
        })
        .on('error', (err) => {
          reject(err)
        })
        .on('close', () => {
          resolve(JSON.parse(file).boards)
        })
    })
  }

  async checkIfImageZipExists(image: ImageInfo): Promise<boolean> {
    try {
      await access(path.join(REFLASHER_CONFIG_PATH, image.file))
      return true
    } catch {
      return false
    }
  }

  async checkIfImageFileExists(image: ImageInfo): Promise<boolean> {
    try {
      await access(path.join(REFLASHER_CONFIG_PATH, image.file.slice(0, -3)))
      return true
    } catch {
      return false
    }
  }

  async downloadImageToFile(
    image: ImageInfo,
    tempPath: string,
    progress?: (payload: Partial<Progress>) => void
  ) {
    if (progress) {
      progress({ averageSpeed: 0, eta: 0, percentage: 0, speed: 0, bytesWritten: 0 })
    }

    return downloadFile(image.download, tempPath, progress)
  }

  unZipImage(
    image: ImageInfo,
    tempPath: string,
    progress?: (progress: {
      percentage: number
      averageSpeed: number
      speed: number
      eta: number
      bytesWritten: number
    }) => void
  ): Promise<void> {
    const sourcePath = tempPath
    const fileExtension = path.extname(sourcePath)

    if (fileExtension !== '.gz') {
      throw new Error(`Unzip error: file extension '${fileExtension}' is not supported!`)
    }

    const targetPath = sourcePath.slice(0, -3)

    const readStream = createReadStream(sourcePath)
    const writeStream = createWriteStream(targetPath)
    const zipTransform = createGunzip()

    zipTransform.pipe(writeStream)

    let written = 0
    // Set once at the start: `written` is cumulative, so elapsed time must be measured
    // from the beginning of the whole decompression, not reset on every chunk.
    const startTime = Date.now()

    if (progress) {
      progress({ averageSpeed: 0, eta: 0, percentage: 0, speed: 0, bytesWritten: 0 })
    }

    return new Promise((resolve, reject) => {
      readStream.on('data', (buf) => {
        zipTransform.write(buf, (err) => {
          if (err) {
            reject(err)
          }
          if (progress) {
            written += buf.length
            const elapsedTime = (Date.now() - startTime) / 1000 // Convert to seconds
            const { speed, averageSpeed } = calculateSpeed(written, elapsedTime)
            const eta = calculateETA(written, speed, image.size)
            const percentage = (written / image.size) * 100
            progress({ percentage, averageSpeed, eta, speed, bytesWritten: written })
          }
        })
      })

      readStream.on('end', () => {
        zipTransform.end()
      })

      zipTransform.on('end', () => {
        resolve()
      })
    })
  }
}
