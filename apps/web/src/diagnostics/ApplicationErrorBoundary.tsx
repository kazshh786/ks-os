import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordRuntimeDiagnostic } from './store';
export class ApplicationErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; reference: string }> {
  state = { failed: false, reference: '' };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    const event = recordRuntimeDiagnostic(_error, 'render');
    this.setState({ reference: event.id });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main role="alert" className="mx-auto my-12 max-w-xl rounded-2xl border border-rose-200 bg-white p-6 text-slate-900">
      <h1 className="text-xl font-bold">This screen could not be displayed</h1>
      <p className="mt-3">A display error interrupted this screen. If you were saving a booking or taking a payment, check its status before repeating the action.</p>
      <p className="mt-3 break-all">Reference: {this.state.reference || 'Preparing diagnostic reference…'}</p>
      <p className="mt-3">Use “Diagnose this screen” to copy the report before reloading.</p>
      <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white">Reload screen</button>
    </main>;
  }
}
