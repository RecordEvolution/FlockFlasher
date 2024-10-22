import { spawn, exec, SpawnOptionsWithoutStdio, ExecOptions, ChildProcess } from 'child_process'
import fs from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { fileExists } from '../utils'
import { is } from '@electron-toolkit/utils'

export const APPIMAGE_MOUNT_POINT = path.join(tmpdir(), 'ReflasherAppImage')

let sudoPassword = ''
let sudoPasswordSet = false

export const activeProcesses: ChildProcess[] = []

export const setSudoPassword = async (password: string) => {
  sudoPassword = password
  sudoPasswordSet = true

  const isValidSudoPassword = await isSudoPasswordSet()

  if (!isValidSudoPassword) {
    sudoPassword = ''
    sudoPasswordSet = false

    throw new Error('invalidPassword')
  }
}

export const isSudoPasswordSet = async (): Promise<boolean> => {
  if (!sudoPassword) return false
  try {
    await elevatedExecUnix('ls')
    return true
  } catch (error) {
    return false
  }
}

export const getSudoPassword = () => {
  if (!sudoPasswordSet) throw new Error('sudo password not set')
  return sudoPassword
}

export const elevatedNodeChildProcess = (
  code: string,
  onStdout?: (data: string) => void,
  onStderr?: (data: string) => void,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  options?: SpawnOptionsWithoutStdio
) => {
  const platform = process.platform
  if (platform === 'darwin' || platform === 'linux') {
    return elevatedNodeChildProcessUnix(code, onStdout, onStderr, onExit, options)
  }

  // No need to elevate the child process in Windows as the Windows app will run in elevated mode anyways
  return nodeChildProcessWindows(code, onStdout, onStderr, onExit, options)
}

export const execAsync = async (
  command: string,
  options?: {
    encoding?: BufferEncoding
  } & ExecOptions
): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((res, rej) => {
    exec(command, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        rej(error)
        return
      }

      res({ stdout, stderr })
    })
  })
}

export const elevatedExec = async (command: string) => {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return elevatedExecUnix(command)
  }

  // No need to elevate the exec process in Windows as the Windows app will run in elevated mode anyways
  return execAsync(command)
}

export const elevatedExecUnix = async (
  command: string
): Promise<{ stdout: string; stderr: string; code: number | null; signal: string | null }> => {
  return new Promise((res, rej) => {
    const stdoutData: string[] = []
    const stderrData: string[] = []
    let error: Error

    const args = ['-E', '-S', ...command.split(' ')]
    const childProcess = spawn('sudo', args)
    activeProcesses.push(childProcess)

    childProcess.stdin.write(getSudoPassword())
    childProcess.stdin.end()

    childProcess.stdout.on('data', (data) => stdoutData.push(data.toString()))

    childProcess.stderr.on('data', (data) => stderrData.push(data.toString()))

    childProcess.on('error', (err) => {
      error = err
    })

    childProcess.on('exit', (code, signal) => {
      activeProcesses.splice(activeProcesses.indexOf(childProcess), 1)
      if (code != null && code !== 0) {
        return rej({ error, code, signal })
      }

      res({ stdout: stdoutData.join(''), stderr: stderrData.join(''), code, signal })
    })
  })
}

const elevatedNodeChildProcessUnix = async (
  code: string,
  onStdout?: (data: string) => void,
  onStderr?: (data: string) => void,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  options?: SpawnOptionsWithoutStdio
) => {
  const uniqueID = uuidv4()
  const fileName = uniqueID + '.js'
  const scriptPath = path.join(is.dev ? process.resourcesPath : tmpdir(), fileName)
  let command = process.execPath

  if (process.platform === 'linux' && process.env.APPIMAGE) {
    await cleanupAppImageIfExists()

    await mountAppImage()

    const executableName = is.dev ? 'reflasher' : process.execPath.split('/').pop()
    if (!executableName) throw new Error('executable name in execPath is undefined')

    command = path.join(APPIMAGE_MOUNT_POINT, executableName)
  }
  console.log('scriptPath', command, scriptPath)
  await fs.writeFile(scriptPath, code)

  return childProcess(
    command,
    [scriptPath],
    onStdout,
    onStderr,
    (code, signal) => {
      if (onExit) {
        onExit(code, signal)
      }

      fs.unlink(scriptPath)

      if (process.platform === 'linux' && process.env.APPIMAGE) cleanupAppImageIfExists()
    },
    {
      ...options,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      elevated: true
    }
  )
}

