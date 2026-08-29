import {Clerc, friendlyErrorPlugin, helpPlugin, strictFlagsPlugin, versionPlugin} from 'clerc'

import mainCommand from './command/mainCommand.ts'

export default (args?: Array<string>) => {
  const cli = Clerc.create({
    scriptName: Bun.env.npm_package_name ?? 'package-briefer',
    description: Bun.env.npm_package_description ?? 'Serve npm package inspections over HTTP',
    version: Bun.env.npm_package_version ?? '0.0.0',
    name: Bun.env.npm_package_name ?? 'package-briefer',
  })
    .use(helpPlugin())
    .use(versionPlugin())
    .use(strictFlagsPlugin())
    .use(friendlyErrorPlugin())
    .command(mainCommand)
  return async () => {
    await cli.parse(args)
  }
}
