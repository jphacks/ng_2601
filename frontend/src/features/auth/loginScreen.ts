import "./login.css";
import { el } from "../../ui/dom";
import { icon } from "../../ui/icon";
import type { AuthStore } from "./authState";

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
  google.addEventListener("click", () => finish("Google ユーザー"));

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
    finish(email.value.trim());
  });

  const note = el("p", { className: "login__note", text: "実サーバーとのログイン接続は準備中です（#42）。" });
  note.hidden = mock;
  google.disabled = !mock;
  email.disabled = !mock;
  send.disabled = !mock;

  const dialog = el("dialog", { className: "login" }, [
    el("div", { className: "login__header" }, [title, close]),
    google,
    el("p", { className: "login__or", text: "または" }),
    form,
    note,
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

  function finish(name: string): void {
    auth.login({ name });
    dialog.close();
    window.clearTimeout(toastTimer);
    toast.textContent = `${name} でログインしました`;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => (toast.hidden = true), 3000);
    const next = then;
    then = undefined;
    next?.();
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
