/* eslint-disable typescript/no-restricted-imports */
import {expect, test} from 'bun:test'
import {resolve} from 'node:path'

/* eslint-enable typescript/no-restricted-imports */

const resultServerPath = resolve(import.meta.dir, '../src/resultServer.js')
const waitForServer = async (url: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
    }
    await Bun.sleep(10)
  }
  throw new Error('Result server did not start')
}

test('stores posted packets and returns them as JSONL', async () => {
  const reservation = Bun.serve({
    port: 0,
    fetch: () => new Response(null),
  })
  const port = reservation.port
  reservation.stop(true)
  const url = `http://127.0.0.1:${port}/`
  const child = Bun.spawn([process.execPath, resultServerPath], {
    env: {
      ...Bun.env,
      RESULT_SERVER_PORT: String(port),
    },
    stderr: 'pipe',
    stdout: 'pipe',
  })
  try {
    await waitForServer(url)
    const packets = [
      {modules: {'.': {default: 'function'}}},
      {failures: {'./broken': {message: 'broken'}}, modules: {}},
    ]
    for (const packet of packets) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(packet),
      })
      expect(response.status).toBe(204)
    }
    const response = await fetch(url)
    expect(response.headers.get('content-type')).toStartWith('application/x-ndjson')
    expect(await response.text()).toBe(packets.map(packet => JSON.stringify(packet)).join('\n'))
  } finally {
    child.kill()
    await child.exited
  }
})
