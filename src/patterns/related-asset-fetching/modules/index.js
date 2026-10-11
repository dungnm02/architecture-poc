import { registerAssetModule } from '../registry'
import remark from './remark'
import commentHistory from './comment-history'
import attachment from './attachment'
import license from './license'

// New asset type = new file + one line here. No core edit.
for (const module of [remark, commentHistory, attachment, license]) registerAssetModule(module)

export { remark, commentHistory, attachment, license }
