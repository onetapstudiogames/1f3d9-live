import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const docsIndexPath = path.join(repoRoot, 'docs', 'INDEX.md')
const excludedDirectories = new Set(['.git', 'node_modules'])

async function markdownFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) return []
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(target)
    return entry.isFile() && entry.name.endsWith('.md') ? [target] : []
  }))
  return nested.flat()
}

const relativeRepoPath = (file: string): string => path.relative(repoRoot, file).replaceAll(path.sep, '/')
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function documentStatus(text: string): string | null {
  const match = text.slice(0, 600).match(/^> Status: (current|archived|historical \(\d{4}-\d{2}-\d{2}\))\s*$/mu)
  return match?.[1] ?? null
}

test('the docs index lists every Markdown document with its matching status', async () => {
  const files = (await markdownFiles(repoRoot)).sort()
  const index = await readFile(docsIndexPath, 'utf8')

  for (const file of files) {
    const relative = relativeRepoPath(file)
    const text = await readFile(file, 'utf8')
    const status = documentStatus(text)
    assert.ok(status, `${relative} has a status line near its top`)
    const indexLink = path.relative(path.dirname(docsIndexPath), file).replaceAll(path.sep, '/')
    assert.equal(
      index.match(new RegExp(`\\[${escapeRegExp(relative)}\\]\\(${escapeRegExp(indexLink)}\\) — ${escapeRegExp(status)}`, 'gu'))?.length,
      1,
      `${relative} appears exactly once in docs/INDEX.md with status ${String(status)}`,
    )
  }
})

test('archived and historical docs live under docs/archive', async () => {
  const files = await markdownFiles(repoRoot)
  for (const file of files) {
    const relative = relativeRepoPath(file)
    const status = documentStatus(await readFile(file, 'utf8'))
    if (status === 'archived' || status?.startsWith('historical')) {
      assert.ok(relative.startsWith('docs/archive/'), `${relative} is stored under docs/archive`)
    }
  }
})

test('the project rules and build-lead prompt describe the current live viewer', async () => {
  const rules = await readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8')
  const prompt = await readFile(path.join(repoRoot, 'docs', 'FABLE-PROMPT.md'), 'utf8')
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8')
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const staleClaims = /reads the real replay file|lays the continents out|draws plain rectangles|replay clock|rewind|director mode/iu

  assert.doesNotMatch(rules, staleClaims)
  assert.doesNotMatch(prompt, staleClaims)
  assert.doesNotMatch(rules, /old tab stays up|points the tab here/iu)
  assert.match(rules, /one room/iu)
  assert.match(rules, /wall-clock time/iu)
  assert.match(rules, /\[docs\/INDEX\.md\]\(docs\/INDEX\.md\)/u)
  assert.match(readme, /\[docs\/INDEX\.md\]\(docs\/INDEX\.md\)/u)
  assert.match(prompt, /Follow `CLAUDE\.md`/u)
  assert.equal(prompt.match(/CLAUDE\.md/gu)?.length, 1, 'the prompt points to the rules file once instead of copying it')
  assert.match(packageJson.scripts?.build ?? '', /npm run check:docs/u)
})
