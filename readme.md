# package-briefer

Small Bun HTTP server that summarizes npm package release metadata and GitHub repository stats.

## Usage

```sh
bun start
```

CLI options:

```text
--http-hostname <hostname>                   HTTP hostname (default: 127.0.0.1)
--http-port <port>                           HTTP port (default: 944)
--recent-commits <integer>                   Recent GitHub commits (default: 3)
--recently-created-pull-requests <integer>   Recently created GitHub pull requests (default: 5)
--recently-updated-pull-requests <integer>   Recently updated GitHub pull requests (default: 5)
--recently-created-issues <integer>           Recently created GitHub issues (default: 5)
--recently-updated-issues <integer>           Recently updated GitHub issues (default: 5)
--top-contributors <integer>                 Top GitHub contributors (default: 3)
--recent-contributors <integer>              Recent GitHub contributors (default: 3)
--recent-releases <integer>                  Recent GitHub releases (default: 5)
--recent-versions <integer>                  Recent npm versions per tag (default: 3)
```

The server listens on `127.0.0.1:944` by default.

- JSON: `http://127.0.0.1:944/npmjs.com/package/flatten-string`
- Focused-version JSON: `http://127.0.0.1:944/npmjs.com/package/flatten-string/v/0.2.0`
- llms.txt: `http://127.0.0.1:944/npmjs.com/package/flatten-string/llms.txt`
- Focused-version llms.txt: `http://127.0.0.1:944/npmjs.com/package/flatten-string/v/0.2.0/llms.txt`

Scoped packages are supported as well.

## Packages

- `inspect-npm-package` produces the raw inspection object from npm and GitHub metadata.
- `markdownify-inspection` converts a raw inspection object to Markdown.
- `package-briefer` only handles HTTP routing, caching and serving JSON or Markdown.

## Configuration

- `HOST` – listen hostname, default `127.0.0.1`.
- `PORT` – listen port, default `944`.
- `GITHUB_TOKEN` or `GH_TOKEN` – optional GitHub token for higher API rate limits.

Responses are cached in memory for 5 minutes. Release sizes use npm’s `dist.unpackedSize` when available and fall back to calculating the unpacked tarball size for older releases. If a fallback tarball is missing, unreadable or corrupt, the `size` property is omitted instead of failing the package response. Release dates contain both absolute UTC and relative forms. `focused` contains the selected release and package.json metadata. It defaults to npm’s `latest` tag and can be selected explicitly with `/v/<version>`; tags and `first` remain brief releases. Non-GitHub repository URLs are preserved as `{url}`. GitHub `issues` counts open issues and excludes pull requests.
