import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/map' },
  { path: '/map', component: () => import('../pages/CatalogPage.vue') },
  { path: '/map-legacy', component: () => import('../pages/LegacyMapPage.vue') },
  ...(['china', 'world', 'japan', 'korea'] as const).map((scope) => ({
    path: '/' + scope,
    redirect: (to: { query: Record<string, unknown> }) => ({
      path: '/map',
      query: { ...to.query, scope },
    }),
  })),
  { path: '/records', redirect: (to) => ({ path: '/map', query: { ...to.query, view: 'list' } }) },
  { path: '/achievements', component: () => import('../pages/AchievementsPage.vue') },
  { path: '/manage', component: () => import('../pages/ManagePage.vue') },
  { path: '/imports', redirect: '/manage' },
  {
    path: '/settings',
    component: () => import('../pages/SettingsPage.vue'),
    props: { appearanceOnly: true },
  },
  { path: '/help', component: () => import('../pages/HelpPage.vue') },
];
export const router = createRouter({ history: createWebHashHistory(), routes });
