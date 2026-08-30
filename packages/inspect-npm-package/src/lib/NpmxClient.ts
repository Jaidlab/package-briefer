import type {ExternalCacheStorage} from './ExternalCacheStorage.ts'
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
  constructor(private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly cache?: ExternalCacheStorage) {}

  getDependencyStats(packageName: string, version: string) {
    const key = `${packageName}@${version}`
    const fetchStats = () => this.fetchDependencyStats(packageName, version)
    return this.cache?.getOrSet(key, fetchStats) ?? fetchStats()
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
