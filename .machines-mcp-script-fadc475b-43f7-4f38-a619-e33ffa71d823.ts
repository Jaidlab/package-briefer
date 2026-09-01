const pathParts=[
  'C:/Program Files/Git/cmd',
  'C:/portable/.latest/git/cmd',
  'C:/portable/.latest/git/bin',
  'C:/portable/.latest/bun',
  'C:/Users/jaid/git/node_modules/.bin',
  process.env.PATH ?? ''
]
const env={...process.env, PATH:pathParts.join(';'), Path:pathParts.join(';')}
console.log('git',Bun.which('git',{PATH:env.PATH}) !== null,'bun',Bun.which('bun',{PATH:env.PATH}) !== null)
const p=Bun.spawn(['C:/Users/jaid/git/node_modules/.bin/git-flush-cli.exe','Improved installed package discovery'],{cwd:process.cwd(),env,stdout:'pipe',stderr:'pipe'})
const [code,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()])
console.log(out)
console.error(err)
process.exit(code)