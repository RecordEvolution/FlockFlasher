import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { FlashItem, RPC, SupportedBoard } from '../types'
import { Drive } from 'drivelist'
import { WiFiNetwork } from 'node-wifi'

// Custom APIs for renderer
const api = {
  listDrives: () => ipcRenderer.invoke(RPC.ListDrives) as Promise<Drive[]>,
  listPartitions: (drive: Drive, password?: string) =>
    ipcRenderer.invoke(RPC.ListPartitions, drive, password),
  unmount: (path: string) => ipcRenderer.invoke(RPC.Unmount, path) as Promise<void>,
  mount: (drive: Drive) => ipcRenderer.invoke(RPC.Mount, drive) as Promise<void>,
  chooseFile: () => ipcRenderer.invoke(RPC.ChooseFile) as Promise<Electron.OpenDialogReturnValue>,
  // Scoped in the main process to .flock/.reswarm config files; returns utf8 text.
  readFile: (path: string) => ipcRenderer.invoke(RPC.ReadFile, path) as Promise<string>,
  getSupportedBoards: () => ipcRenderer.invoke(RPC.GetSupportedBoards) as Promise<SupportedBoard[]>,
  scanWifi: () => ipcRenderer.invoke(RPC.ScanWifi) as Promise<WiFiNetwork[]>,
  testDevice: (flashItem: FlashItem) => ipcRenderer.invoke(RPC.TestDevice, flashItem),
  stopDevice: () => ipcRenderer.invoke(RPC.StopDevice),
  flashDevice: (flashItem: FlashItem) => ipcRenderer.invoke(RPC.FlashDevice, flashItem),
  cancelFlashing: (id: number) => ipcRenderer.invoke(RPC.CancelFlashing, id),
  setSudoPassword: (password: string) => ipcRenderer.invoke(RPC.SetSudoPassword, password),
  isSudoPasswordSet: () => ipcRenderer.invoke(RPC.IsSudoPasswordSet) as Promise<boolean>,
  getPlatform: () => ipcRenderer.invoke(RPC.GetPlatform) as Promise<string>,
  hasDocker: () => ipcRenderer.invoke(RPC.HasDocker) as Promise<boolean>,
  downloadUpdate: () => ipcRenderer.invoke(RPC.DownloadUpdate) as Promise<void>,
  installUpdate: () => ipcRenderer.invoke(RPC.InstallUpdate) as Promise<void>
}

export type Api = typeof api

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('ipcRenderer', {
      send: (channel, data) => {
        ipcRenderer.send(channel, data)
      },
      receive: (channel, func) => {
        ipcRenderer.on(channel, (_, ...args) => func(...args))
      }
    })
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore
  window.ipcRenderer = ipcRenderer
}
