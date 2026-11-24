import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import type { NewsItem, NewsSnapshot } from '../shared/news.ts'
import { classifyArticle } from '../scripts/classify.ts'
import { deduplicate } from '../scripts/dedupe.ts'
import { parseFeed } from '../scripts/normalize.ts'

const exec = promisify(execFile)
const stamp = '2026-11-24T00:00:00.000Z'

test('RSS uses the original article URL, parses dates, and strips HTML from summaries', () => {
  const [article] = parseFeed(
    `<rss version="2.0" xmlns:feedburner="http://rssnamespace.org/feedburner/ext/1.0">
      <channel><title>Fixture</title><item>
        <title>台積電 &amp; NVIDIA</title>
        <link>https://redirect.example/item</link>
        <feedburner:origLink>https://news.example/item?utm_source=rss&amp;id=5#section</feedburner:origLink>
        <pubDate>Mon, 23 Nov 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>製程和 AI 算力。</p><script>discard()</script>]]></description>
      </item></channel>
    </rss>`,
    { id: 'fixture', name: '测试来源', url: 'https://feed.example/rss', summary: true },
    stamp,
  )

  assert.equal(article.url, 'https://news.example/item?id=5')
  assert.equal(article.title, '台積電 & NVIDIA')
  assert.equal(article.source, '测试来源')
  assert.equal(article.summary, '製程和 AI 算力。')
  assert.equal(article.publishedAt, '2026-11-23T12:00:00.000Z')
})

test('keyword classification combines tags and searchable company aliases', () => {
  const rules = { semiconductor: ['NVDA'], market: ['财报'], ai: ['AI'] }
  const aliases = [['NVDA', '輝達'], ['MSFT', '微软']]
  const news = classifyArticle('輝達分享 AI 芯片财报', '微软发布业绩', [], rules, aliases)

  assert.deepEqual(news.categories, ['semiconductor', 'market', 'ai'])
  assert.ok(news.keywords.includes('NVDA'))
  assert.ok(news.keywords.includes('MSFT'))
  assert.deepEqual(classifyArticle('Chair elected', '', [], rules).categories, [])
})

test('deduplication keeps the stable ID and direct link while merging categories', () => {
  const syndicated: NewsItem = {
    id: 'previous-id',
    title: 'NVIDIA 公布新一季财报！',
    url: 'https://news.google.com/rss/articles/fixture',
    source: '综合来源',
    publishedAt: stamp,
    categories: ['market'],
  }
  const original: NewsItem = {
    ...syndicated,
    id: 'original-id',
    title: 'NVIDIA 公布新一季财报',
    url: 'https://news.example/earnings',
    source: '发布方',
    categories: ['semiconductor'],
  }
  const result = deduplicate([syndicated, original], [syndicated])

  assert.equal(result.length, 1)
  assert.equal(result[0].id, 'previous-id')
  assert.equal(result[0].url, original.url)
  assert.deepEqual(result[0].categories, ['semiconductor', 'market'])
})

test('partial failure keeps serving news and total failure retains the last snapshot', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'finance-tech-test-'))
  const configFile = join(folder, 'config.json')
  const stateFile = join(folder, 'state.json')
  const outputFile = join(folder, 'news.json')
  let failed = new Set<string>()
  let counter = 1
  const conditioned = new Set<string>()
  const server = createServer((request, response) => {
    const id = request.url === '/first' ? 'first' : 'second'
    if (failed.has(id)) {
      response.writeHead(403).end()
      return
    }

    const tag = '"' + id + '-' + counter + '"'
    if (request.headers['if-none-match'] === tag) {
      conditioned.add(id)
      response.writeHead(304, { ETag: tag }).end()
      return
    }

    response.writeHead(200, { 'Content-Type': 'application/rss+xml', ETag: tag })
    response.end(`<rss version="2.0"><channel><title>${id}</title><item>
      <title>AI ${id} ${counter}</title><link>https://news.example/${id}/${counter}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item></channel></rss>`)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const readSnapshot = async () => JSON.parse(await readFile(outputFile, 'utf8')) as NewsSnapshot
  const update = () => exec(process.execPath, [
    'scripts/update-news.ts', '--config', configFile, '--state', stateFile, '--output', outputFile,
  ])

  try {
    await writeFile(configFile, JSON.stringify({
      sources: ['first', 'second'].map((id) => ({ id, name: id, url: `http://127.0.0.1:${port}/${id}` })),
      keywords: { semiconductor: [], market: [], ai: ['AI'] },
    }))
    await update()
    assert.equal((await readSnapshot()).items.length, 2)
    await update()
    assert.deepEqual([...conditioned].sort(), ['first', 'second'])
    assert.ok((await readSnapshot()).sources.every((source) => source.status === 'ok'))

    failed = new Set(['first'])
    counter = 2
    await update()
    const partial = await readSnapshot()
    assert.equal(partial.sources.find((source) => source.id === 'first')?.status, 'stale')
    assert.equal(partial.sources.find((source) => source.id === 'second')?.status, 'ok')
    assert.ok(partial.items.some((item) => item.source === 'first'))
    assert.ok(partial.items.some((item) => item.title === 'AI second 2'))

    const lastState = await readFile(stateFile, 'utf8')
    const lastSnapshot = await readFile(outputFile, 'utf8')
    failed = new Set(['first', 'second'])
    await assert.rejects(update())
    assert.equal(await readFile(stateFile, 'utf8'), lastState)
    assert.equal(await readFile(outputFile, 'utf8'), lastSnapshot)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(folder, { recursive: true, force: true })
  }
})
