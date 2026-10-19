/// <reference types="vite/client" />

import type { DesktopAppApi } from '../shared/contracts';

declare global {
  interface Window {
    desktopApp: DesktopAppApi;
  }
}

export {};
