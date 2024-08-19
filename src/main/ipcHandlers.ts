import { BrowserWindow, OpenDialogOptions, dialog, ipcMain } from 'electron'
import { FlashItem, RPC, imageTypes } from '../types'
import { automountDrive, listDrives, listPartitions, unmountDisk } from '../main/api/drives'
import { scanner } from 'etcher-sdk'
import { readFile } from 'fs/promises'
import { OpenMode } from 'fs'
import { Abortable } from 'events'
import { scanNetworks } from './api/wifi'
import { cancelFlashing, flashDevice, imageManager } from './api/flash'
import { isSudoPasswordSet, setSudoPassword } from './api/permissions'
import { Drive } from 'drivelist'
import { agentManager, hasDocker } from './api/agent'
import { autoUpdater } from 'electron-updater'

function handleListDrives() {
  return listDrives()
}

function handleUnmount(_, drivePath: string) {
  unmountDisk(drivePath)
  return
}

function handleMount(_, drive: Drive) {
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

function handleReadFile(
  _,
  path: string,
  options?:
    | ({
        encoding: BufferEncoding
        flag?: OpenMode | undefined
      } & Abortable)
    | BufferEncoding
) {
  return readFile(path, options)
}

function handleSupportedBoards() {
  return imageManager.downloadSupportedBoards()
}

function handleWifiScan() {
  return scanNetworks()
}

function handleFlashDevice(_, mainWindow: BrowserWindow, flashItem: FlashItem) {
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

function handleTestDevice(flashItem: FlashItem) {
  agentManager.startAgent(flashItem)
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
