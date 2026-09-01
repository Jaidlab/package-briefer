/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

/* eslint-enable typescript/no-restricted-imports */

const probePath = resolve(import.meta.dir, '../src/probe.js')
type ProbePacket = {
  exportPath: string
  failures?: Record<string, {message: string; name?: string}>
  modules: Record<string, unknown>
}
const runProbe = async (packageJson: Record<string, unknown>, files: Record<string, string>, exportPath = '.') => {
  const root = await mkdtemp(join(tmpdir(), 'inspect-exports-probe-'))
  const packageFolder = join(root, 'node_modules', 'demo')
  await mkdir(packageFolder, {recursive: true})
  try {
    await Bun.write(join(root, 'package.json'), JSON.stringify({type: 'module'}))
    await Bun.write(join(packageFolder, 'package.json'), JSON.stringify({
      type: 'module',
      name: 'demo',
      ...packageJson,
    }))
    for (const [file, source] of Object.entries(files)) {
      const path = join(packageFolder, file)
      await mkdir(dirname(path), {recursive: true})
      await Bun.write(path, source)
    }
    let result: ProbePacket | undefined
    const resultServer = Bun.serve({
      port: 0,
      async fetch(request) {
        result = await request.json() as ProbePacket
        return new Response(null, {status: 204})
      },
    })
    try {
      const child = Bun.spawn([process.execPath, probePath], {
        cwd: root,
        env: {
          ...Bun.env,
          EXPORT_PATH: exportPath,
          PACKAGE_NAME: 'demo',
          RESULT_ENDPOINT: resultServer.url.href,
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
      expect(result).toBeDefined()
      return {
        packet: result as ProbePacket,
        stdout,
      }
    } finally {
      resultServer.stop(true)
    }
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    })
  }
}

test('inspects one export path without using package stdout as the protocol', async () => {
  const {packet, stdout} = await runProbe({exports: './index.js'}, {
    'index.js': `console.log('package output')
export default function demo() {}
export const foo = () => {}
export function Legacy() {}
export class Modern {
  static hidden() {}
  static [Symbol.for('classSymbol')]() {}
}
const objectApi = {}
Object.defineProperty(objectApi, 'hidden', {value: true})
objectApi[Symbol.for('objectSymbol')] = true
export {objectApi}
export const nothing = null`,
  })
  expect(stdout).toContain('package output')
  expect(packet).toEqual({
    exportPath: '.',
    modules: {
      '.': {
        default: 'function',
        named: {
          foo: 'function',
          Legacy: 'function',
          Modern: {
            type: 'class',
            keys: ['hidden', {symbol: 'classSymbol'}],
          },
          objectApi: {
            type: 'object',
            keys: ['hidden', {symbol: 'objectSymbol'}],
          },
          nothing: 'null',
        },
      },
    },
  })
})
test('preserves ESM defaults and CommonJS functions', async () => {
  expect((await runProbe({exports: './default-object.js'}, {
    'default-object.js': 'export default {foo: 1}',
  })).packet).toEqual({
    exportPath: '.',
    modules: {
      '.': {
        default: {
          type: 'object',
          keys: ['foo'],
        },
      },
    },
  })
  expect((await runProbe({exports: './alias.js'}, {
    'alias.js': `const foo = {}
export {foo}
export default {foo}`,
  })).packet).toEqual({
    exportPath: '.',
    modules: {
      '.': {
        default: {
          type: 'object',
          keys: ['foo'],
        },
        named: {
          foo: {
            type: 'object',
            keys: [],
          },
        },
      },
    },
  })
  expect((await runProbe({exports: './commonjs.cjs'}, {
    'commonjs.cjs': `module.exports = function demo() {}
module.exports.bar = () => {}`,
  })).packet).toMatchObject({
    exportPath: '.',
    modules: {
      '.': {
        default: {
          type: 'function',
          keys: ['bar'],
        },
        named: {bar: 'function'},
      },
    },
  })
})
test('reports module evaluation failures for its export path', async () => {
  const {packet} = await runProbe({exports: './broken.js'}, {
    'broken.js': "throw new TypeError('broken export')",
  })
  expect(packet).toEqual({
    exportPath: '.',
    modules: {},
    failures: {
      '.': {
        name: 'TypeError',
        message: 'broken export',
      },
    },
  })
})
