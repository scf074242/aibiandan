import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/broadcast-plan/create.vue'),
    },

    {
      path: '/broadcast-plan/create',
      name: 'broadcast-plan-create',
      component: () => import('../views/broadcast-plan/create.vue'),
    },
  ],
})

export default router
