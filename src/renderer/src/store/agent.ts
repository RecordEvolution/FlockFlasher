import { defineStore } from 'pinia'
import { FlashItem, Progress } from 'src/types'
import Convert from 'ansi-to-html'
import { deepToRaw } from '@renderer/utils'

type AgentStoreState = {
  items: string[]
  flashItem: FlashItem | null
  agentState: string
  dockerInitialized: boolean
  _dockerInfoDialog: boolean
  _downloadProgress: Partial<Progress>
  _downloadState: 'idle' | 'downloading' | 'finished'
  initialized: boolean
}
// escapeXML HTML-escapes each log line before converting ANSI codes to spans, so
// markup in reagent/container output (rendered via v-html) can't inject HTML/JS.
const ansi_converter = new Convert({ stream: true, bg: '#fff', fg: '#000', escapeXML: true })

export const useAgentStore = () => {
  const store = defineStore('agent', {
    state: (): AgentStoreState => ({
      items: [],
      initialized: false,
      dockerInitialized: false,
      _dockerInfoDialog: false,
      _downloadState: 'idle',
      _downloadProgress: {},
      agentState: '',
      flashItem: null
    }),
    getters: {
      logs: (state) => state.items,
      hasDocker: (state) => state.dockerInitialized,
      dockerInfoDialog: (state) => state._dockerInfoDialog,
      downloadState: (state) => state._downloadState,
      downloadProgress: (state) => state._downloadProgress,
      activeItem: (state) => state.flashItem,
      active: (state) => state.agentState === 'active',
      state: (state) => state.agentState
    },
    actions: {
      async setDockerInfoDialog(value: boolean) {
        this._dockerInfoDialog = value
      },
      async testDevice(flashItem: FlashItem) {
        const hasDocker = await window.api.hasDocker()
        this.dockerInitialized = hasDocker
        this._dockerInfoDialog = !hasDocker

        if (hasDocker) {
          window.api.testDevice(deepToRaw(flashItem))
        }
      },
      async stopDevice() {
        return window.api.stopDevice()
      },
      async initialize() {
        window.ipcRenderer.receive('agent-logs', ({ logs }) => {
          this.items = []
          logs.forEach((log: string) => {
            this.items.push(ansi_converter.toHtml(log))
            this.items.push('<br/>')
          })
        })

        window.ipcRenderer.receive('agent-state', ({ state, activeItem }) => {
          this.agentState = state
          this.flashItem = activeItem
        })

        window.ipcRenderer.receive('agent-download-progress', ({ state, progress }) => {
          this._downloadState = state
          this._downloadProgress = progress
        })

        this.initialized = true
      }
    }
  })

  const agentStore = store()
  if (!agentStore.initialized) {
    agentStore.initialize()
  }

  return agentStore
}
