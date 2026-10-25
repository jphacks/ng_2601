import { createAuthStore } from "./authState";

// localStorage を直接渡さないのは、使えないブラウザでは参照しただけで例外になり、アプリが起動しなくなるため。
// 呼び出しのたびに参照すれば、authState の try で受け止められる。
export const auth = createAuthStore({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
});
