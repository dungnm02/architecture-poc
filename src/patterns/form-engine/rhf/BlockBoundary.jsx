import { Component } from 'react'

/**
 * Renderer errors must not take down the whole form. The boundary sits outside
 * FieldHost so a throwing hook or registry component is contained; the form
 * itself gets one outer boundary in FormHost.
 */
export default class BlockBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === 'function') {
      this.props.onError(error, info)
    }
  }

  render() {
    if (this.state.failed) {
      const label =
        typeof this.props.label === 'string' && this.props.label.trim() !== ''
          ? this.props.label.trim()
          : 'form'
      return (
        <div className="fe-boundary-error" role="alert">
          Could not render {label}.
        </div>
      )
    }

    return this.props.children
  }
}
