import React, { Component, useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import './style.css';
import './calories.css';
import './glass.css';
import './refinements.css';
import './menu-refinement.css';
import './insights-refinement.css';

class StartupBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message || 'Startup failed' }; }
  render() {
    if (this.state.error) return <div className="boot-screen" role="alert"><div className="boot-mark"><span className="minima-mark" aria-hidden="true"><i/><i/><i/></span></div><h1>Let’s reopen Minima.</h1><p>{this.state.error}</p><a href="/repair.html">Repair app startup</a></div>;
    return this.props.children;
  }
}

function StartupReady({ children }: { children: ReactNode }) {
  useEffect(() => { window.dispatchEvent(new Event('minima:mounted')); }, []);
  return children;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><StartupReady><StartupBoundary>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter><App /></BrowserRouter>
    </QueryClientProvider>
  </StartupBoundary></StartupReady></React.StrictMode>,
);



