import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SOURCE_LATENCY_MS,
  policyCode,
  regionInfo,
} from './sources.js'

test('policyCode is deterministic and uses only its declared params', async () => {
  const first = await policyCode({ country: 'CA' })
  const second = await policyCode({ country: 'CA', extra: 'do-not-use' })

  assert.equal(first, second)
  assert.match(first, /CA/)
  assert.doesNotMatch(first, /do-not-use/)
})

test('regionInfo is deterministic and uses only its declared params', async () => {
  const first = await regionInfo({ country: 'US', region: 'NA' })
  const second = await regionInfo({
    country: 'US',
    region: 'NA',
    secret: 'do-not-use',
  })

  assert.equal(first, second)
  assert.match(first, /US/)
  assert.match(first, /NA/)
  assert.doesNotMatch(first, /do-not-use/)
})

test('both sources reject with an AbortError when the signal aborts', async () => {
  for (const source of [policyCode, regionInfo]) {
    const controller = new AbortController()
    const pending = source(
      { country: 'US', region: 'NA' },
      { signal: controller.signal },
    )
    controller.abort()

    await assert.rejects(pending, (error) => error?.name === 'AbortError')
  }
})

test('the mock latency is small but non-zero', () => {
  assert.ok(Number.isFinite(SOURCE_LATENCY_MS))
  assert.ok(SOURCE_LATENCY_MS > 0)
  assert.ok(SOURCE_LATENCY_MS <= 500)
})

test('sources.js uses no network globals', () => {
  const source = readFileSync(fileURLToPath(new URL('./sources.js', import.meta.url)), 'utf8')

  assert.doesNotMatch(source, /\bfetch\s*\(/)
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/)
  assert.doesNotMatch(source, /\bWebSocket\b/)
  assert.doesNotMatch(source, /\bsendBeacon\b/)
})
