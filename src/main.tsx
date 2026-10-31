import { APP_VERSION } from "./version";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  LayoutDashboard,
  Library,
  ClipboardCheck,
  ChartNoAxesCombined,
  Settings2,
  ArrowUpRight,
  WifiOff,
  X,
  Leaf,
  ChevronRight,
} from "lucide-react";
import { ready, useData } from "./store";
import { Data } from "./types";
import { Dashboard, Statistics, Settings } from "./overview";
import { Libraries, EntryDetail } from "./vocabulary";
import { Study } from "./study";
import { ReviewPlan } from "./reviews-ui";
import { Exams } from "./exams-ui";
import "./style.css";
import { initialize as initializeSpeech } from "./speech";
import { stopPronunciation } from "./pronunciation";
import { usePageMotion } from "./use-page-motion";
export type Actions = {
  go: (page: string) => void;
  openEntry: (id: string) => void;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
};
const navigation = [
  ["today", "今日学习", LayoutDashboard],
  ["decks", "我的词库", Library],
  ["exam", "个人考试", ClipboardCheck],
  ["stats", "学习统计", ChartNoAxesCombined],
  ["settings", "偏好设置", Settings2],
] as const;
class Boundary extends React.Component<
  React.PropsWithChildren,
  { error?: string }
> {
  state: { error?: string } = {};
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <main className="fatal">
        <h1>页面遇到问题</h1>
        <p>{this.state.error}</p>
        <button onClick={() => location.reload()}>重新打开</button>
        <p>已写入的数据仍保留在设备本地。</p>
      </main>
    ) : (
      this.props.children
    );
  }
}
function App() {
  const d = useData(),
    [page, setPage] = useState(location.hash.slice(1) || "today"),
    [entry, setEntry] = useState<string>(),
    [loaded, setLoaded] = useState(false),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false);
  const pageMotion = usePageMotion(page, loaded);
  useEffect(() => {
    ready
      .then(() => setLoaded(true))
      .catch((e) => setToast("无法打开本地数据库：" + e.message));
    const hash = () => setPage(location.hash.slice(1) || "today");
    window.addEventListener("hashchange", hash);
    return () => window.removeEventListener("hashchange", hash);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (!loaded || d.settings.audioEnabled === false) return;
    const timer = setTimeout(() => {
      if (!document.hidden) void initializeSpeech(true).catch(() => {});
    }, 750);
    return () => clearTimeout(timer);
  }, [loaded, d.settings.audioEnabled]);
  const a: Actions = {
    go(p) {
      location.hash = p;
      setPage(p);
    },
    openEntry: setEntry,
    async run(fn, message) {
      setBusy(true);
      try {
        await fn();
        if (message) setToast(message);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "操作失败，请重试");
      } finally {
        setBusy(false);
      }
    },
  };
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stopPronunciation();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      stopPronunciation();
    };
  }, []);
  useEffect(() => {
    stopPronunciation();
  }, [page]);
  const title = page === "review-plan" ? "复习计划" : navigation.find((n) => n[0] === page)?.[1] || "学习与复习";
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#today">
          <span className="brand-mark">
            <BookOpen size={24} />
          </span>
          <span>
            词间<small>CIJIAN · VOCABULARY</small>
          </span>
        </a>
        <div className="nav-caption">你的学习空间</div>
        <nav>
          {navigation.map(([id, label, Icon]) => (
            <a key={id} href={"#" + id} className={page === id || (page === "review-plan" && id === "today") ? "active" : ""}>
              <Icon size={19} />
              <span>{label}</span>
              {page === id && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Leaf size={28} />
          <h3>每天一点，词汇成林。</h3>
          <p>
            在自己的节奏里，
            <br />
            让记忆慢慢生根。
          </p>
          <span className="local-label">
            <span /> 本地保存 · 无需账号
          </span>
        </div>
        <div className="version">
          词间 {APP_VERSION} <span>LOCAL FIRST</span>
        </div>
      </aside>
      <div className="shell">
        <header className="topbar">
          <span className="breadcrumb">
            学习空间 <ChevronRight size={13} /> <b>{title}</b>
          </span>
          <span className="offline">
            <WifiOff size={14} /> 离线可用
          </span>
        </header>
        <main className="content" ref={pageMotion.ref}
          onClickCapture={pageMotion.cancel} onKeyDownCapture={pageMotion.cancel}
          onPointerCancelCapture={pageMotion.cancel}>
          {!loaded ? (
            <div className="empty">正在打开本地学习空间…</div>
          ) : page === "decks" ? (
            <Libraries d={d} a={a} />
          ) : page === "study" ? (
            <Study d={d} a={a} />
          ) : page === "review-plan" ? (
            <ReviewPlan d={d} a={a} />
          ) : page === "exam" ? (
            <Exams d={d} a={a} />
          ) : page === "stats" ? (
            <Statistics d={d} a={a} />
          ) : page === "settings" ? (
            <Settings d={d} a={a} />
          ) : (
            <Dashboard d={d} a={a} />
          )}
          <footer>
            词间 · 把单词，变成自己的语言。<span>数据留在你的设备上</span>
          </footer>
        </main>
      </div>
      {entry && (
        <div className="modal-backdrop" onClick={() => setEntry(undefined)}>
          <section
            role="dialog"
            aria-label="单词详情"
            className="modal detail-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon close"
              aria-label="关闭详情"
              onClick={() => setEntry(undefined)}
            >
              <X />
            </button>
            <EntryDetail id={entry} d={d} a={a} />
          </section>
        </div>
      )}
      {busy && <div className="saving">正在处理…</div>}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast("")}>
          {toast}
          <X size={15} />
        </div>
      )}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <BookOpen size={36} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function MiniLabel({ children }: { children: React.ReactNode }) {
  return <span className="mini-label">{children}</span>;
}
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <App />
  </Boundary>,
);
