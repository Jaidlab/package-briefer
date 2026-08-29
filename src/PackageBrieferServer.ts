import type {Inspection, SamplingOptions} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'
import inspectNpmPackage, {PackageNotFoundError, PackageVersionNotFoundError} from 'inspect-npm-package'
import markdownifyInspection from 'markdownify-inspection'

const routePrefix = '/npmjs.com/package/'

type Inspect = (options: SamplingOptions & {
  name: string
  version?: string
}) => Promise<Inspection>
type Markdownify = (inspection: Inspection) => string

type CacheEntry = {
  expiresAt: Temporal.Instant
  value: Promise<Inspection>
}

type Route = {
  llms: boolean
  packageName: string
  version?: string
}

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
  }
}
const parseRoute = (url: URL): Route | undefined => {
  if (!url.pathname.startsWith(routePrefix)) {
    return
  }
  const rawSegments = url.pathname.slice(routePrefix.length).split('/')
  if (!rawSegments.length || rawSegments.some(segment => !segment)) {
    return
  }
  const segments = rawSegments.map(decodeSegment)
  if (segments.includes(undefined)) {
    return
  }
  const decoded = segments as Array<string>
  let packageName: string
  let rest: Array<string>
  if (decoded[0].startsWith('@') && decoded[0].includes('/')) {
    packageName = decoded[0]
    rest = decoded.slice(1)
  } else if (decoded[0].startsWith('@')) {
    if (!decoded[1]) {
      return
    }
    packageName = `${decoded[0]}/${decoded[1]}`
    rest = decoded.slice(2)
  } else {
    packageName = decoded[0]
    rest = decoded.slice(1)
  }
  if (!packageName || packageName.startsWith('@') && packageName.split('/').length !== 2) {
    return
  }
  if (!rest.length) {
    return {
      llms: false,
      packageName,
    }
  }
  if (rest.length === 1 && rest[0] === 'llms.txt') {
    return {
      llms: true,
      packageName,
    }
  }
  if (rest[0] !== 'v' || !rest[1]) {
    return
  }
  if (rest.length === 2) {
    return {
      llms: false,
      packageName,
      version: rest[1],
    }
  }
  if (rest.length === 3 && rest[2] === 'llms.txt') {
    return {
      llms: true,
      packageName,
      version: rest[1],
    }
  }
}
const errorResponse = (message: string, status: number, llms: boolean) => {
  if (llms) {
    return new Response(`# Error\n\n${message}\n`, {
      status,
      headers: {'content-type': 'text/plain; charset=utf-8'},
    })
  }
  return Response.json({error: message}, {status})
}

export class PackageBrieferServer {
  fetch = async (request: Request) => {
    const url = new URL(request.url)
    const route = parseRoute(url)
    if (!route) {
      return errorResponse(`Use ${routePrefix}<package>[/v/<version>][/llms.txt]`, 404, false)
    }
    if (request.method !== 'GET') {
      return new Response(null, {
        status: 405,
        headers: {allow: 'GET'},
      })
    }
    try {
      const inspection = await this.getInspection(route.packageName, route.version)
      if (route.llms) {
        return new Response(this.markdownify(inspection), {
          headers: {
            'access-control-allow-origin': '*',
            'content-type': 'text/plain; charset=utf-8',
          },
        })
      }
      return Response.json(inspection, {
        headers: {
          'access-control-allow-origin': '*',
        },
      })
    } catch (error) {
      const status = error instanceof PackageNotFoundError || error instanceof PackageVersionNotFoundError ? 404 : 502
      const message = error instanceof Error ? error.message : String(error)
      return errorResponse(message, status, route.llms)
    }
  }

  private readonly cache = new Map<string, CacheEntry>

  constructor(private readonly inspect: Inspect = inspectNpmPackage,
    private readonly markdownify: Markdownify = markdownifyInspection,
    private readonly cacheTtlMs = 300_000,
    private readonly samplingOptions: SamplingOptions = {}) {}

  listen(options: {
    hostname?: string
    port?: number
  } = {}) {
    return Bun.serve({
      hostname: options.hostname ?? Bun.env.HOST ?? '127.0.0.1',
      port: options.port ?? Number(Bun.env.PORT ?? 944),
      fetch: this.fetch,
    })
  }

  private async getInspection(packageName: string, version?: string) {
    const now = Temporal.Now.instant()
    const cacheKey = `${packageName}\0${version ?? ''}`
    const cached = this.cache.get(cacheKey)
    if (cached && Temporal.Instant.compare(cached.expiresAt, now) > 0) {
      return cached.value
    }
    const value = this.inspect({
      ...this.samplingOptions,
      name: packageName,
      ...version === undefined ? {} : {version},
    })
    this.cache.set(cacheKey, {
      expiresAt: now.add({milliseconds: this.cacheTtlMs}),
      value,
    })
    try {
      return await value
    } catch (error) {
      this.cache.delete(cacheKey)
      throw error
    }
  }
}

export default PackageBrieferServer
