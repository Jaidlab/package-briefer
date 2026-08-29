import type {FetchImplementation} from './NpmRegistryClient.ts'

export type DependencyStats = {
  count: number
  size: number
}

type InstallSizeResponse = {
  dependencyCount: number
  selfSize: number
  totalSize: number
}

export class NpmxClient {
  private readonly cache = new Map<string, Promise<DependencyStats | undefined>>

  constructor(private readonly fetchImplementation: FetchImplementation = fetch) {}

  getDependencyStats(packageName: string, version: string) {
    const key = `${packageName}@${version}`
    let statsPromise = this.cache.get(key)
    if (!statsPromise) {
      statsPromise = this.fetchDependencyStats(packageName, version)
      this.cache.set(key, statsPromise)
    }
    return statsPromise
  }

  private async fetchDependencyStats(packageName: string, version: string): Promise<DependencyStats | undefined> {
    try {
      const response = await this.fetchImplementation(`https://npmx.dev/api/registry/install-size/${encodeURIComponent(packageName)}/v/${encodeURIComponent(version)}`)
      if (!response.ok) {
        return
      }
      const result = await response.json() as InstallSizeResponse
      if (!Number.isFinite(result.dependencyCount) || !Number.isFinite(result.selfSize) || !Number.isFinite(result.totalSize)) {
        return
      }
      return {
        count: result.dependencyCount,
        size: Math.max(0, result.totalSize - result.selfSize),
      }
    } catch {
    }
  }
}
