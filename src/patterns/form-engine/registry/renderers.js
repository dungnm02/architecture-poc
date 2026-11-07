import Text, { TextView } from './fields/Text.jsx'
import Date, { DateView } from './fields/Date.jsx'
import InputWithNA, { InputWithNAView } from './fields/InputWithNA.jsx'
import RepeatGroup, { RepeatGroupView } from './fields/RepeatGroup.jsx'
import ComplexStub from './fields/ComplexStub.jsx'

/**
 * Renderer registry. Kept separate from `registry/index.js` so the pure field
 * metadata stays importable by `node --test` without JSX or React.
 *
 * Every component receives `{ def, scope, mode }`; a renderer owns its own
 * `useSlot` (EDIT) or `useSlotValue` (VIEW) subscriptions.
 */
export const renderers = new Map([
  ['Text', { EDIT: Text, VIEW: TextView }],
  ['Date', { EDIT: Date, VIEW: DateView }],
  ['InputWithNA', { EDIT: InputWithNA, VIEW: InputWithNAView }],
  ['RepeatGroup', { EDIT: RepeatGroup, VIEW: RepeatGroupView }],
  // The same component in both modes: the handle stays registered across a
  // mode flip, and VIEW is handled internally.
  ['ComplexStub', { EDIT: ComplexStub, VIEW: ComplexStub }],
])
