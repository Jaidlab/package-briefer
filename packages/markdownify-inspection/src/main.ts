import type {Inspection} from 'inspect-npm-package'

import {Temporal} from '@js-temporal/polyfill'
import flattenString from 'flatten-string'
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
  const paragraphs = [`# ${packageName} ${focusedRelease.version}`]
  if (!focusedMetadataIsVisible) {
    paragraphs.push('## npm')
    paragraphs.push(flattenString.lines(formatDate(focusedRelease.date, now, recentSeconds), formatReleaseStats(focusedRelease), formatDependencies(focusedRelease)))
  }
  if (options.clank) {
    paragraphs.push(stringifyClank({package: focusedRelease.package}))
  } else {
    paragraphs.push('## package', JSON.stringify(focusedRelease.package))
  }
  if (inspection.exports) {
    pushExports(paragraphs, inspection.exports, packageName, options.clank === true)
  }
  paragraphs.push(`# ${inspection.releases.total} npm releases`, '## tags')
  for (const [tag, release] of Object.entries(inspection.releases.tags)) {
    paragraphs.push(`### ${tag}`)
    pushRelease(paragraphs, release, now, recentSeconds)
    for (const previous of release.previous ?? []) {
      pushRelease(paragraphs, previous, now, recentSeconds)
    }
  }
  paragraphs.push('## first')
  pushRelease(paragraphs, inspection.releases.first, now, recentSeconds)
  if (inspection.repository) {
    if ('github' in inspection.repository) {
      pushGitHubRepository(paragraphs, inspection.repository.github, now, recentSeconds, options.clank === true)
    } else {
      paragraphs.push(`# ${inspection.repository.url}`)
    }
  }
  return `${flattenString.paragraphs(paragraphs)}\n`
}

export default markdownifyInspection
