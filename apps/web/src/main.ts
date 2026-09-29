import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './app/router.js';
import { useAppStore } from './app/store.js';
import App from './App.vue';
import './styles.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
const store = useAppStore();
void store.load();
app.mount('#app');
