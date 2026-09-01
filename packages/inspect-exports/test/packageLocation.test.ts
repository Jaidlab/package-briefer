/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {findPackageLocation, getPackageNameParts} from '../src/packageLocation.ts'

/* eslint-enable typescript/no-restricted-imports */

test('locates hoisted packages through module search paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inspect-exports-location-'))
  const baseFolder = join(root, 'packages', 'app')
  const packageFolder = join(root, 'node_modules', 'demo')
  try {
    await mkdir(baseFolder, {recursive: true})
    await mkdir(packageFolder, {recursive: true})
    await Bun.write(join(baseFolder, 'package.json'), JSON.stringify({private: true}))
    await Bun.write(join(packageFolder, 'package.json'), JSON.stringify({
      name: 'demo',
      exports: {'./feature': './feature.js'},
    }))
    expect(await findPackageLocation('demo', baseFolder)).toMatchObject({
      packageFolder,
      packageJson: {name: 'demo'},
      packageJsonPath: join(packageFolder, 'package.json'),
    })
  } finally {
    await rm(root, {
      force: true,
      recursive: true,
    })
  }
})
test('parses scoped package names without allowing path traversal', () => {
  expect(getPackageNameParts('@scope/demo')).toEqual(['@scope', 'demo'])
  expect(getPackageNameParts('legacy_name')).toEqual(['legacy_name'])
  for (const name of ['../demo', 'demo/subpath', '@scope/../demo', '@scope/demo/subpath', String.raw`demo\subpath`]) {
    expect(() => getPackageNameParts(name)).toThrow()
  }
})
