import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { createBrowserPanelClient } from '../../lib/messaging/panel-client';
import '../../assets/style.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App client={createBrowserPanelClient()} />
  </React.StrictMode>,
);
