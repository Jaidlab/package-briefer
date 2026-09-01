import {findPackageLocation} from './packageLocation.ts'

export const getPackageDependencySpec = (moduleName, packageSpec) => packageSpec.startsWith(`${moduleName}@`) ? packageSpec.slice(moduleName.length + 1) : packageSpec

const main = async () => {
  const moduleName = Bun.env.PACKAGE_NAME
  const packageSpec = Bun.env.PACKAGE_SPEC
  if (!moduleName) {
    throw new Error('PACKAGE_NAME is required')
  }
  if (!packageSpec) {
    throw new Error('PACKAGE_SPEC is required')
  }

  const {packageJson} = await findPackageLocation(moduleName)
  const packageDependencySpec = getPackageDependencySpec(moduleName, packageSpec)
  const peerDependencies = packageJson.peerDependencies ?? {}
  const optionalDependencies = packageJson.optionalDependencies ?? {}
  await Bun.write('package.json', JSON.stringify({
    private: true,
    dependencies: {
      [moduleName]: packageDependencySpec,
      ...peerDependencies,
    },
    ...(Object.keys(optionalDependencies).length ? {optionalDependencies} : {}),
  }))
  const install = Bun.spawn([process.execPath, 'install'], {
    stderr: 'inherit',
    stdout: 'inherit',
  })
  const exitCode = await install.exited
  if (exitCode !== 0) {
    throw new Error(`Could not prepare dependencies for ${moduleName}`)
  }
}

if (import.meta.main) {
  await main()
}
