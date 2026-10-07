// Quick start: downloads the published data packages from npm into packages/<lang>/data, instead of
// building them from Kaikki (English alone is a 3.3 GB download). Contributors get exactly the
// published data, so `npm test` and `npm run evaluate` match the README's numbers. Hand-picked words
// are then rebuilt from the repo's configs, since they can be newer than the published data.
//
//   npm run fetch:data [-- --force]     (--force replaces data that's already there)

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_VERSION, type LanguageMeta } from '../packages/core/src/index.ts'
import type { LanguageConfig } from './language-config.ts'
import { writePicks } from './picks.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')

// Every language data package in the repo (packages/<lang> named which-dialect-<lang>).
const langs = readdirSync(join(ROOT, 'packages')).filter((d) => existsSync(join(ROOT, 'packages', d, 'package.json')) && d !== 'core')

// The newest published version the API reads (DATA_VERSION, e.g. 0.2.x).
async function latest(name: string): Promise<{ version: string; tarball: string }> {
  const res = await fetch(`https://registry.npmjs.org/${name}`)
  if (!res.ok) throw new Error(`${name}: npm registry ${res.status}`)
  const info = (await res.json()) as { versions: Record<string, { dist: { tarball: string } }> }
  const newer = (a: string, b: string) => a.split('.').map(Number).reduce((d, n, i) => d || n - Number(b.split('.')[i]), 0)
  const version = Object.keys(info.versions).filter((v) => v.startsWith(`${DATA_VERSION}.`)).sort(newer).pop()
  if (!version) throw new Error(`${name}: no published version ${DATA_VERSION}.x`)
  return { version, tarball: info.versions[version].dist.tarball }
}

async function main() {
  for (const lang of langs) {
    const name = `which-dialect-${lang}`
    const dataDir = join(ROOT, 'packages', lang, 'data')
    if (existsSync(dataDir) && !force) {
      console.log(`${name}: packages/${lang}/data already exists (pass --force to replace it)`)
      continue
    }
    const { version, tarball } = await latest(name)
    console.log(`${name}@${version}: downloading`)
    const res = await fetch(tarball)
    if (!res.ok) throw new Error(`${name}: download failed: ${res.status}`)
    const tmp = await mkdtemp(join(tmpdir(), 'which-dialect-'))
    const file = join(tmp, 'package.tgz')
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    const tar = spawnSync('tar', ['-xzf', file, '-C', tmp], { stdio: 'inherit' })
    if (tar.status !== 0) throw new Error(`${name}: couldn't unpack (needs the "tar" command)`)
    await rm(dataDir, { recursive: true, force: true })
    await mkdir(dirname(dataDir), { recursive: true })
    await rename(join(tmp, 'package', 'data'), dataDir)
    await rm(tmp, { recursive: true, force: true })
    const meta = JSON.parse(await readFile(join(dataDir, 'meta.json'), 'utf8')) as LanguageMeta
    console.log(`${name}@${version}: ${meta.counts.entries} entries, Wiktionary data of ${meta.source.lastModified ?? meta.source.retrieved}`)
  }
  // Hand-picked words from the repo's configs (the English data is there now to check them against).
  for (const lang of langs) {
    const configFile = join(ROOT, 'languages', `${lang}.ts`)
    if (!existsSync(configFile) || !existsSync(join(ROOT, 'packages', lang, 'data', 'meta.json'))) continue
    const config = (await import(configFile)).default as LanguageConfig
    if (config.picks?.length) await writePicks(config)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
