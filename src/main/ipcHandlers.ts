import { BrowserWindow, OpenDialogOptions, dialog, ipcMain } from 'electron'
import { FlashItem, RPC, imageTypes } from '../types'
import { automountDrive, listDrives, listPartitions, unmountDisk } from '../main/api/drives'
import { scanner } from 'etcher-sdk'
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { scanNetworks } from './api/wifi'
import { cancelFlashing, flashDevice, imageManager } from './api/flash'
import { isSudoPasswordSet, setSudoPassword } from './api/permissions'
import { Drive } from 'drivelist'
import { agentManager, hasDocker } from './api/agent'
import { autoUpdater } from 'electron-updater'
import { assertValidDevicePath, assertValidReswarmConfig } from './security/validation'

// Config files the renderer is allowed to read back through RPC.ReadFile.
const READABLE_CONFIG_EXTENSIONS = ['.flock', '.reswarm']
// Cap on a config file read so a malicious path can't stream a huge file into memory.
const MAX_CONFIG_READ_BYTES = 5 * 1024 * 1024

// Cross-check a renderer-supplied drive against the real removable-drive list so a
// compromised renderer can't aim a privileged write at an arbitrary/system disk.
async function assertFlashableDrive(drive: Drive | undefined): Promise<void> {
  assertValidDevicePath(drive?.device)
  const available = await listDrives()
  const match = available.find((d) => d.device === drive!.device)
  if (!match) {
    throw new Error(`Selected drive is not an available removable drive: ${drive!.device}`)
  }
}

function handleListDrives() {
  return listDrives()
}

function handleUnmount(_, drivePath: string) {
  assertValidDevicePath(drivePath)
  unmountDisk(drivePath)
  return
}

function handleMount(_, drive: Drive) {
  assertValidDevicePath(drive?.device)
  return automountDrive(drive)
}

function handleGetPlatform() {
  return process.platform
}

function handleDriveScanner(mainWindow: BrowserWindow) {
  const adapters: scanner.adapters.Adapter[] = [
    new scanner.adapters.BlockDeviceAdapter({
      includeSystemDrives: () => true
    }),
    new scanner.adapters.UsbbootDeviceAdapter()
  ]
  if (process.platform === 'win32') {
    if (scanner.adapters.DriverlessDeviceAdapter !== undefined) {
      adapters.push(new scanner.adapters.DriverlessDeviceAdapter())
    }
  }
  const deviceScanner = new scanner.Scanner(adapters)
  deviceScanner.on('attach', async (drive: scanner.adapters.AdapterSourceDestination) => {
    mainWindow.webContents.send('drive-scanner-attach', drive)
    if (drive.emitsProgress) {
      drive.on('progress', (progress: number) => {
        mainWindow.webContents.send('drive-scanner-progress', { drive, progress })
      })
    }
  })
  deviceScanner.on('detach', (drive: scanner.adapters.AdapterSourceDestination) => {
    mainWindow.webContents.send('drive-scanner-detach', drive)
  })
  deviceScanner.on('error', (error: Error) => {
    mainWindow.webContents.send('drive-scanner-error', error)
  })
  deviceScanner.start()
}

function handleChooseFile(mainWindow: BrowserWindow) {
  const options: OpenDialogOptions = {
    title: 'Select file',
    defaultPath: process.env.HOME + '/Downloads',
    filters: [{ name: '.flock, .img, .iso, .reswarm', extensions: [...imageTypes] }],
    properties: ['openFile', 'multiSelections']
  }

  return dialog.showOpenDialog(mainWindow, options)
}

// Scoped config reader. This used to be an arbitrary-file-read primitive exposed
// to the renderer; it now only reads .flock/.reswarm config files, as utf8, with a
// size cap — the sole legitimate use (parsing the config being flashed).
async function handleReadFile(_, filePath: string) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('Invalid file path')
  }

  const ext = path.extname(filePath).toLowerCase()
  if (!READABLE_CONFIG_EXTENSIONS.includes(ext)) {
    throw new Error(`Refusing to read non-config file: ${ext || '(no extension)'}`)
  }

  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('Not a regular file')
  if (info.size > MAX_CONFIG_READ_BYTES) throw new Error('Config file too large')

  return readFile(filePath, { encoding: 'utf8' })
}

