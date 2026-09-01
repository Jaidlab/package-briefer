/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

/* eslint-enable typescript/no-restricted-imports */

const prepareDependenciesPath = resolve(import.meta.dir, '../src/prepareDependencies.js')
const writePackage = async (root: string, folder: string, packageJson: Record<string, unknown>) => {
  const path = join(root, folder)
  await mkdir(path, {recursive: true})
  await Bun.write(join(path, 'package.json'), JSON.stringify(packageJson))
  await Bun.write(join(path, 'index.js'), 'export default true')
}

test('prepares target, peer and optional dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inspect-exports-dependencies-'))
  try {
    const targetPackage = {
      name: 'demo',
      version: '1.0.0',
      peerDependencies: {'peer-demo': 'file:./peer-demo'},
      optionalDependencies: {'optional-demo': 'file:./optional-demo'},
    }
    await Bun.write(join(root, 'package.json'), JSON.stringify({private: true}))
    await writePackage(root, 'demo-source', targetPackage)
    await writePackage(root, 'peer-demo', {name: 'peer-demo', version: '1.0.0'})
    await writePackage(root, 'optional-demo', {name: 'optional-demo', version: '1.0.0'})
    await writePackage(root, 'node_modules/demo', targetPackage)
    const child = Bun.spawn([process.execPath, prepareDependenciesPath], {
      cwd: root,
      env: {
        ...Bun.env,
        PACKAGE_NAME: 'demo',
        PACKAGE_SPEC: 'file:./demo-source',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    const packageJson = await Bun.file(join(root, 'package.json')).json()
    expect(packageJson).toMatchObject({
      dependencies: {
        demo: 'file:./demo-source',
        'peer-demo': 'file:./peer-demo',
      },
      optionalDependencies: {
        'optional-demo': 'file:./optional-demo',
      },
    })
    expect(await Bun.file(join(root, 'node_modules', 'peer-demo', 'package.json')).exists()).toBe(true)
    expect(await Bun.file(join(root, 'node_modules', 'optional-demo', 'package.json')).exists()).toBe(true)
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    })
  }
})
