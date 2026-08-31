import type {CallToolResult, McpServer, ToolCallback} from '@modelcontextprotocol/server'

import z from 'zod'

const inspectPackageFetchTimeoutMs = 300_000
const inputSchema = z.strictObject({
  name: z.string().trim().min(1).describe('The npm package name to inspect.'),
  version: z.string().trim().min(1).optional().describe('The package version to inspect. Omit for the latest version.'),
})
type Input = z.output<typeof inputSchema>

export class InspectPackageTool {
  readonly description = 'Does research on an npm package and summarizes version history, dependencies and sizes, the state of the GitHub repository and every module export'
  readonly id = 'inspect_package'
  readonly title = 'Inspect npm package'

  constructor(private readonly origin: string) {}

  register(server: McpServer) {
    const callback = (async (input: Input): Promise<CallToolResult> => ({
      content: [
        {
          type: 'text',
          text: await this.run(input),
        },
      ],
    })) as ToolCallback<typeof inputSchema>
    server.registerTool(this.id, {
      title: this.title,
      description: this.description,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    }, callback)
  }

  private async run({name, version}: Input) {
    const packageUrl = `${this.origin}/npmjs.com/package/${encodeURIComponent(name)}`
    const url = `${version === undefined ? packageUrl : `${packageUrl}/v/${encodeURIComponent(version)}`}/llms.txt?clank=true`
    const response = await fetch(url, {
      headers: {Accept: 'text/plain'},
      redirect: 'error',
      signal: AbortSignal.timeout(inspectPackageFetchTimeoutMs),
    })
    const body = await response.text()
    if (!response.ok) {
      const errorBody = body.trim().slice(0, 4000)
      throw new Error(`Failed to fetch package info for ${name}${version === undefined ? '' : `@${version}`}: ${response.status} ${response.statusText}${errorBody ? `\n${errorBody}` : ''}`)
    }
    return body
  }
}
