import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'

const projectRoot = process.cwd()
const sourceCandidates = [
  join(
    projectRoot,
    'node_modules',
    '@xenova',
    'transformers',
    'node_modules',
    'onnxruntime-web',
    'dist',
  ),
  join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist'),
]
const targetDir = join(projectRoot, 'public', 'wasm')

const sourceDir = sourceCandidates.find((directory) => existsSync(directory))
if (!sourceDir) {
  console.error(
    'onnxruntime-web is missing. Run `npm install` before preparing WASM assets.',
  )
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })

for (const file of readdirSync(targetDir)) {
  if (/^ort-wasm.*\.(wasm|js|mjs)$/.test(file)) {
    rmSync(join(targetDir, file))
  }
}

const copied = []
for (const file of readdirSync(sourceDir)) {
  if (!/^ort-wasm.*\.(wasm|js|mjs)$/.test(file)) {
    continue
  }

  cpSync(join(sourceDir, file), join(targetDir, file))
  copied.push(file)
}

if (copied.length === 0) {
  console.error('No ONNX Runtime WASM files were copied.')
  process.exit(1)
}

let sourceVersion = 'unknown'
try {
  const packageJsonPath = join(sourceDir, '..', 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  sourceVersion =
    typeof packageJson.version === 'string' ? packageJson.version : sourceVersion
} catch {
  // Ignore version parsing errors.
}

console.log(
  `Copied ${copied.length} ONNX Runtime files from ${sourceDir} (v${sourceVersion}) to public/wasm`,
)
