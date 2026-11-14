import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/manrope';
import '@fontsource-variable/dm-sans';
import './styles.css';
import App from './App';
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <h1>numa needs a refresh.</h1>
        <p>The interface could not render this workspace.</p>
        <button onClick={() => location.reload()}>Reload workspace</button>
        <pre>{this.state.error.message}</pre>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Boundary>
  </React.StrictMode>,
);