function handleSupportedBoards() {
  return imageManager.downloadSupportedBoards()
}

function handleWifiScan() {
  return scanNetworks()
}

async function handleFlashDevice(_, mainWindow: BrowserWindow, flashItem: FlashItem) {
  if (!flashItem || typeof flashItem.fullPath !== 'string') {
    throw new Error('Invalid flash item')
  }
  await assertFlashableDrive(flashItem.drive)
  if (flashItem.reswarm?.config) {
    assertValidReswarmConfig(flashItem.reswarm.config)
  }

  return flashDevice(flashItem, (progress) => {
    mainWindow.webContents.send('flash-progress', { progress, id: flashItem.id })
  })
}

function handleAgentEvents(mainWindow: BrowserWindow) {
  agentManager.on('logs', (logs) => {
    mainWindow.webContents.send('agent-logs', { logs })
  })

  agentManager.on('state', ({ activeItem, state }) => {
    mainWindow.webContents.send('agent-state', { activeItem, state })
  })

  agentManager.on('download-progress', ({ progress, state }) => {
    mainWindow.webContents.send('agent-download-progress', { progress, state })
  })
}

async function handleTestDevice(flashItem: FlashItem) {
  const configPath = flashItem?.reswarm?.configPath
  if (typeof configPath !== 'string' || !READABLE_CONFIG_EXTENSIONS.includes(path.extname(configPath).toLowerCase())) {
    throw new Error('Invalid or missing device config path')
  }
  if (flashItem.reswarm?.config) {
    assertValidReswarmConfig(flashItem.reswarm.config)
  }
  return agentManager.startAgent(flashItem)
}

function handleStopDevice() {
  agentManager.stopAgent()
}

async function handleHasDocker() {
  return hasDocker()
}

function handleSetSudoPassword(password: string) {
  return setSudoPassword(password)
}

function handleIsSudoPasswordSet() {
  return isSudoPasswordSet()
}

function handleDownloadUpdate() {
  return autoUpdater.downloadUpdate()
}

function handleInstallUpdate() {
  return autoUpdater.quitAndInstall()
}

function handleCancelFlashing(id: number) {
  return cancelFlashing(id)
}

function handleListPartitions(drive: Drive) {
  assertValidDevicePath(drive?.device)
  return listPartitions(drive)
}

export function setupIpcHandlers(mainWindow: BrowserWindow) {
  ipcMain.handle(RPC.ListDrives, handleListDrives)
  ipcMain.handle(RPC.ListPartitions, (_, drive) => handleListPartitions(drive))
  ipcMain.handle(RPC.Unmount, handleUnmount)
  ipcMain.handle(RPC.Mount, handleMount)
  ipcMain.handle(RPC.ChooseFile, () => handleChooseFile(mainWindow))
  ipcMain.handle(RPC.ReadFile, handleReadFile)
  ipcMain.handle(RPC.GetSupportedBoards, handleSupportedBoards)
  ipcMain.handle(RPC.ScanWifi, handleWifiScan)
  ipcMain.handle(RPC.FlashDevice, (_, flashItem) => handleFlashDevice(_, mainWindow, flashItem))
  ipcMain.handle(RPC.SetSudoPassword, (_, password) => handleSetSudoPassword(password))
  ipcMain.handle(RPC.IsSudoPasswordSet, handleIsSudoPasswordSet)
  ipcMain.handle(RPC.CancelFlashing, (_, id) => handleCancelFlashing(id))
  ipcMain.handle(RPC.GetPlatform, handleGetPlatform)
  ipcMain.handle(RPC.TestDevice, (_, flashItem) => handleTestDevice(flashItem))
  ipcMain.handle(RPC.StopDevice, handleStopDevice)
  ipcMain.handle(RPC.HasDocker, handleHasDocker)
  ipcMain.handle(RPC.DownloadUpdate, handleDownloadUpdate)
  ipcMain.handle(RPC.InstallUpdate, handleInstallUpdate)

  handleDriveScanner(mainWindow)
  handleAgentEvents(mainWindow)
}
