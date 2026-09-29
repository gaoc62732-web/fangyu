<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ authenticated: [] }>();
const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function login() {
  busy.value = true;
  error.value = '';
  try {
    const base = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    const response = await fetch(base + '/auth/sign-in/email', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value }),
    });
    if (!response.ok) throw Error('登录失败，请检查邮箱和密码。');
    password.value = '';
    emit('authenticated');
  } catch (cause) {
    error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form
    class="login-form"
    @submit.prevent="login"
  >
    <h2>登录方舆</h2>
    <label
      >邮箱<input
        v-model="email"
        type="email"
        autocomplete="username"
        required
    /></label>
    <label
      >密码<input
        v-model="password"
        type="password"
        autocomplete="current-password"
        required
    /></label>
    <button
      type="submit"
      :disabled="busy"
    >
      登录
    </button>
    <p role="alert">{{ error }}</p>
  </form>
</template>
