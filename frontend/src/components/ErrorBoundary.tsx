import { Component, type ReactNode } from "react";

/** Shows what went wrong on a page instead of unmounting the whole app. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="notice warn" style={{ maxWidth: 640 }}>
        <b>This page hit an error.</b> {this.state.error.message}
        <div style={{ marginTop: 10 }}>
          <button className="btn small" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
