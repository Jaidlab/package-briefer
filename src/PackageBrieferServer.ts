import type {Inspection, Options as InspectNpmPackageOptions, SamplingOptions} from 'inspect-npm-package'

import inspectNpmPackage, {PackageNotFoundError, PackageVersionNotFoundError} from 'inspect-npm-package'
import {LRUCache} from 'lru-cache'
import markdownifyInspection from 'markdownify-inspection'

const routePrefix = '/npmjs.com/package/'

type InspectionOptions = SamplingOptions & Pick<InspectNpmPackageOptions, 'exportsDockerHost' | 'externalCaches'>
type Inspect = (options: InspectionOptions & {
  name: string
  version?: string
}) => Promise<Inspection>
type Markdownify = (inspection: Inspection) => string

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

  private readonly cache?: LRUCache<string, Inspection>

  constructor(private readonly inspect: Inspect = inspectNpmPackage,
    private readonly markdownify: Markdownify = markdownifyInspection,
    cacheSeconds = 0,
    private readonly inspectionOptions: InspectionOptions = {},
    cacheItems = 100) {
    if (cacheSeconds > 0 && cacheItems > 0) {
      this.cache = new LRUCache({
        max: cacheItems,
        ttl: cacheSeconds * 1000,
        ttlAutopurge: true,
      })
    }
  }

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
    const cacheKey = `${packageName}\0${version ?? ''}`
    const cached = this.cache?.get(cacheKey)
    if (cached) {
      return cached
    }
    const inspection = await this.inspect({
      ...this.inspectionOptions,
      name: packageName,
      ...version === undefined ? {} : {version},
    })
    this.cache?.set(cacheKey, inspection)
    return inspection
  }
}

export default PackageBrieferServer
