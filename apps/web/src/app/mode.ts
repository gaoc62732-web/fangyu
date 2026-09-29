export type AppMode = 'demo' | 'server';

export function appMode(): AppMode {
  return import.meta.env.VITE_APP_MODE === 'server' ? 'server' : 'demo';
}
