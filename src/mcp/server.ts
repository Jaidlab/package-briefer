import {Database} from 'bun:sqlite'
import {timingSafeEqual} from 'node:crypto'

import {createMcpHandler, McpServer} from '@modelcontextprotocol/server'

import {InspectPackageTool} from './InspectPackageTool.ts'

const accessTokenLifetimeSeconds = 3600
const authorizationCodeLifetimeSeconds = 300
const refreshTokenLifetimeSeconds = 60 * 60 * 24 * 30
const scope = 'packages:read'
const requiredEnv = (name: string) => {
  const value = Bun.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
const publicOrigin = requiredEnv('PUBLIC_ORIGIN').replace(/\/+$/u, '')
const resource = `${publicOrigin}/mcp`
const protectedResourceMetadataUrl = `${publicOrigin}/.well-known/oauth-protected-resource/mcp`
const oauthPassword = requiredEnv('OAUTH_PASSWORD')
const signingSecret = requiredEnv('OAUTH_SIGNING_KEY')
const packageBrieferOrigin = requiredEnv('PACKAGE_BRIEFER_ORIGIN').replace(/\/+$/u, '')
const database = new Database(requiredEnv('OAUTH_DB_PATH'), {
  create: true,
  strict: true,
})
for (const statement of [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS authorization_codes (
    id_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    resource TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    scope TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
]) {
  database.run(statement)
}
const signingKey = await crypto.subtle.importKey('raw', (new TextEncoder).encode(signingSecret), {
  name: 'HMAC',
  hash: 'SHA-256',
}, false, ['sign', 'verify'])
type SignedPayload = {
  [key: string]: unknown
  expiresAt: number
  id: string
  issuedAt: number
  type: 'access_token' | 'refresh_token'
}
type RefreshTokenPayload = SignedPayload & {
  clientId: string
  resource: string
  scope: string
  type: 'refresh_token'
}
const encodeBase64Url = (input: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof input === 'string' ? (new TextEncoder).encode(input) : new Uint8Array(input)
  return Buffer.from(bytes).toString('base64url')
}
const decodeBase64Url = (input: string) => Buffer.from(input, 'base64url')
const randomOpaqueValue = (prefix: string) => `${prefix}_${encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`
const hashOpaqueValue = async (value: string) => encodeBase64Url(await crypto.subtle.digest('SHA-256', (new TextEncoder).encode(value)))
const signPayload = async (payload: SignedPayload) => {
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signature = await crypto.subtle.sign('HMAC', signingKey, (new TextEncoder).encode(encodedPayload))
  return `v1.${encodedPayload}.${encodeBase64Url(signature)}`
}
const verifyPayload = async <Payload extends SignedPayload>(token: string, expectedType: Payload['type']) => {
  if (token.length > 20_000) {
    return
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return
  }
  const [, encodedPayload, encodedSignature] = parts
  const validSignature = await crypto.subtle.verify('HMAC', signingKey, decodeBase64Url(encodedSignature), (new TextEncoder).encode(encodedPayload)).catch(() => false)
  if (!validSignature) {
    return
  }
  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8')) as Payload
    if (payload.type !== expectedType || payload.expiresAt <= Math.floor(Date.now() / 1000)) {
      return
    }
    return payload
  } catch {

  }
}
const passwordMatches = (candidate: string) => {
  const expectedHash = new Bun.CryptoHasher('sha256').update(oauthPassword).digest()
  const candidateHash = new Bun.CryptoHasher('sha256').update(candidate).digest()
  return timingSafeEqual(expectedHash, candidateHash)
}
const jsonResponse = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers as ConstructorParameters<typeof Headers>[0])
  headers.set('Cache-Control', 'no-store')
  headers.set('Content-Type', 'application/json')
  return Response.json(body, {
    ...init,
    headers,
  })
}
const readFormParameters = async (request: Request) => {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/x-www-form-urlencoded') {
    return
  }
  try {
    return new URLSearchParams(await request.text())
  } catch {
  }
}
const oauthError = (error: string, description: string, status = 400) => jsonResponse({
  error,
  error_description: description,
}, {status})
const unauthorizedResponse = (description = 'A valid OAuth access token is required.') => new Response(description, {
  status: 401,
  headers: {
    'Cache-Control': 'no-store',
    'WWW-Authenticate': `Bearer realm="Package Briefer MCP", resource_metadata="${protectedResourceMetadataUrl}", scope="${scope}"`,
  },
})
const verifyAccessToken = async (request: Request) => {
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return false
  }
  const payload = await verifyPayload<SignedPayload & {
    resource: string
    scope: string
    type: 'access_token'
  }>(authorization.slice(7), 'access_token')
  return payload?.resource === resource && payload.scope.split(' ').includes(scope)
}
const isAllowedRedirectUri = (value: string) => {
  try {
    const url = new URL(value)
    return !url.hash && (url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  } catch {
    return false
  }
}
const validateClient = (clientId: string) => {
  const registeredClient = database.query<{
    expires_at: number
    name: string
    redirect_uris: string
  }, [string, number]>('SELECT name, redirect_uris, expires_at FROM oauth_clients WHERE id = ? AND expires_at > ?').get(clientId, Math.floor(Date.now() / 1000))
  if (!registeredClient) {
    return
  }
  try {
    const redirectUris = JSON.parse(registeredClient.redirect_uris) as Array<string>
    if (!Array.isArray(redirectUris) || !redirectUris.every(isAllowedRedirectUri)) {
      return
    }
    return {
      id: clientId,
      name: registeredClient.name,
      redirectUris,
    }
  } catch {
  }
}
const registerClient = async (request: Request) => {
  let metadata: unknown
  try {
    metadata = await request.json()
  } catch {
    return oauthError('invalid_client_metadata', 'The request body must be valid JSON.')
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return oauthError('invalid_client_metadata', 'The request body must be a JSON object.')
  }
  const clientMetadata = metadata as Record<string, unknown>
  const redirectUris = clientMetadata.redirect_uris
  if (!Array.isArray(redirectUris) || !redirectUris.length || redirectUris.length > 10 || !redirectUris.every(uri => typeof uri === 'string' && isAllowedRedirectUri(uri))) {
    return oauthError('invalid_redirect_uri', 'redirect_uris must contain HTTPS or localhost callback URLs.')
  }
  if (clientMetadata.token_endpoint_auth_method && clientMetadata.token_endpoint_auth_method !== 'none') {
    return oauthError('invalid_client_metadata', 'Only public clients using token_endpoint_auth_method=none are supported.')
  }
  const issuedAt = Math.floor(Date.now() / 1000)
  const clientId = randomOpaqueValue('client')
  const name = typeof clientMetadata.client_name === 'string' ? clientMetadata.client_name.slice(0, 200) : 'MCP client'
  const expiresAt = issuedAt + 60 * 60 * 24 * 365
  database.query('INSERT INTO oauth_clients (id, name, redirect_uris, expires_at) VALUES (?, ?, ?, ?)').run(clientId, name, JSON.stringify(redirectUris), expiresAt)
  return jsonResponse({
    client_id: clientId,
    client_id_issued_at: issuedAt,
    client_id_expires_at: expiresAt,
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, {status: 201})
}
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const parseAuthorizationRequest = (parameters: URLSearchParams) => {
  const clientId = parameters.get('client_id') || ''
  const client = validateClient(clientId)
  if (!client) {
    throw new Error('The OAuth client is not registered or has expired.')
  }
  const redirectUri = parameters.get('redirect_uri') || ''
  if (!client.redirectUris.includes(redirectUri)) {
    throw new Error('The redirect URI is not registered for this client.')
  }
  if (parameters.get('response_type') !== 'code') {
    throw new Error('Only response_type=code is supported.')
  }
  if (parameters.get('resource') !== resource) {
    throw new Error(`The resource parameter must be ${resource}.`)
  }
  const codeChallenge = parameters.get('code_challenge') || ''
  if (parameters.get('code_challenge_method') !== 'S256' || !/^[-0-9A-Z_a-z]{43,128}$/u.test(codeChallenge)) {
    throw new Error('PKCE with code_challenge_method=S256 is required.')
  }
  const requestedScopes = (parameters.get('scope') || scope).split(/\s+/u).filter(Boolean)
  if (!requestedScopes.includes(scope) || requestedScopes.some(value => ![scope, 'offline_access'].includes(value))) {
    throw new Error(`Only the ${scope} and offline_access scopes are supported.`)
  }
  const state = parameters.get('state') || ''
  if (state.length > 4096) {
    throw new Error('The state parameter is too long.')
  }
  return {
    client,
    clientId,
    codeChallenge,
    redirectUri,
    requestedResource: resource,
    scope: [...new Set(requestedScopes)].join(' '),
    state,
  }
}
const authorizationPage = (request: Request) => {
  const parameters = new URL(request.url).searchParams
  let parsed: ReturnType<typeof parseAuthorizationRequest>
  try {
    parsed = parseAuthorizationRequest(parameters)
  } catch (error) {
    return new Response(`Invalid authorization request: ${error instanceof Error ? error.message : 'Unknown error.'}`, {status: 400})
  }
  const hiddenInputs = [...parameters.entries()].map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('\n')
  return new Response(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Authorize Package Briefer MCP</title>
<style>
:root { color-scheme: dark; font: 16px/1.5 system-ui, sans-serif; background: #111; color: #eee; }
body { min-height: 100vh; display: grid; place-items: center; margin: 0; }
main { width: min(28rem, calc(100% - 3rem)); padding: 2rem; border: 1px solid #333; border-radius: 1rem; background: #191919; }
h1 { margin-top: 0; }
label { display: grid; gap: .5rem; }
input, button { box-sizing: border-box; width: 100%; padding: .8rem 1rem; border: 1px solid #444; border-radius: .6rem; color: inherit; background: #111; font: inherit; }
button { margin-top: 1rem; border-color: #6d5dfc; background: #6d5dfc; font-weight: 700; cursor: pointer; }
small { color: #aaa; }
</style>
<main>
<h1>Authorize Package Briefer MCP</h1>
<p><strong>${escapeHtml(parsed.client.name)}</strong> requests read-only access to inspect npm packages.</p>
<form method="post" action="${publicOrigin}/authorize">
${hiddenInputs}
<label>Access password
<input type="password" name="password" required autofocus autocomplete="current-password">
</label>
<button type="submit">Authorize</button>
</form>
<p><small>The password stays on this server. The client receives short-lived, resource-bound OAuth tokens.</small></p>
</main>
</html>`, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
const authorize = async (request: Request) => {
  const form = await readFormParameters(request)
  if (!form) {
    return new Response('Invalid form submission.', {status: 400})
  }
  const parameters = new URLSearchParams
  for (const [name, value] of form) {
    if (name !== 'password') {
      parameters.append(name, value)
    }
  }
  let parsed: ReturnType<typeof parseAuthorizationRequest>
  try {
    parsed = parseAuthorizationRequest(parameters)
  } catch (error) {
    return new Response(`Invalid authorization request: ${error instanceof Error ? error.message : 'Unknown error.'}`, {status: 400})
  }
  const password = form.get('password')
  if (!password || !passwordMatches(password)) {
    return new Response('The access password is incorrect.', {status: 401})
  }
  const code = randomOpaqueValue('code')
  const expiresAt = Math.floor(Date.now() / 1000) + authorizationCodeLifetimeSeconds
  database.query(`
    INSERT INTO authorization_codes (id_hash, client_id, redirect_uri, code_challenge, resource, scope, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(await hashOpaqueValue(code), parsed.clientId, parsed.redirectUri, parsed.codeChallenge, parsed.requestedResource, parsed.scope, expiresAt)
  const redirect = new URL(parsed.redirectUri)
  redirect.searchParams.set('code', code)
  if (parsed.state) {
    redirect.searchParams.set('state', parsed.state)
  }
  return Response.redirect(redirect.href, 302)
}
const createAccessToken = async (clientId: string, tokenResource: string, tokenScope: string) => {
  const issuedAt = Math.floor(Date.now() / 1000)
  return signPayload({
    type: 'access_token',
    id: crypto.randomUUID(),
    issuedAt,
    expiresAt: issuedAt + accessTokenLifetimeSeconds,
    clientId,
    resource: tokenResource,
    scope: tokenScope,
  })
}
const createRefreshToken = async (clientId: string, tokenResource: string, tokenScope: string) => {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload: RefreshTokenPayload = {
    type: 'refresh_token',
    id: crypto.randomUUID(),
    issuedAt,
    expiresAt: issuedAt + refreshTokenLifetimeSeconds,
    clientId,
    resource: tokenResource,
    scope: tokenScope,
  }
  database.query('INSERT INTO refresh_tokens (id, client_id, resource, scope, expires_at) VALUES (?, ?, ?, ?, ?)').run(payload.id, clientId, tokenResource, tokenScope, payload.expiresAt)
  return signPayload(payload)
}
const tokenResponse = async (clientId: string, tokenResource: string, tokenScope: string) => jsonResponse({
  access_token: await createAccessToken(clientId, tokenResource, tokenScope),
  refresh_token: await createRefreshToken(clientId, tokenResource, tokenScope),
  token_type: 'Bearer',
  expires_in: accessTokenLifetimeSeconds,
  scope: tokenScope,
})
const exchangeToken = async (request: Request) => {
  const form = await readFormParameters(request)
  if (!form) {
    return oauthError('invalid_request', 'The token request must be form encoded.')
  }
  const grantType = form.get('grant_type')
  const clientId = form.get('client_id')
  const requestedResource = form.get('resource')
  if (!clientId || !validateClient(clientId)) {
    return oauthError('invalid_client', 'The OAuth client is invalid.', 401)
  }
  if (requestedResource !== resource) {
    return oauthError('invalid_target', `The resource parameter must be ${resource}.`)
  }
  if (grantType === 'authorization_code') {
    const code = form.get('code')
    const redirectUri = form.get('redirect_uri')
    const verifier = form.get('code_verifier')
    if (!code || !redirectUri || !verifier || !/^[-.0-9A-Z_a-z~]{43,128}$/u.test(verifier)) {
      return oauthError('invalid_request', 'code, redirect_uri and a valid PKCE code_verifier are required.')
    }
    const codeHash = await hashOpaqueValue(code)
    const verifierDigest = await crypto.subtle.digest('SHA-256', (new TextEncoder).encode(verifier))
    const verifierChallenge = encodeBase64Url(verifierDigest)
    const redeemAuthorizationCode = database.transaction(() => {
      const row = database.query<{
        client_id: string
        code_challenge: string
        expires_at: number
        redirect_uri: string
        resource: string
        scope: string
      }, [string]>('SELECT client_id, redirect_uri, code_challenge, resource, scope, expires_at FROM authorization_codes WHERE id_hash = ?').get(codeHash)
      if (!row || row.expires_at <= Math.floor(Date.now() / 1000) || row.client_id !== clientId || row.redirect_uri !== redirectUri || row.resource !== requestedResource || row.code_challenge !== verifierChallenge) {
        return
      }
      const deleted = database.query('DELETE FROM authorization_codes WHERE id_hash = ?').run(codeHash)
      return deleted.changes === 1 ? row : undefined
    })
    const authorizationCode = redeemAuthorizationCode()
    if (!authorizationCode) {
      return oauthError('invalid_grant', 'The authorization code is invalid or expired.')
    }
    return tokenResponse(clientId, authorizationCode.resource, authorizationCode.scope)
  }
  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token')
    if (!refreshToken) {
      return oauthError('invalid_request', 'refresh_token is required.')
    }
    const payload = await verifyPayload<RefreshTokenPayload>(refreshToken, 'refresh_token')
    if (payload?.clientId !== clientId || payload.resource !== requestedResource) {
      return oauthError('invalid_grant', 'The refresh token is invalid or expired.')
    }
    const revokeRefreshToken = database.transaction(() => {
      const result = database.query('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').run(Math.floor(Date.now() / 1000), payload.id, Math.floor(Date.now() / 1000))
      return result.changes === 1
    })
    if (!revokeRefreshToken()) {
      return oauthError('invalid_grant', 'The refresh token has already been used or revoked.')
    }
    return tokenResponse(clientId, payload.resource, payload.scope)
  }
  return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token grants are supported.')
}
const createServer = () => {
  const server = new McpServer({
    name: 'package-briefer',
    version: '0.1.0',
  })
  new InspectPackageTool(packageBrieferOrigin).register(server)
  return server
}
const mcpHandler = createMcpHandler(createServer)
const port = Number(Bun.env.PORT || 3000)
Bun.serve({
  hostname: Bun.env.HOST || '0.0.0.0',
  port,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/health') {
      return jsonResponse({status: 'ok'})
    }
    if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
      return jsonResponse({
        resource,
        authorization_servers: [publicOrigin],
        scopes_supported: [scope],
        bearer_methods_supported: ['header'],
      })
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return jsonResponse({
        issuer: publicOrigin,
        authorization_endpoint: `${publicOrigin}/authorize`,
        token_endpoint: `${publicOrigin}/token`,
        registration_endpoint: `${publicOrigin}/register`,
        scopes_supported: [scope, 'offline_access'],
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (path === '/register' && request.method === 'POST') {
      return registerClient(request)
    }
    if (path === '/authorize' && request.method === 'GET') {
      return authorizationPage(request)
    }
    if (path === '/authorize' && request.method === 'POST') {
      return authorize(request)
    }
    if (path === '/token' && request.method === 'POST') {
      return exchangeToken(request)
    }
    if (path === '/auth/verify') {
      return await verifyAccessToken(request) ? new Response(null, {status: 204}) : unauthorizedResponse()
    }
    if (path === '/mcp') {
      if (!await verifyAccessToken(request)) {
        return unauthorizedResponse()
      }
      return mcpHandler.fetch(request)
    }
    return new Response('Not found.', {status: 404})
  },
})
setInterval(() => {
  const now = Math.floor(Date.now() / 1000)
  database.query('DELETE FROM authorization_codes WHERE expires_at <= ?').run(now)
  database.query('DELETE FROM oauth_clients WHERE expires_at <= ?').run(now)
  database.query('DELETE FROM refresh_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL AND revoked_at <= ?').run(now, now - 60 * 60 * 24)
}, 60 * 60 * 1000).unref()
console.log(`Package Briefer MCP server listening on port ${port}.`)
