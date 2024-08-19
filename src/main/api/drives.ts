import { Drive, list as listdrives } from 'drivelist'
import { elevatedNodeChildProcess, elevatedExecUnix, execAsync } from './permissions'
import { getNodeModulesResourcePath } from '../utils'

export async function listDrives() {
  const drives = await listdrives()
  return drives.filter(
    (d) =>
      !d.mountpoints.find((m) => m.path.includes('boot')) &&
      d.busType !== 'UNKNOWN' &&
      !d.isSystem &&
      !d.isReadOnly
  )
}

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve()
    }, ms)
  })
}

function parseUnixPartitionOutput(output: string) {
  const splitOutput = output.split('\n')
  const indexOfHeader = splitOutput.findIndex((l) => {
    const potentialHeaderSplit = l.split(/\s/g).filter((e) => e)
    const device = potentialHeaderSplit[0] === 'Device'

    return device
  })

  const partitionInfoStringArr = splitOutput.slice(indexOfHeader + 1).filter((e) => e)

  const partitions: {
    device: string
    boot: boolean
    start: string
    end: string
    sectors: string
    size: string
    id: string
    type: string
  }[] = []
  for (const partLine of partitionInfoStringArr) {
    const splitPartLine = partLine.split(/\s+/).filter((e) => e)

    const boot = splitPartLine[1] === '*'
    const offset = boot ? 1 : 0

    partitions.push({
      device: splitPartLine[0],
      boot,
      start: splitPartLine[offset + 1],
      end: splitPartLine[offset + 2],
      sectors: splitPartLine[offset + 3],
      size: splitPartLine[offset + 4],
      id: splitPartLine[offset + 5],
      type: splitPartLine.slice(offset + 6).join(' ')
    })
  }

  return partitions
}

type DarwinPartition = { typeName: string; name?: string; size: string; identifier: string }
const parseDarwinPartitionOutput = (output: string) => {
  const lines = output.split('\n').slice(3) // remove title, header, and disk partition
  const partitions: DarwinPartition[] = []

  for (const line of lines) {
    const splitLine = line.split(/\s+/)

    if (splitLine.length === 6 || splitLine.length === 7) {
      const [, , typeName, ...rest] = splitLine
      const [size, sizeUnit, identifier] = rest.slice(-3)

      if (identifier !== '-') {
        const partition: DarwinPartition = {
          typeName,
          size: `${size} ${sizeUnit}`,
          identifier
        }

        if (splitLine.length === 7) {
          partition.name = rest[0]
        }

        partitions.push(partition)
      }
    }
  }

  return partitions
}

export const automountDrive = (drive: Drive) => {
  switch (process.platform) {
    case 'darwin': {
      return automountDriveDarwin(drive)
    }
    case 'linux': {
      return automountDriveLinux(drive)
    }
    case 'win32': {
      return
    }
    default:
      throw new Error('invalid process')
  }
}

export const listPartitionsDarwin = async (drive: Drive) => {
  const { stdout } = await execAsync(`diskutil list ${drive.device}`)
  return parseDarwinPartitionOutput(stdout)
}

export const listPartitionsLinux = async (drive: Drive) => {
  const { stdout } = await elevatedExecUnix(`fdisk -l ${drive.device}`)
  return parseUnixPartitionOutput(stdout)
}

export const listPartitions = async (drive: Drive) => {
  switch (process.platform) {
    case 'darwin': {
      return listPartitionsDarwin(drive)
    }
    case 'linux': {
      return listPartitionsLinux(drive)
    }
    case 'win32': {
      return
    }
    default:
      throw new Error('invalid process')
  }
}

export const automountDriveDarwin = async (drive: Drive) => {
  const partitions = await listPartitionsDarwin(drive)
  for (const partition of partitions) {
    try {
      await execAsync(`diskutil mount /dev/${partition.identifier}`)
    } catch (error) {
      console.error('failed to mount:', partition.identifier, error)
    }
  }
}

export const automountDriveLinux = async (drive: Drive) => {
  const partitions = await listPartitionsLinux(drive)
  await execAsync('udevadm settle')

  for (const partition of partitions) {
    try {
      await execAsync(`udisksctl mount -b ${partition.device}`)
    } catch (error) {
      console.error('failed to mount:', partition.device, error)
    }
  }
}

export const waitForMount = async (description: string) => {
  while (true) {
    const drives = await listdrives()
    console.log(drives)
    const drive = drives.filter((d) => d.isRemovable && d.description === description)
    if (drive.length === 1) {
      if (drive[0].mountpoints.length !== 0) {
        return drive[0]
      }
    }
    await wait(1000)
  }
}

export async function unmountDisk(drivePath: string) {
  let actualDrivePath = drivePath
  if (process.platform === 'win32') {
    actualDrivePath = actualDrivePath.replace(/\\/g, '\\\\')
  }

  const mountutilsRequire = getNodeModulesResourcePath('mountutils')
  const scriptContent = `
    const mountutils = require('${mountutilsRequire}');

    mountutils.unmountDisk("${actualDrivePath}", (err) => {
      if (err) {
        process.stderr.write(err.message);
        process.exit(1);
      }

      process.exit(0);
    });
  `

  return elevatedNodeChildProcess(scriptContent)
}
