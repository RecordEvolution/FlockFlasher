require('dotenv').config()
const { notarize } = require('electron-notarize')

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const appName = context.packager.appInfo.productFilename

  console.log('Notarizing FlockFlasher app....')
  return await notarize({
    tool: 'notarytool',
    teamId: '9D2S7J8B4D',
    appBundleId: 'com.recordevolution.flockflasher',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLEID,
    appleIdPassword: process.env.APPLEIDPASS
  })
}
