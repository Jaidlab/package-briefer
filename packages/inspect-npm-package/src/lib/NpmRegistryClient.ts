import type {BriefPackage} from './types.ts'

import {gunzipSync} from 'node:zlib'

export type FetchImplementation = (input: Request | URL | string, init?: RequestInit) => Promise<Response>

export type Repository = {
  url?: string
} | string

export type PackumentVersion = BriefPackage & {
  dist?: {
    fileCount?: number
    tarball?: string
    unpackedSize?: number
  }
  repository?: Repository
}

export type NpmPackument = {
  'dist-tags'?: Record<string, string>
  name: string
  repository?: Repository
  time?: Record<string, string | undefined>
  versions?: Record<string, PackumentVersion | undefined>
}

export type ReleaseStats = {
  files?: number
  size?: number
}

export class PackageNotFoundError extends Error {
  constructor(readonly packageName: string) {
    super(`Package not found: ${packageName}`)
    this.name = 'PackageNotFoundError'
  }
}

export class PackageVersionNotFoundError extends Error {
  constructor(readonly packageName: string, readonly version: string) {
    super(`Package version not found: ${packageName}@${version}`)
    this.name = 'PackageVersionNotFoundError'
  }
}

const textDecoder = new TextDecoder
const parseTarSize = (header: Uint8Array) => {
  const value = textDecoder.decode(header.subarray(124, 136)).replace(/\0.*$/u, '').trim()
  return value ? Number.parseInt(value, 8) : 0
}
const isZeroBlock = (block: Uint8Array) => {
  for (const byte of block) {
    if (byte !== 0) {
      return false
    }
  }
  return true
}

export const getTarStats = async (response: Response): Promise<Required<ReleaseStats>> => {
  if (!response.ok) {
    throw new Error(`Could not download package tarball: HTTP ${response.status}`)
  }
  if (!response.body) {
    throw new Error('Could not download package tarball: Empty response body')
  }
  const compressed = new Uint8Array(await response.arrayBuffer())
  const archive = gunzipSync(compressed)
  let offset = 0
  let size = 0
  let files = 0
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512)
    if (isZeroBlock(header)) {
      break
    }
    const entrySize = parseTarSize(header)
    const type = header[156]
    if (type === 0 || type === 48) {
      size += entrySize
      files++
    }
    offset += 512 + Math.ceil(entrySize / 512) * 512
  }
  return {
    files,
    size,
  }
}

export const getTarUnpackedSize = async (response: Response) => {
  const stats = await getTarStats(response)
  return stats.size
}

export class NpmRegistryClient {
  private readonly tarballStats = new Map<string, Promise<Required<ReleaseStats> | undefined>>

  constructor(private readonly fetchImplementation: FetchImplementation = fetch) {}

  async getPackument(packageName: string) {
    const response = await this.fetchImplementation(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
      headers: {
        accept: 'application/json',
      },
    })
    if (response.status === 404) {
      throw new PackageNotFoundError(packageName)
    }
    if (!response.ok) {
      throw new Error(`Could not fetch npm package ${packageName}: HTTP ${response.status}`)
    }
    return response.json() as Promise<NpmPackument>
  }

  async getReleaseStats(version: PackumentVersion): Promise<ReleaseStats> {
    const declaredFiles = version.dist?.fileCount
    const declaredSize = version.dist?.unpackedSize
    if (declaredFiles !== undefined && declaredSize !== undefined) {
      return {
        files: declaredFiles,
        size: declaredSize,
      }
    }
    const tarball = version.dist?.tarball
    if (!tarball) {
      return {
        ...declaredFiles === undefined ? {} : {files: declaredFiles},
        ...declaredSize === undefined ? {} : {size: declaredSize},
      }
    }
    let statsPromise = this.tarballStats.get(tarball)
    if (!statsPromise) {
      statsPromise = (async () => {
        try {
          return await getTarStats(await this.fetchImplementation(tarball))
        } catch {

        }
      })()
      this.tarballStats.set(tarball, statsPromise)
    }
    const tarballStats = await statsPromise
    const result: ReleaseStats = {}
    const files = declaredFiles ?? tarballStats?.files
    const size = declaredSize ?? tarballStats?.size
    if (files !== undefined) {
      result.files = files
    }
    if (size !== undefined) {
      result.size = size
    }
    return result
  }

  async getUnpackedSize(version: PackumentVersion) {
    const stats = await this.getReleaseStats(version)
    return stats.size
  }
}
