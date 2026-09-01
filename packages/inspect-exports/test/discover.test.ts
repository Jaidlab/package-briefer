/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

/* eslint-enable typescript/no-restricted-imports */

const discoverPath = resolve(import.meta.dir, '../src/discover.js')
const runDiscovery = async (packageJson: Record<string, unknown>, files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), 'inspect-exports-discover-'))
  const packageFolder = join(root, 'node_modules', 'demo')
  await mkdir(packageFolder, {recursive: true})
  try {
    await Bun.write(join(packageFolder, 'package.json'), JSON.stringify({
      name: 'demo',
      ...packageJson,
    }))
    for (const [file, source] of Object.entries(files)) {
      const path = join(packageFolder, file)
      await mkdir(dirname(path), {recursive: true})
      await Bun.write(path, source)
    }
    const child = Bun.spawn([process.execPath, discoverPath], {
      cwd: root,
      env: {
        ...Bun.env,
        PACKAGE_NAME: 'demo',
      },
      stderr: 'pipe',
      stdout: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(exitCode, stderr).toBe(0)
    return JSON.parse(stdout) as Array<string>
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    })
  }
}

test('discovers explicit, conditional and enumerable wildcard export paths', async () => {
  expect(await runDiscovery({
    exports: {
      '.': './index.js',
      './package.json': './package.json',
      './metadata': './package.json',
      './feature': {
        bun: './feature-bun.js',
        default: './feature.js',
      },
      './features/*': './features/*.js',
      './blocked/*': null,
    },
  }, {
    'index.js': '',
    'feature.js': '',
    'feature-bun.js': '',
    'features/a.js': '',
    'features/b.js': '',
  })).toEqual([
    '.',
    './package.json',
    './metadata',
    './feature',
    './features/a',
    './features/b',
  ])
})
test('discovers only the root when exports is absent', async () => {
  expect(await runDiscovery({}, {'index.js': ''})).toEqual(['.'])
})
