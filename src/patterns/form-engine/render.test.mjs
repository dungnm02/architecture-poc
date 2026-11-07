import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('FormEngineDemo renders the fixture form through Vite SSR', async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const mod = await server.ssrLoadModule(
      '/src/patterns/form-engine/FormEngineDemo.jsx',
    )
    const html = renderToStaticMarkup(createElement(mod.default))

    assert.match(html, /Config-driven form engine/)
    assert.match(html, /id="fe-permission-set"/)
    assert.match(html, /Permission set/)
    assert.match(html, /Editor/)
    assert.match(html, /Viewer/)

    assert.match(html, /Country/)
    assert.match(html, /Effective date/)
    assert.match(html, /Start date/)
    assert.match(html, /End date/)
    assert.match(html, /Notes/)
    assert.match(html, /Currency/)
    assert.match(html, /Policy code/)
    assert.match(html, /Participants/)
    assert.match(html, /Ada Lovelace/)
    assert.match(html, /T-100/)
    assert.match(html, /Add participant/)

    // The complex stub is a real registry entry with no binding.
    assert.match(html, /Attachment/)
    assert.match(html, /fail complex validation/)

    // Submit and the mode toggle are part of the final demo surface.
    assert.match(html, />Submit<\/button>/)
    assert.match(html, /aria-pressed="true">Edit<\/button>/)
    assert.match(html, /aria-pressed="false">View<\/button>/)

    assert.match(html, /value="US"/)
    assert.match(html, /value="2026-01-01"/)
    assert.match(html, /value="2026-02-01"/)
    assert.match(html, /value="USD"/)
  } finally {
    await server.close()
  }
})

test('VIEW permissions render read-only values, not inputs', async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const formHostModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/rhf/FormHost.jsx',
    )
    const documentModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/engine/document.js',
    )
    const fixturesModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/fixtures/documents.js',
    )
    const demoModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/fixtures/demo.js',
    )

    const parsed = documentModule.parseDocument(fixturesModule.DOCUMENT)
    assert.equal(parsed.ok, true)

    const viewer = demoModule.PERMISSION_SETS.find(
      (set) => set.id === 'viewer',
    )

    const html = renderToStaticMarkup(
      createElement(formHostModule.default, {
        document: parsed.document,
        entity: fixturesModule.ENTITY,
        permissions: viewer.permissions,
      }),
    )

    assert.doesNotMatch(html, /<input/)
    assert.match(html, /US/)
    assert.match(html, /2026-01-01/)
    assert.match(html, /2026-02-01/)
    assert.match(html, /Start date/)
    assert.match(html, /End date/)
    assert.match(html, /USD/)
    assert.match(html, /Notes/)
    assert.match(html, /Policy code/)
    assert.match(html, /Participants/)
    assert.match(html, /Ada Lovelace/)
    assert.match(html, /T-100/)
    assert.match(html, /Attachment/)
    assert.doesNotMatch(html, /Add participant/)
    assert.doesNotMatch(html, /Remove participant/)
  } finally {
    await server.close()
  }
})

test('a visibility rule hides its field without blocking the rest', async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const formHostModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/rhf/FormHost.jsx',
    )
    const documentModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/engine/document.js',
    )
    const fixturesModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/fixtures/documents.js',
    )
    const demoModule = await server.ssrLoadModule(
      '/src/patterns/form-engine/fixtures/demo.js',
    )

    const parsed = documentModule.parseDocument(fixturesModule.DOCUMENT)
    const editor = demoModule.PERMISSION_SETS.find((set) => set.id === 'editor')
    const entity = structuredClone(fixturesModule.ENTITY)
    entity.properties.policy.country = 'XX'

    const html = renderToStaticMarkup(
      createElement(formHostModule.default, {
        document: parsed.document,
        entity,
        permissions: editor.permissions,
      }),
    )

    assert.match(html, /Country/)
    assert.doesNotMatch(html, /Notes/)
  } finally {
    await server.close()
  }
})