export const mountAppImage = async () => {
  if (process.platform !== 'linux') {
    throw new Error('trying to mount app image on a non-linux machine')
  }

  if (!process.env.APPIMAGE) {
    throw new Error('AppImage mount called, but environment variable not set')
  }

  const { stdout } = await execAsync(`${process.env.APPIMAGE} --appimage-offset`, {
    encoding: 'utf8',
    env: { APPIMAGELAUNCHER_DISABLE: '1' }
  })

  const appImageOffset = stdout.trim()

  await fs.mkdir(APPIMAGE_MOUNT_POINT, { recursive: true })

  await elevatedExec(
    `mount -o loop,ro,offset=${appImageOffset} ${process.env.APPIMAGE} ${APPIMAGE_MOUNT_POINT}`
  )

  const executableName = is.dev ? 'reflasher' : process.execPath.split('/').pop()
  if (!executableName) throw new Error('executable name in execPath is undefined')

  const command = path.join(APPIMAGE_MOUNT_POINT, executableName)

  let doesFileExist = false
  while (!doesFileExist) {
    try {
      doesFileExist = await fileExists(command)
    } catch (error) {
      console.error(error)
    }
  }

  return doesFileExist
}

export const cleanupAppImageIfExists = async () => {
  const appImageMountPointExists = await fileExists(APPIMAGE_MOUNT_POINT)
  if (!appImageMountPointExists) return

  try {
    await elevatedExec(`umount ${APPIMAGE_MOUNT_POINT}`)
  } catch (error) {
    console.log('failed to unmount AppImage path:', error)
  }
}

export const childProcess = (
  command: string,
  args: string[],
  onStdout?: (data: string) => void,
  onStderr?: (data: string) => void,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  options?: SpawnOptionsWithoutStdio & { elevated?: boolean }
) => {

  const sudoSupportedOS = (process.platform === 'linux' || process.platform === 'darwin')
  let finalCommand = command
  let finalArgs = args
  if (options?.elevated && sudoSupportedOS) {
    finalCommand = 'sudo'
    finalArgs = ['-E', '-S', command, ...args]
  }

  const { elevated, ...optionsWithoutElevated } = options ?? {}
  const childProcess = spawn(finalCommand, finalArgs, optionsWithoutElevated)
  activeProcesses.push(childProcess)

  if (options?.elevated && sudoSupportedOS) {
    childProcess.stdin.write(getSudoPassword())
    childProcess.stdin.end()
  }

  if (onStdout) {
    childProcess.stdout.on('data', (data) => onStdout(data.toString()))
  }

  if (onStderr) {
    childProcess.stderr.on('data', (data) => onStderr(data.toString()))
  }

  childProcess.on('error', (err) => console.log('error', err))

  childProcess.on('exit', (code, signal) => {
    activeProcesses.splice(activeProcesses.indexOf(childProcess), 1)

    if (onExit) {
      onExit(code, signal)
    }
  })

  return childProcess
}

const nodeChildProcessWindows = async (
  code: string,
  onStdout?: (data: string) => void,
  onStderr?: (data: string) => void,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  options?: SpawnOptionsWithoutStdio
) => {
  const uniqueID = uuidv4()
  const fileName = uniqueID + '.js'
  const scriptPath = path.join(is.dev ? process.resourcesPath : tmpdir(), fileName)

  await fs.writeFile(scriptPath, code)

  const command = process.execPath
  const args = [scriptPath]

  return childProcess(
    command,
    args,
    onStdout,
    onStderr,
    (code, signal) => {
      if (onExit) {
        onExit(code, signal)
      }

      fs.unlink(scriptPath)
    },
    {
      ...options,
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
  )
}
