import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shaderRoot = path.join(root, 'src/rendering/shaders')
const shaderExtensions = new Set(['.frag', '.vert', '.glsl'])
const numericLiteral = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

export function analyzeShaderSource(source, filename = '<shader>') {
  const cleanSource = stripComments(source)
  const calls = []
  const callPattern = /\bsmoothstep\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,/g

  for (const match of cleanSource.matchAll(callPattern)) {
    const edge0 = match[1].trim()
    const edge1 = match[2].trim()
    const line = cleanSource.slice(0, match.index).split('\n').length
    const literal = numericLiteral.test(edge0) && numericLiteral.test(edge1)
    calls.push({
      filename,
      line,
      edge0,
      edge1,
      literal,
      reversed: literal && Number(edge0) > Number(edge1),
    })
  }

  return calls
}

async function shaderFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await shaderFiles(absolutePath))
    else if (shaderExtensions.has(path.extname(entry.name))) files.push(absolutePath)
  }
  return files
}

export async function checkShaderDirectory(directory = shaderRoot) {
  const calls = []
  for (const filename of await shaderFiles(directory)) {
    const source = await readFile(filename, 'utf8')
    calls.push(...analyzeShaderSource(source, path.relative(root, filename)))
  }
  return calls
}

async function main() {
  const calls = await checkShaderDirectory()
  const reversed = calls.filter(call => call.reversed)
  const dynamic = calls.filter(call => !call.literal)

  if (reversed.length > 0) {
    console.error('Reversed literal smoothstep edges found:')
    for (const call of reversed) {
      console.error(`- ${call.filename}:${call.line}: ${call.edge0} > ${call.edge1}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Shader ramp check passed: ${calls.length - dynamic.length} literal calls use ascending edges`)
  if (dynamic.length > 0) {
    console.log(`Shader ramp check note: ${dynamic.length} dynamic call(s) require human ordering review`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
