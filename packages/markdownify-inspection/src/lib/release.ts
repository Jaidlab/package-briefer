import type {Temporal} from '@js-temporal/polyfill'
import type {BriefRelease, Inspection} from 'inspect-npm-package'
import type MarkdownMap from 'markdown-map'

import flattenString from 'flatten-string'

import {formatDate} from './date.ts'

export const formatReleaseStats = (release: BriefRelease) => {
  if (release.size !== undefined && release.files !== undefined) {
    return `${release.size} bytes in ${release.files} files`
  }
  if (release.size !== undefined) {
    return `${release.size} bytes`
  }
  if (release.files !== undefined) {
    return `${release.files} files`
  }
}

export const formatDependencies = (release: BriefRelease) => {
  if (!release.dependencies) {
    return
  }
  const noun = release.dependencies.count === 1 ? 'dependency' : 'dependencies'
  return `${release.dependencies.size} bytes from ${release.dependencies.count} ${noun}`
}

export const getVisibleReleaseVersions = (inspection: Inspection) => {
  const versions = new Set<string>([inspection.releases.first.version])
  for (const release of Object.values(inspection.releases.tags)) {
    versions.add(release.version)
    for (const previous of release.previous ?? []) {
      versions.add(previous.version)
    }
  }
  return versions
}

export const pushRelease = (markdown: MarkdownMap, parentSection: Array<string>, release: BriefRelease, now: Temporal.Instant, recentSeconds: number, options: {priority?: number} = {}) => {
  const content = flattenString.lines(formatDate(release.date, now, recentSeconds), formatReleaseStats(release), formatDependencies(release))
  const releaseSection = [...parentSection, release.version]
  markdown.extendSection(releaseSection, content)
  if (options.priority !== undefined) {
    markdown.setSectionPriority(releaseSection, options.priority)
  }
}
