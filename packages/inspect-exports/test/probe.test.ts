/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

/* eslint-enable typescript/no-restricted-imports */

const probePath = resolve(import.meta.dir, '../src/probe.js')
const runProbe = async (packageJson: Record<string, unknown>, files: Record<string, string>, rootFiles: Record<string, string> = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'inspect-exports-probe-'))
  const packageFolder = join(root, 'node_modules', 'demo')
  await mkdir(packageFolder, {recursive: true})
  try {
    await Bun.write(join(root, 'package.json'), JSON.stringify({type: 'module'}))
    for (const [file, source] of Object.entries(rootFiles)) {
      const path = join(root, file)
      await mkdir(path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))), {recursive: true})
      await Bun.write(path, source)
    }
    await Bun.write(join(packageFolder, 'package.json'), JSON.stringify({
      type: 'module',
      name: 'demo',
      ...packageJson,
    }))
    for (const [file, source] of Object.entries(files)) {
      const path = join(packageFolder, file)
      await mkdir(path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))), {recursive: true})
      await Bun.write(path, source)
    }
    const child = Bun.spawn([process.execPath, probePath], {
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
    return JSON.parse(stdout) as Record<string, unknown>
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    })
  }
}
test('inspects explicit, conditional and wildcard export paths', async () => {
  const result = await runProbe({
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
    'index.js': 'export default function demo() {}\nexport const foo = () => {}',
    'feature.js': "export const mode = 'default'",
    'feature-bun.js': "export const mode = 'bun'",
    'features/a.js': 'export const a = 1',
    'features/b.js': 'export class B {}',
    'blocked/private.js': 'export const secret = true',
  })
  expect(result).toEqual({
    '.': {
      default: 'class',
      named: {
        foo: 'function',
      },
    },
    './feature': {
      named: {
        mode: {
          type: 'string',
          value: 'bun',
        },
      },
    },
    './features/a': {
      named: {
        a: 'number',
      },
    },
    './features/b': {
      named: {
        B: 'class',
      },
    },
  })
})
test('inspects only the package root when exports is absent', async () => {
  expect(await runProbe({}, {
    'index.js': 'export const root = true',
  })).toEqual({
    '.': {
      named: {
        root: 'boolean',
      },
    },
  })
})
test('installs declared peer dependencies before inspecting exports', async () => {
  expect(await runProbe({
    exports: './index.js',
    peerDependencies: {
      'peer-demo': 'file:./peer-demo',
    },
    peerDependenciesMeta: {
      'peer-demo': {optional: true},
    },
  }, {
    'index.js': "export {version} from 'peer-demo'",
  }, {
    'peer-demo/package.json': JSON.stringify({
      exports: './index.js',
      name: 'peer-demo',
      type: 'module',
      version: '2.0.0',
    }),
    'peer-demo/index.js': "export const version = '2.0.0'",
    'node_modules/peer-demo/package.json': JSON.stringify({
      exports: './index.js',
      name: 'peer-demo',
      type: 'module',
      version: '1.0.0',
    }),
    'node_modules/peer-demo/index.js': "export const version = '1.0.0'",
  })).toEqual({
    '.': {
      named: {
        version: {
          type: 'string',
          value: '2.0.0',
        },
      },
    },
  })
})
