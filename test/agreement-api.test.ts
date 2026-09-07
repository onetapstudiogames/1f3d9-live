import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { ReplayEvent } from '../src/city/types.ts'
import { createAgreementPairLoader, parseAgreementPair } from '../src/city/agreements.ts'
import { parseChangesPage } from '../src/city/changes.ts'

const raw = (file: string): string => readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')
const agreements = JSON.parse(raw('agreements.json'))
const signatures = parseChangesPage(JSON.parse(raw('changes-agreement-sign.json'))).events
const signing = signatures.find(row => row.change_id === '11273')!

test('public signing notices identify the signer and number, while the agreement supplies only an unambiguous original pair', () => {
  assert.deepEqual(signing.detail, { agreement_id: 14 })
  assert.deepEqual(parseAgreementPair(agreements, signing), { agreementId: 14, parties: ['astrolabe', 'chronicle'] })
  assert.equal(parseAgreementPair(agreements, signatures.find(row => row.change_id === '67214')!), null)
  assert.equal(parseAgreementPair(agreements, signatures.at(-1)!), null)
  for (const file of ['changes-agreement.json', 'changes-agreement-sign.json', 'changes-agreement-accession.json',
    'events-agreement.json', 'agreements.json']) {
    assert.equal(raw(file), readFileSync(new URL(`../public/fixtures/${file}`, import.meta.url), 'utf8'))
  }
})

test('agreement reads refuse missing membership, future creation, conflicting identities, and unknown signers', () => {
  const original = agreements.agreements.find((row: { id: number }) => row.id === 14)
  for (const row of [{ ...original, parties: ['chronicle', 'chronicle'] }, { ...original, parties: ['chronicle', 1] },
    { ...original, parties: ['chronicle', ''] }, { ...original, acceded: undefined },
    { ...original, acceded: ['astrolabe'] }, { ...original, created_at: '2099-01-01' },
    { ...original, created_at: 'bad' }, { ...original, parties: ['chronicle', 'astrolabe', 'later'] }]) {
    assert.equal(parseAgreementPair({ agreements: [row] }, signing), null)
  }
  assert.equal(parseAgreementPair({ agreements: [original, original] }, signing), null)
  assert.equal(parseAgreementPair(agreements, { ...signing, actor: 'someone-else' }), null)
  assert.equal(parseAgreementPair(agreements, { ...signing, kind: 'agreement' }), null)
  assert.equal(parseAgreementPair(agreements, { ...signing, at: 'bad' }), null)
  assert.equal(parseAgreementPair(agreements, { ...signing, detail: { agreement_id: -1 } }), null)
  assert.throws(() => parseAgreementPair({}, signing), /agreement/i)
})

test('pair lookups are anonymous, bounded, and cached for one signing rather than stale across later signers', async t => {
  const previous = globalThis.fetch
  const calls: string[] = []
  globalThis.fetch = async (url, options) => {
    calls.push(String(url))
    assert.equal(options?.method, 'GET')
    assert.equal(options?.credentials, 'omit')
    assert.deepEqual(options?.headers, { accept: 'application/json' })
    assert.ok(options?.signal instanceof AbortSignal)
    return Response.json(agreements)
  }
  t.after(() => { globalThis.fetch = previous })
  const load = createAgreementPairLoader('')
  const pending = load(signing)
  assert.equal(load(signing), pending)
  assert.ok(await pending)
  await load(signatures.find(row => row.change_id === '11288')!)
  await createAgreementPairLoader('?replay=/fixtures/replay-24h.json')(signing)
  await createAgreementPairLoader('?census=/saved.json&agreements=/saved/agreements.json')(signing)
  assert.deepEqual(calls, ['https://1f3d9.com/api/agreements?party=chronicle&limit=200',
    'https://1f3d9.com/api/agreements?party=astrolabe&limit=200', '/fixtures/agreements.json', '/saved/agreements.json'])
  assert.equal(await load({ ...signing, kind: 'agreement_accession' }), null)
  assert.equal(calls.length, 4)
})

test('failed or missing fixture reads are cached and never fall back to the live city', async t => {
  const previous = globalThis.fetch
  t.after(() => { globalThis.fetch = previous })
  for (const response of [new Response('', { status: 404 }),
    new Response('<html>missing</html>', { headers: { 'content-type': 'text/html' } })]) {
    let calls = 0
    globalThis.fetch = async url => { assert.equal(String(url), '/fixtures/agreements.json'); calls += 1; return response }
    const load = createAgreementPairLoader('?replay=/saved.json')
    assert.equal(await load(signing), null)
    assert.equal(await load(signing), null)
    assert.equal(calls, 1)
  }
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return new Response('', { status: 503 }) }
  const load = createAgreementPairLoader('')
  await assert.rejects(load(signing), /503/)
  await assert.rejects(load(signing), /503/)
  assert.equal(calls, 1)
  assert.equal(await load({ ...signing, actor: null } as ReplayEvent), null)
})
