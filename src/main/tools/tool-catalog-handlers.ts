import { ipcMain } from 'electron';
import { getSystemToolCatalog } from './tool-registry';

export function registerToolCatalogHandlers() {
  ipcMain.handle('tools:catalog', () => getSystemToolCatalog());
}
