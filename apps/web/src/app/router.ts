import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { SCOPE_IDS } from '@fangyu/contracts';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/china' },
  { path: '/malay-region', component: () => import('../pages/MalayRegionPage.vue') },
  ...SCOPE_IDS.map((scope) => ({
    path: '/' + scope,
    component: () => import('../pages/CatalogPage.vue'),
    props: { scope },
  })),
  { path: '/records', component: () => import('../pages/RecordsPage.vue') },
  { path: '/maofen', component: () => import('../pages/MaofenPage.vue') },
  { path: '/achievements', component: () => import('../pages/AchievementsPage.vue') },
  { path: '/imports', component: () => import('../pages/ImportsPage.vue') },
  { path: '/settings', component: () => import('../pages/SettingsPage.vue') },
  { path: '/help', component: () => import('../pages/HelpPage.vue') },
];

export const router = createRouter({ history: createWebHashHistory(), routes });
