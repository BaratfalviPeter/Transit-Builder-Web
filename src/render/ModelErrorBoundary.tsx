/**
 * ModelErrorBoundary — catches errors thrown while loading/rendering a 3D model
 * (e.g. a bad glb) and renders a fallback instead, so a single broken model can
 * never blank the whole R3F canvas (which has no default error boundary).
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: ReactNode;
}
interface State {
  failed: boolean;
}

export class ModelErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Surface the reason in the console but keep the scene alive.
    // eslint-disable-next-line no-console
    console.error('[ModelErrorBoundary] model failed to render:', error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
