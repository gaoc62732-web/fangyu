import { browserStorage, serverStorage } from '@fangyu/data-access';
import { appMode } from './mode.js';

export function createAppDataAccess() {
  return appMode() === 'server'
    ? serverStorage(import.meta.env.VITE_API_BASE_URL || '/api/v1')
    : browserStorage();
}
