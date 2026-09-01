const port = Number(Bun.env.RESULT_SERVER_PORT ?? 3000)
const packets = []

Bun.serve({
  port,
  async fetch(request) {
    if (request.method === 'POST') {
      let packet
      try {
        packet = await request.json()
      } catch {
        return new Response('Invalid JSON', {status: 400})
      }
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
        return new Response('JSON packet must be an object', {status: 400})
      }
      packets.push(packet)
      return new Response(null, {status: 204})
    }
    if (request.method === 'GET') {
      return new Response(packets.map(packet => JSON.stringify(packet)).join('\n'), {
        headers: {'content-type': 'application/x-ndjson; charset=utf-8'},
      })
    }
    return new Response(null, {
      status: 405,
      headers: {allow: 'GET, POST'},
    })
  },
})
