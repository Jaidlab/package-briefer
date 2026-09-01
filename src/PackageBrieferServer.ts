import type {Inspection, Options as InspectNpmPackageOptions, SamplingOptions} from 'inspect-npm-package'
import type {Options as MarkdownifyOptions} from 'markdownify-inspection'

import inspectNpmPackage, {PackageNotFoundError, PackageVersionNotFoundError} from 'inspect-npm-package'
import {LRUCache} from 'lru-cache'
import markdownifyInspection, {renderClankExportModule, renderPackageClank} from 'markdownify-inspection'

import homepage from './homepage.html' with {type: 'text'}

const homepageText = homepage as unknown as string
const routePrefix = '/npmjs.com/package/'

type InspectionOptions = SamplingOptions & Pick<InspectNpmPackageOptions, 'exportsDockerHost' | 'externalCaches'>
type InspectionProgress = Pick<InspectNpmPackageOptions, 'onExportModule' | 'onFocusedPackage' | 'onFocusedVersion'>
type Inspect = (options: InspectionOptions & InspectionProgress & {
  name: string
  version?: string
}) => Promise<Inspection>
type Markdownify = (inspection: Inspection, options?: MarkdownifyOptions) => string

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
const getClank = (url: URL, defaultClank: boolean) => {
  const value = url.searchParams.get('clank')
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return defaultClank
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
    if (url.pathname === '/') {
      if (request.method !== 'GET') {
        return new Response(null, {
          status: 405,
          headers: {allow: 'GET'},
        })
      }
      return new Response(homepageText, {
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'text/html; charset=utf-8',
        },
      })
    }
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
    if (route.llms) {
      return this.getMarkdownResponse(route.packageName, route.version, getClank(url, this.defaultClank))
    }
    try {
      const inspection = await this.getInspection(route.packageName, route.version)
      return Response.json(inspection, {
        headers: {
          'access-control-allow-origin': '*',
        },
      })
    } catch (error) {
      const status = error instanceof PackageNotFoundError || error instanceof PackageVersionNotFoundError ? 404 : 502
      const message = error instanceof Error ? error.message : String(error)
      return errorResponse(message, status, false)
    }
  }

  private readonly cache?: LRUCache<string, Inspection>

  constructor(private readonly inspect: Inspect = inspectNpmPackage,
    private readonly markdownify: Markdownify = markdownifyInspection,
    cacheSeconds = 0,
    private readonly inspectionOptions: InspectionOptions = {},
    cacheItems = 100,
    private readonly defaultClank = false) {
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

  private async getInspection(packageName: string, version?: string, progress: InspectionProgress = {}) {
    const cacheKey = `${packageName}\0${version ?? ''}`
    const cached = this.cache?.get(cacheKey)
    if (cached) {
      progress.onFocusedVersion?.(cached.focused.version)
      progress.onFocusedPackage?.({
        version: cached.focused.version,
        package: cached.focused.package,
      })
      for (const [exportPath, moduleInspection] of Object.entries(cached.exports?.modules ?? {})) {
        progress.onExportModule?.(exportPath, moduleInspection)
      }
      return cached
    }
    const inspection = await this.inspect({
      ...this.inspectionOptions,
      name: packageName,
      ...progress,
      ...version === undefined ? {} : {version},
    })
    this.cache?.set(cacheKey, inspection)
    return inspection
  }

  private getMarkdownResponse(packageName: string, version: string | undefined, clank: boolean) {
    const encoder = new TextEncoder
    let canceled = false
    const body = new ReadableStream<Uint8Array>({
      start: async controller => {
        controller.enqueue(encoder.encode(`# ${packageName}`))
        let focusedVersion: string | undefined
        const pushFocusedVersion = (resolvedVersion: string) => {
          if (canceled || focusedVersion !== undefined) {
            return
          }
          focusedVersion = resolvedVersion
          controller.enqueue(encoder.encode(` ${resolvedVersion}`))
        }
        let streamedPackage = false
        let streamedSubpackageHeading = false
        const streamedExportPaths = new Set<string>
        const pushFragment = (fragment: string) => {
          if (canceled || !fragment) {
            return false
          }
          controller.enqueue(encoder.encode(`\n\n${fragment}`))
          return true
        }
        const progress: InspectionProgress = {onFocusedVersion: pushFocusedVersion}
        if (clank) {
          progress.onFocusedPackage = focused => {
            pushFocusedVersion(focused.version)
            if (!streamedPackage && pushFragment(renderPackageClank(focused.package))) {
              streamedPackage = true
            }
          }
          progress.onExportModule = (exportPath, moduleInspection) => {
            if (streamedExportPaths.has(exportPath) || canceled) {
              return
            }
            const includeSubpackageHeading = exportPath === '.' || !streamedSubpackageHeading
            const fragment = renderClankExportModule(exportPath, moduleInspection, includeSubpackageHeading)
            if (!pushFragment(fragment)) {
              return
            }
            streamedExportPaths.add(exportPath)
            if (exportPath !== '.') {
              streamedSubpackageHeading = true
            }
          }
        }
        try {
          const inspection = await this.getInspection(packageName, version, progress)
          pushFocusedVersion(inspection.focused.version)
          if (canceled) {
            return
          }
          const markdown = this.markdownify(inspection, {
            clank,
            omitExportPaths: streamedExportPaths,
            omitPackage: streamedPackage,
          })
          const bodyStart = markdown.indexOf('\n')
          controller.enqueue(encoder.encode(bodyStart === -1 ? '' : markdown.slice(bodyStart)))
          controller.close()
        } catch (error) {
          if (canceled) {
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          controller.enqueue(encoder.encode(`\n\n## Error\n\n${message}\n`))
          controller.close()
        }
      },
      cancel: () => {
        canceled = true
      },
    })
    return new Response(body, {
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-transform',
        'content-type': 'text/plain; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    })
  }
}

export default PackageBrieferServer
