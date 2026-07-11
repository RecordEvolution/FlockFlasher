// Source for the scripts that run as ROOT via ELECTRON_RUN_AS_NODE. These are
// deliberately CONSTANT strings: every piece of untrusted data (image path,
// drive JSON, device path, module path) is passed to the script as argv and read
// via process.argv, never interpolated into the source. Interpolating anything
// here would re-open the root code-injection holes these constants replaced, so
// they are kept in one Electron-free module and guarded by a unit test.

// argv: [imagePath, stringifiedDrive, finalType, etcherSdkRequirePath]
export const FLASH_SCRIPT = `
    const imagePath = process.argv[2]
    const drive = JSON.parse(process.argv[3])
    const finalType = process.argv[4]
    const { sourceDestination, multiWrite } = require(process.argv[5])
    let progressData;

    process.on('SIGTERM', () => {
      const type = progressData ? progressData.type : 'flashing'
      process.stdout.write(JSON.stringify({ canceled: true, type }))
      process.exit(1)
    });

    async function flash() {
      const _imageFile = new sourceDestination.File({
        path: imagePath
      })

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

      progressData.type = finalType
      const finalPayload = JSON.stringify(progressData)
      process.stdout.write(finalPayload)
    }

    flash()
  `

// argv: [drivePath, mountutilsRequirePath]
export const UNMOUNT_SCRIPT = `
    const mountutils = require(process.argv[3]);

    mountutils.unmountDisk(process.argv[2], (err) => {
      if (err) {
        process.stderr.write(err.message);
        process.exit(1);
      }

      process.exit(0);
    });
  `
