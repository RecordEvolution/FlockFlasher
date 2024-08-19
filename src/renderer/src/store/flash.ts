import { defineStore } from 'pinia'
import { FlashItem, FlashState, Progress, ReswarmConfig, SupportedBoard } from 'src/types'
import { useDrivesStore } from './drives'
import { useBoardStore } from './boards'
import { deepToRaw } from '@renderer/utils'
import path from 'path-browserify'
import { useSnackStore } from './snack'

const imageTypes = ['flock', 'reswarm', 'iso', 'img'] as const
type ImageType = (typeof imageTypes)[number]

type FlashStoreState = {
  items: FlashItem[]
  key: number
  initialized: boolean
}

const computeCanceledState = (state: FlashState): FlashState => {
  switch (state) {
    case 'flashing':
      return 'flashing-canceled'
    case 'verifying':
      return 'verification-canceled'
  }
  return state
}

export const useFlashStore = () => {
  const store = defineStore('flash', {
    state: (): FlashStoreState => ({ items: [], initialized: false, key: 0 }),
    getters: {
      flashItems: (state) => state.items,
      flashItemById: (state) => {
        return (id: number) => state.items.find((item) => item.id === id)
      }
    },
    actions: {
      async addItem(fullPath: string) {
        const driveStore = useDrivesStore()
        const boardStore = useBoardStore()

        const splitPath = fullPath.split('/')
        const fileName = splitPath.at(-1) as string
        const fileDirectory = splitPath.slice(0, -1).join('/')

        const fileType = fileName?.split('.').at(-1) as string
        const defaultDrive = driveStore.drives[0] ?? undefined

        const flashItem: FlashItem = {
          id: this.key++,
          fileDirectory,
          fileType,
          fullPath,
          fileName,
          flash: {
            progress: 0,
            state: 'idle',
            speed: 0,
            avgSpeed: 0,
            eta: 0
          },
          drive: defaultDrive
        }

        if (fileType === 'flock' || fileType === 'reswarm') {
          const configFileString = (await window.api.readFile(fullPath, {
            encoding: 'utf8'
          })) as string

          const config = JSON.parse(configFileString) as ReswarmConfig
          const board = boardStore.boards.find(
            (b) => b.model === config?.board?.model
          ) as SupportedBoard

          // It can happen that the boards are not intialized (e.g. when opening FlockFlasher with .flock file)
          // In that case we just fallback to the actual config
          config.board = board ?? config.board

          flashItem.reswarm = {
            configPath: fullPath,
            config
          }
        }

        this.items.push(flashItem)
      },
      async flashDevice(flashItem: FlashItem) {
        const snackstore = useSnackStore()

        if (!flashItem.drive) {
          snackstore.setText('errors.no_drive_selected')
          snackstore.setColor('error')
          snackstore.setVisible(true)
          return
        }

        await window.sudoDialog.openDialog()

        return window.api.flashDevice(deepToRaw(flashItem))
      },
      cancelFlashing(flashItem: FlashItem) {
        return window.api.cancelFlashing(flashItem.id)
      },
      reset(flashItem: FlashItem) {
        const item = this.items.find((i) => i.id === flashItem.id)
        if (item) {
          item.flash = {
            progress: 0,
            state: 'idle',
            speed: 0,
            avgSpeed: 0,
            eta: 0
          }
        }
      },
      removeItem(flashItem: FlashItem) {
        const flashItemIndex = this.items.findIndex((fi) => fi.id === flashItem.id)
        this.items.splice(flashItemIndex, 1)
      },
      initialize() {
        document.body.addEventListener('dragover', (evt) => {
          evt.preventDefault()
        })

        document.body.addEventListener('drop', (evt) => {
          evt.preventDefault()

          const { path: filePath } = evt?.dataTransfer?.files[0] ?? {}
          if (!filePath) return

          const { ext } = path.parse(filePath)
          if (!imageTypes.includes(`${ext.slice(1) as ImageType}`)) return

          this.addItem(filePath)
        })

        window.ipcRenderer.receive('add-image-item', ({ filePath }: { filePath: string }) => {
          this.addItem(filePath)
        })

        window.ipcRenderer.receive(
          'flash-progress',
          ({ progress, id }: { progress: Progress; id: number }) => {
            const item = this.items.find((i) => i.id === id)
            if (!item) return

            if (progress.canceled) {
              item.flash = {
                progress: 0,
                state: computeCanceledState(progress.type),
                speed: 0,
                avgSpeed: 0,
                eta: 0
              }

              return
            }

            item.flash.state = progress.type
            item.flash.progress = progress.percentage ?? 0
            item.flash.speed = progress.speed ?? 0
            item.flash.eta = progress.eta ?? 0
            item.flash.avgSpeed = progress.averageSpeed ?? 0
          }
        )

        window.ipcRenderer.send('image-item-store-ready')
      }
    }
  })

  const FlashStore = store()
  if (!FlashStore.initialized) {
    FlashStore.initialize()
  }

  return FlashStore
}
