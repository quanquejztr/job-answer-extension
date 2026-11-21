import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { createBrowserDiagnosticsClient } from '../../lib/diagnostics/diagnostics-client';
import { createBrowserProfileClient } from '../../lib/profile/profile-client';
import '../../assets/style.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App client={createBrowserProfileClient()} diagnostics={createBrowserDiagnosticsClient()} />
  </React.StrictMode>,
);
