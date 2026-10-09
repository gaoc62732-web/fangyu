import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { SCOPE_IDS, isScope } from '@fangyu/contracts';

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/regions/china' },
  { path: '/regions', redirect: '/regions/china' },
  {
    path: '/regions/:scope(' + SCOPE_IDS.join('|') + ')',
    component: () => import('../pages/CatalogPage.vue'),
    props: (route) => ({
      scope: isScope(String(route.params.scope)) ? route.params.scope : 'china',
    }),
    beforeEnter: (to) =>
      isScope(String(to.params.scope)) || { path: '/regions/china', query: to.query },
  },
  { path: '/regions/:unknown', redirect: (to) => ({ path: '/regions/china', query: to.query }) },
  {
    path: '/malay-region',
    redirect: (to) => ({
      path:
        '/regions/' +
        (['malaysia', 'singapore', 'brunei'].includes(String(to.query.country))
          ? to.query.country
          : 'malaysia'),
      query: { ...to.query, country: undefined },
    }),
  },
  ...SCOPE_IDS.map((scope) => ({
    path: '/' + scope,
    redirect: (to: import('vue-router').RouteLocation) => ({
      path: '/regions/' + scope,
      query: to.query,
      hash: to.hash,
    }),
  })),
  { path: '/records', component: () => import('../pages/RecordsPage.vue') },
  { path: '/points', component: () => import('../pages/PointsPage.vue') },
  { path: '/maofen', component: () => import('../pages/MaofenPage.vue') },
  { path: '/achievements', component: () => import('../pages/AchievementsPage.vue') },
  { path: '/imports', component: () => import('../pages/ImportsPage.vue') },
  { path: '/settings', component: () => import('../pages/SettingsPage.vue') },
  { path: '/help', component: () => import('../pages/HelpPage.vue') },
];

export const router = createRouter({ history: createWebHashHistory(), routes });
