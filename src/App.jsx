import RelatedAssetsDemo from './patterns/related-asset-fetching/RelatedAssetsDemo'
import FormEngineDemo from './patterns/form-engine/FormEngineDemo'

// Demo switchboard. Every pattern lives under src/patterns/<name> and is independent.
const demos = [
  { id: 'related-asset-fetching', label: 'Related-asset fetching', Component: RelatedAssetsDemo },
  { id: 'form-engine', label: 'Config-driven form engine', Component: FormEngineDemo },
]

function App() {
  return (
    <>
      <nav
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 12,
          alignItems: 'baseline',
        }}
      >
        <strong style={{ color: 'var(--text-h)' }}>architecture-poc</strong>
        <span>demo switchboard</span>
      </nav>
      {demos.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </>
  )
}

export default App
