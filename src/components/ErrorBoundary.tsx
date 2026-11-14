import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);

    const isViteMismatch = 
      error?.message?.includes("reading 'useState'") ||
      error?.message?.includes("Invalid hook call") ||
      error?.message?.includes("reading 'useRef'") ||
      error?.message?.includes("reading 'useEffect'");

    if (isViteMismatch) {
      const reloadKey = 'vite_react_mismatch_reload';
      const lastReload = sessionStorage.getItem(reloadKey);
      const now = Date.now();
      // Auto-reload to re-sync browser module graph with fresh Vite dev server
      if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem(reloadKey, now.toString());
        console.warn('Detected Vite React instance mismatch after dev server restart. Automatically reloading to synchronize module graph...');
        setTimeout(() => {
          window.location.reload();
        }, 150);
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const isViteMismatch = 
        this.state.error?.message?.includes("reading 'useState'") ||
        this.state.error?.message?.includes("Invalid hook call") ||
        this.state.error?.message?.includes("reading 'useRef'") ||
        this.state.error?.message?.includes("reading 'useEffect'");

      return (
        <div className="p-6 my-4 bg-neutral-900/90 border border-rose-500/30 rounded-2xl text-white shadow-xl max-w-2xl mx-auto flex flex-col gap-4">
          <div className="flex items-center gap-3 text-rose-400">
            <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold font-serif text-white">
                {isViteMismatch ? 'Workspace Synchronization Updated' : (this.props.fallbackTitle || 'Something went wrong')}
              </h2>
              <p className="text-xs text-rose-300 font-mono mt-0.5">
                {isViteMismatch 
                  ? 'A live update was deployed. Click Reload Space to refresh components smoothly.' 
                  : (this.state.error?.message || 'An unexpected runtime error occurred.')}
              </p>
            </div>
          </div>

          <div className="p-3 bg-neutral-950/80 rounded-xl border border-white/5 text-[11px] font-mono text-neutral-400 overflow-x-auto max-h-32">
            {this.state.error?.stack || String(this.state.error)}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer border border-white/10"
            >
              <span>Try Again</span>
            </button>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Space</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
