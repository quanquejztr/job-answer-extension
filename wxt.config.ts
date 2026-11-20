import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { EXTENSION_KEY } from './extension/lib/constants/extension-key';

// Permissions: `sidePanel` (side-panel entrypoint and sidePanel.open),
// `contextMenus` (Draft answer item), `activeTab` and `scripting` (on-demand
// content-script injection after the menu click) were approved for Slice 1.1.
// `nativeMessaging` (the worker talks to the Go helper) was approved by the
// owner for Slice 1.3. No host_permissions, no content_scripts, no storage.
export default defineConfig({
  srcDir: 'extension',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'Job Answer Drafter (private prototype)',
    description: 'Drafts one reviewed answer for one selected job-application question.',
    key: EXTENSION_KEY,
    permissions: ['activeTab', 'contextMenus', 'nativeMessaging', 'scripting', 'sidePanel'],
  },
});
