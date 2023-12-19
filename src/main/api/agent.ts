import path from 'path'
import { FlashItem, Progress } from '../../types'
import { downloadFile } from '../utils'
import { REFLASHER_CONFIG_PATH } from './boards'
import { childProcess, execAsync } from './permissions'
import fs, { access, mkdir } from 'fs/promises'
import { ChildProcessWithoutNullStreams } from 'child_process'
import { EventEmitter } from 'stream'
import fetch from 'node-fetch'

type AgentState = 'active' | 'inactive' | 'failed'

class AgentManager extends EventEmitter {
  private logs: string[] = []
  private state: AgentState = 'inactive'
  private downloadPromise: Promise<void> | null = null
  private agentProcess: ChildProcessWithoutNullStreams | null = null
  private agentDir = path.join(REFLASHER_CONFIG_PATH, 'agent')
  private availableVersionsURL = 'https://storage.googleapis.com/re-agent/availableVersions.json'

  constructor() {
    super()
    this.init()
  }

  private async getLatestVersion() {
    const res = (await fetch(this.availableVersionsURL).then((res) => res.json())) as {
      production: string
    }

    const { production: latestVersion } = res

    return latestVersion
  }

  async createAgentDirIfNotExists() {
    try {
      await access(this.agentDir)
    } catch {
      console.log(`Creating config folder at ${this.agentDir}`)
      try {
        await mkdir(this.agentDir)
      } catch (error) {
        console.log('Could not create agent folder')
        throw error
      }
    }
  }

  get architecture() {
    return process.arch === 'arm64' ? 'arm64' : 'amd64'
  }

  get os() {
    if (process.platform === 'win32') return 'windows'
    return process.platform
  }

  get binaryName() {
    return `reagent${this.os === 'windows' ? '.exe' : ''}`
  }

  get agentPath() {
    return path.join(this.agentDir, this.binaryName)
  }

  async getAgentVersion() {
    const { stdout } = await execAsync(`${this.binaryName} -version`)
    return stdout.trim()
  }

  async stopAgent() {
    if (!this.agentProcess) return

    const success = this.agentProcess.kill('SIGKILL')
    if (success) {
      this.agentProcess = null
      this.logs = []
      this.emit('logs', this.logs)
    } else {
      throw new Error('failed to stop agent process: ' + this.agentProcess.pid)
    }
  }

  async shouldDownloadAgent() {
    try {
      const { stdout } = await execAsync(`${this.agentPath} -version`)
      const currentVersion = stdout.trim()

      const latestVersion = await this.getLatestVersion()

      return currentVersion !== latestVersion
    } catch (error) {
      return true
    }
  }

  async startAgent(flashItem: FlashItem) {
    if (this.agentProcess) throw new Error('an existing agent process is already running!')

    const logFilePath = path.join(this.agentDir, 'reagent.log')
    const dbFilePath = path.join(this.agentDir, 'reagent.db')
    const appsDir = path.join(this.agentDir, 'apps')

    await fs.rm(dbFilePath, { force: true })
    await fs.rm(logFilePath, { force: true })

    this.logs = []
    this.emit('logs', this.logs)

    const args = [
      `-dbFileName=${dbFilePath}`,
      `-agentDir=${REFLASHER_CONFIG_PATH}`,
      `-appsDir=${appsDir}`,
      '-config',
      `${flashItem.reswarm!.configPath}`,
      `-logFile=${logFilePath}`,
      '-update=false',
      '-prettyLogging'
    ]

    this.state = 'active'
    this.emit('state', this.state)

    this.agentProcess = childProcess(
      this.agentPath,
      args,
      (stdout) => {
        this.logs.push(stdout)

        if (this.logs.length === 200) {
          this.logs.splice(0, 1)
        }

        this.emit('logs', this.logs)
      },
      console.error
    )

    this.agentProcess.on('exit', (code) => {
      this.agentProcess = null

      if (code && code < 0) {
        this.state = 'failed'
      } else {
        this.state = 'inactive'
      }

      this.emit('state', this.state)
    })
  }

  async init() {
    await this.createAgentDirIfNotExists()

    const shouldDownload = await this.shouldDownloadAgent()
    if (shouldDownload) {
      await this.downloadAgent()
    }
  }

  async downloadAgent(progress?: (progress: Partial<Progress>) => void) {
    const latestVersion = await this.getLatestVersion()

    const agentDownloadURL = `https://storage.googleapis.com/re-agent/${this.os}/${this.architecture}/${latestVersion}/${this.binaryName}`

    if (progress) {
      progress({ averageSpeed: 0, eta: 0, percentage: 0, speed: 0, bytesWritten: 0 })
    }

    this.downloadPromise = downloadFile(agentDownloadURL, this.agentPath, progress, { mode: 755 })

    return this.downloadPromise
  }
}

export const agentManager = new AgentManager()
