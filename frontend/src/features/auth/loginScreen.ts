import "./login.css";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import type { AuthStore, User } from "./authState";
import { finishGoogleLogin, GOOGLE_CALLBACK_PATH, startGoogleLogin } from "./google";

export interface LoginScreen {
  dialog: HTMLDialogElement;
  toast: HTMLElement;
  /** ログインできたら then を呼ぶ。 */
  open(then?: () => void): void;
}

export function createLoginScreen(auth: AuthStore, mock: boolean): LoginScreen {
  let then: (() => void) | undefined;
  let toastTimer: number | undefined;

  const title = el("h2", { className: "login__title", text: "ログイン" });
  title.id = "login-title";
  const close = el("button", { className: "login__close" }, [icon("close")]);
  close.type = "button";
  close.setAttribute("aria-label", "ログインを閉じる");
  close.addEventListener("click", () => dialog.close());

  const google = el("button", { className: "login__google", text: "Google でログイン" });
  google.type = "button";
  const error = el("p", { className: "login__error" });
  error.setAttribute("role", "alert");
  error.hidden = true;
  google.addEventListener("click", () => {
    if (mock) {
      finish({ name: "Google ユーザー" });
      return;
    }
    google.disabled = true;
    error.hidden = true;
    startGoogleLogin().catch(() => {
      google.disabled = false;
      error.textContent = "Google でのログインを始められませんでした。時間をおいてもう一度お試しください。";
      error.hidden = false;
    });
  });

  const email = el("input", { className: "login__input" });
  email.type = "email";
  email.required = true;
  email.autocomplete = "email";
  email.placeholder = "you@example.com";
  const emailLabel = el("label", { className: "login__label" }, [
    el("span", { text: "メールアドレス" }),
    email,
  ]);
  const send = el("button", { className: "login__primary", text: "ログイン用のリンクを送る" });
  send.type = "submit";
  const form = el("form", { className: "login__form" }, [emailLabel, send]);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    finish({ name: email.value.trim() });
  });

  // メールのリンクでのログインは BE にあるが、リンクを受け取る画面がまだないため実API時は出さない。
  const emailLogin = mock ? [el("p", { className: "login__or", text: "または" }), form] : [];

  const dialog = el("dialog", { className: "login" }, [
    el("div", { className: "login__header" }, [title, close]),
    google,
    error,
    ...emailLogin,
  ]);
  dialog.setAttribute("aria-labelledby", title.id);
  const toast = el("div", { className: "login-toast" });
  toast.setAttribute("role", "status");
  toast.hidden = true;
  // Escape はダイアログ自身が閉じる。地図側の Escape 処理（検索カードを閉じるなど）まで届かせない。
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") e.stopPropagation();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  function showToast(text: string): void {
    window.clearTimeout(toastTimer);
    toast.textContent = text;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3000);
  }

  function finish(user: User): void {
    auth.login(user);
    dialog.close();
    showToast("ログインしました");
    const next = then;
    then = undefined;
    next?.();
  }

  if (location.pathname === GOOGLE_CALLBACK_PATH) {
    const search = location.search;
    history.replaceState(null, "", "/");
    finishGoogleLogin(search).then(finish, () => showToast("Google でのログインに失敗しました"));
  }

  return {
    dialog,
    toast,
    open(next) {
      then = next;
      form.reset();
      dialog.showModal();
    },
  };
}
