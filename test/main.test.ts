import {expect, test} from 'bun:test'

const {default: packageBriefer} = await import('#src/main.ts')

test('should run', () => {
  const result = packageBriefer()
  expect(result).toBe('package-briefer') // TODO Test actual functionality
})
