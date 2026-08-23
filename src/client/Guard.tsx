/**
 * Render guard for slot entries.
 *
 * A `list`-slot entry that throws during render abdicates its cell until the
 * page reloads, and it takes the surrounding column's render with it on the
 * way out. Balance is an ambient readout: if it cannot render, the correct
 * outcome is that it is not there, not that the sidebar is not there.
 *
 * @module @haoran/dsh-balance/client/Guard
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

/** What the guard wraps. */
export interface GuardProps {
  /** The guarded subtree. */
  children: ReactNode
  /** Reports the first failure once, for the browser console. */
  onError?: (error: unknown) => void
}

interface GuardState {
  failed: boolean
}

/** Renders nothing once its subtree has thrown. */
export class Guard extends Component<GuardProps, GuardState> {
  override state: GuardState = { failed: false }

  /**
   * Move to the failed state on the next render.
   * @returns the failed state.
   */
  static getDerivedStateFromError(): GuardState {
    return { failed: true }
  }

  /**
   * Report the failure once.
   * @param error - the thrown value.
   * @param info - React's component stack.
   */
  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error)
    console.error('@haoran/dsh-balance: render failed', error, info.componentStack)
  }

  /**
   * @returns the subtree, or nothing once it has thrown.
   */
  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
