import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './app/router.js';
import App from './App.vue';
import './styles.css';
import './module-ui.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
