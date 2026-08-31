import type {Inspection} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'
import flattenString from 'flatten-string'
import MarkdownMap from 'markdown-map'
import stringifyClank from 'stringify-clank'

import {defaultRecentSeconds, formatDate} from './lib/date.ts'
import {pushExports} from './lib/exports.ts'
import {pushGitHubRepository} from './lib/github.ts'
import {formatDependencies, formatReleaseStats, getVisibleReleaseVersions, pushRelease} from './lib/release.ts'

export type Options = {
  clank?: boolean
  now?: Temporal.Instant
  recentSeconds?: number
}

const markdownifyInspection = (inspection: Inspection, options: Options = {}) => {
  const now = options.now ?? Temporal.Now.instant()
  const recentSeconds = options.recentSeconds ?? defaultRecentSeconds
  const focusedRelease = inspection.focused
  const packageName = focusedRelease.package.name ?? 'Package'
  const focusedMetadataIsVisible = getVisibleReleaseVersions(inspection).has(focusedRelease.version)
  const markdown = new MarkdownMap
  const packageSection = `${packageName} ${focusedRelease.version}`
  if (!focusedMetadataIsVisible) {
    markdown.extendSection([packageSection, 'npm'], flattenString.lines(formatDate(focusedRelease.date, now, recentSeconds), formatReleaseStats(focusedRelease), formatDependencies(focusedRelease)))
  }
  if (options.clank) {
    markdown.extendSection(packageSection, stringifyClank({package: focusedRelease.package}))
  } else {
    markdown.extendSection([packageSection, 'package'], JSON.stringify(focusedRelease.package))
  }
  if (inspection.exports) {
    pushExports(markdown, packageSection, inspection.exports, packageName, options.clank === true)
  }
  const releasesSection = `${inspection.releases.total} npm releases`
  const tagsSection = [releasesSection, 'tags']
  markdown.ensureSection(tagsSection)
  for (const [tag, release] of Object.entries(inspection.releases.tags)) {
    const tagSection = [...tagsSection, tag]
    const previousReleases = release.previous ?? []
    pushRelease(markdown, tagSection, release, now, recentSeconds, {priority: previousReleases.length + 1})
    for (const [index, previous] of previousReleases.entries()) {
      pushRelease(markdown, tagSection, previous, now, recentSeconds, {priority: previousReleases.length - index})
    }
  }
  const firstSection = [releasesSection, 'first']
  pushRelease(markdown, firstSection, inspection.releases.first, now, recentSeconds)
  if (inspection.repository) {
    if ('github' in inspection.repository) {
      pushGitHubRepository(markdown, inspection.repository.github, now, recentSeconds, options.clank === true)
    } else {
      markdown.ensureSection(inspection.repository.url)
    }
  }
  return `${markdown.render({omitEmpty: false})}\n`
}

export default markdownifyInspection
