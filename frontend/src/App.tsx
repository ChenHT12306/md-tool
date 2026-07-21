import { useState, useRef, useCallback, useEffect } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { replaceAll, $markSchema, $remark } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

const highlightMark = $markSchema('highlight', () => ({
  group: 'inline',
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', { class: 'highlight' }, 0],
  parseMarkdown: {
    match: (node: any) => node.type === 'mark',
    runner: (state: any, node: any, type: any) => {
      state.openMark(type);
      state.addText(node.value ?? '');
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark: any) => mark.type.name === 'highlight',
    runner: (state: any, _mark: any, node: any) => {
      state.addNode('html', undefined, `<mark>${node.text ?? ''}</mark>`);
      return true;
    },
  },
}));

const remarkMark = $remark('remark-mark', () => {
  return (tree: any) => {
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.children)) {
        const out: any[] = [];
        for (const child of node.children) {
          if (child && child.type === 'text' && typeof child.value === 'string' && /==/.test(child.value)) {
            const regex = /==([^=\n]+?)==/g;
            let last = 0;
            let m: RegExpExecArray | null;
            while ((m = regex.exec(child.value)) !== null) {
              if (m.index > last) {
                out.push({ type: 'text', value: child.value.slice(last, m.index) });
              }
              out.push({ type: 'mark', value: m[1] });
              last = regex.lastIndex;
            }
            if (last < child.value.length) {
              out.push({ type: 'text', value: child.value.slice(last) });
            }
          } else if (child && child.type === 'html' && typeof child.value === 'string') {
            const m = /^<mark>([\s\S]*?)<\/mark>$/.exec(child.value.trim());
            if (m) {
              out.push({ type: 'mark', value: m[1] });
              continue;
            }
            walk(child);
            out.push(child);
          } else {
            walk(child);
            out.push(child);
          }
        }
        node.children = out;
      }
    };
    walk(tree);
  };
});

interface Tab {
  id: string;
  name: string;
  path: string;
  content: string;
  isModified: boolean;
}

const WELCOME = '# 欢迎使用 MD Tool\n\n开始编写你的 Markdown 文档吧！\n\n> 提示：使用顶部工具栏格式化文本，无需记忆 Markdown 语法。';

const fileToDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const dirOf = (path?: string): string =>
  path ? path.replace(/[\\/][^\\/]*$/, '').replace(/\\/g, '/') : '';

const toAbsImages = (md: string, dir: string): string =>
  dir ? md.replace(/]\(assets\//g, `](file:///${dir}/assets/`) : md;

const toRelImages = (md: string): string =>
  md.replace(/]\(file:\/\/\/[^)]*?\/assets\//g, '](assets/');

function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe>();
  const tabsRef = useRef<Tab[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);
  const loadingRef = useRef(false);
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startScreenX: number;
    startScreenY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
    pointerId: number;
    el: HTMLElement;
  } | null>(null);
  const pidRef = useRef<number>(0);
  const windowPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const windowsRef = useRef<Array<{ pid: number; uid: string; x: number; y: number; w: number; h: number }>>([]);
  const fileMtimeRef = useRef<Record<string, number>>({});
  const promptingRef = useRef(false);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg');
  const [sourceContent, setSourceContent] = useState('');
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeId) || null;

  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const getMarkdown = useCallback(async () => {
    if (crepeRef.current) return crepeRef.current.getMarkdown();
    return '';
  }, []);

  const setContent = useCallback((markdown: string) => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    crepe.editor.action(replaceAll(markdown));
  }, []);

  const patchActive = useCallback((patch: Partial<Tab>) => {
    const id = activeIdRef.current;
    if (!id) return;
    tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t));
    setTabs(tabsRef.current);
  }, []);

  const loadIntoEditor = useCallback(
    (content: string) => {
      loadingRef.current = true;
      const dir = dirOf(
        tabsRef.current.find((t) => t.id === activeIdRef.current)?.path,
      );
      const display = toAbsImages(content, dir);
      setContent(display);
      setSourceContent(display);
      setViewMode('wysiwyg');
      setTimeout(() => {
        loadingRef.current = false;
      }, 50);
    },
    [setContent],
  );

  const openFileInTab = useCallback(
    (file: { path: string; content: string; name: string }) => {
      if (file.path) {
        const existing = tabsRef.current.find((t) => t.path && t.path === file.path);
        if (existing) {
          setActive(existing.id);
          return;
        }
      }
      const id = 'tab-' + nextIdRef.current++;
      const tab: Tab = {
        id,
        name: file.name || '未命名',
        path: file.path || '',
        content: file.content || '',
        isModified: false,
      };
      tabsRef.current = [...tabsRef.current, tab];
      setTabs(tabsRef.current);
      setActive(id);
      loadIntoEditor(file.content || '');
    },
    [setActive, loadIntoEditor],
  );

  const handleOpen = useCallback(async () => {
    try {
      const result = await window.go?.main?.App?.OpenFile();
      if (result) openFileInTab(result);
    } catch (e) {
      console.error('打开文件失败:', e);
    }
  }, [openFileInTab]);

  const newDoc = useCallback(
    (content = '') => {
      const id = 'tab-' + nextIdRef.current++;
      const tab: Tab = { id, name: '未命名', path: '', content, isModified: false };
      tabsRef.current = [...tabsRef.current, tab];
      setTabs(tabsRef.current);
      setActive(id);
      loadIntoEditor(content);
    },
    [setActive, loadIntoEditor],
  );

  const switchTab = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      const cur = tabsRef.current.find((t) => t.id === activeIdRef.current);
      if (cur) {
        const md = await getMarkdown();
        tabsRef.current = tabsRef.current.map((t) => (t.id === cur.id ? { ...t, content: md } : t));
        setTabs(tabsRef.current);
      }
      const target = tabsRef.current.find((t) => t.id === id);
      if (!target) return;
      setActive(id);
      loadIntoEditor(target.content);
    },
    [getMarkdown, setActive, loadIntoEditor],
  );

  const closeTab = useCallback(
    async (id: string) => {
      const target = tabsRef.current.find((t) => t.id === id);
      if (!target) return;

      let snapshot = tabsRef.current;
      if (id === activeIdRef.current) {
        try {
          const md = await getMarkdown();
          snapshot = snapshot.map((t) => (t.id === id ? { ...t, content: md } : t));
        } catch {
          /* 取内容失败也继续关闭 */
        }
      }
      const idx = snapshot.findIndex((t) => t.id === id);
      const remaining = snapshot.filter((t) => t.id !== id);

      if (id === activeIdRef.current) {
        const next = remaining[idx] || remaining[idx - 1] || null;
        if (next) {
          setActive(next.id);
          loadIntoEditor(next.content);
        } else {
          setActive(null);
          loadIntoEditor('');
        }
      }
      if (target.path) {
        (window as any).go?.main?.App?.UnlockFile?.(target.path);
      }
      tabsRef.current = remaining;
      setTabs(remaining);
      if (remaining.length === 0) {
        try {
          (window as any).runtime?.WindowClose();
        } catch {
          /* ignore */
        }
      }
    },
    [getMarkdown, setActive, loadIntoEditor],
  );

  const detachTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      let content = tab.content;
      if (id === activeIdRef.current) {
        content = await getMarkdown();
        tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, content } : t));
        setTabs(tabsRef.current);
      }
      try {
        await window.go?.main?.App?.OpenInNewWindow(tab.path, content);
        await closeTab(id);
      } catch (e) {
        console.error('拖出新窗口失败:', e);
      }
    },
    [getMarkdown, closeTab],
  );

  const sendTabToWindow = useCallback(
    async (targetUid: string, id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab) return;
      let content = tab.content;
      if (id === activeIdRef.current) {
        content = await getMarkdown();
        tabsRef.current = tabsRef.current.map((t) => (t.id === id ? { ...t, content } : t));
        setTabs(tabsRef.current);
      }
      try {
        await window.go?.main?.App?.SendTabToWindow(targetUid, tab.path, content);
        await closeTab(id);
      } catch (e) {
        console.error('拖回窗口失败:', e);
        await closeTab(id).catch(() => {});
      }
    },
    [getMarkdown, closeTab],
  );

  const reorderTab = useCallback((dragId: string, overId: string, after: boolean) => {
    const list = tabsRef.current;
    const from = list.findIndex((t) => t.id === dragId);
    const to = list.findIndex((t) => t.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const item = list[from];
    const without = list.filter((t) => t.id !== dragId);
    let insertAt = without.findIndex((t) => t.id === overId);
    if (after) insertAt += 1;
    without.splice(insertAt, 0, item);
    tabsRef.current = without;
    setTabs(without);
  }, []);

  const reloadTab = useCallback(
    async (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (!tab || !tab.path) return;
      try {
        const res = await (window as any).go?.main?.App?.ReadFile(tab.path);
        if (!res) return;
        tabsRef.current = tabsRef.current.map((t) =>
          t.id === id ? { ...t, content: res.content, isModified: false } : t,
        );
        setTabs(tabsRef.current);
        if (id === activeIdRef.current) loadIntoEditor(res.content);
        const mt = await (window as any).go?.main?.App?.GetFileModTime(tab.path);
        if (mt) fileMtimeRef.current[id] = mt;
      } catch {
        /* 读取失败忽略 */
      }
    },
    [loadIntoEditor],
  );

  const handleSave = useCallback(async () => {
    const cur = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!cur) return;
    try {
      const raw = await getMarkdown();
      const content = toRelImages(raw);
      const path = cur.path;
      const result = await (window as any).go?.main?.App?.SaveFile(content, path);
      if (result) {
        tabsRef.current = tabsRef.current.map((t) =>
          t.id === cur.id
            ? { ...t, path: result.path, name: result.name, content, isModified: false }
            : t,
        );
        setTabs(tabsRef.current);
        const mt = await (window as any).go?.main?.App?.GetFileModTime(result.path);
        if (mt) fileMtimeRef.current[cur.id] = mt;
      }
    } catch (e) {
      console.error('保存失败:', e);
    }
  }, [getMarkdown]);

  const handleExport = useCallback(
    async (ext: string) => {
      try {
        let content = await getMarkdown();
        if (ext === '.html') {
          const { marked } = await import('marked');
          content = await marked(content);
        }
        await window.go?.main?.App?.ExportFile(content, ext);
      } catch (e) {
        if (ext === '.html') {
          alert('HTML 导出需要先执行: npm install marked');
        }
      }
    },
    [getMarkdown],
  );

  const toggleView = useCallback(async () => {
    if (viewMode === 'wysiwyg') {
      const md = await getMarkdown();
      setSourceContent(md);
      patchActive({ content: md });
      setViewMode('source');
    } else {
      setContent(sourceContent);
      patchActive({ content: sourceContent });
      setViewMode('wysiwyg');
    }
  }, [viewMode, sourceContent, getMarkdown, setContent, patchActive]);

  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const crepe = new Crepe({
      root: container,
      defaultValue: '',
      featureConfigs: {
        [CrepeFeature.ImageBlock]: {
          onUpload: async (file: File): Promise<string> => {
            const dir = dirOf(
              tabsRef.current.find((t) => t.id === activeIdRef.current)?.path,
            );
            if (!dir) return fileToDataURL(file);
            const dataUrl = await fileToDataURL(file);
            const b64 = dataUrl.split(',')[1] ?? '';
            const rel = await (window.go as any)?.main?.App?.SaveImage(dir, file.name, b64);
            if (!rel) return dataUrl;
            return `file:///${dir}/${rel}`;
          },
        },
      },
    });

    crepe.addFeature((editor: any) => {
      editor.use(highlightMark);
      editor.use(remarkMark);
    });

    crepe.create().then(() => {
      crepeRef.current = crepe;
      crepe.on((api) => {
        api.markdownUpdated((_ctx, _markdown) => {
          if (loadingRef.current) return;
          const id = activeIdRef.current;
          if (id) {
            tabsRef.current = tabsRef.current.map((t) =>
              t.id === id ? { ...t, isModified: true } : t,
            );
            setTabs(tabsRef.current);
          }
        });
      });

      const startupFile = window.go?.main?.App?.GetStartupFile?.();
      Promise.resolve(startupFile).then((path?: string) => {
        if (path) {
          window.go?.main?.App?.OpenPath(path)
            .then((res: { content: string; path: string; name: string } | null) => {
              if (res) openFileInTab(res);
            })
            .catch((e: unknown) => console.error('打开启动文件失败:', e));
        } else {
          newDoc(WELCOME);
        }
      });
    });

    return () => {
      crepe.destroy();
    };
  }, [openFileInTab, newDoc]);

  useEffect(() => {
    const w = window as any;
    const off = w.runtime?.EventsOn?.('second-instance', (args: string[]) => {
      const path = (args || []).find((a) => /\.(md|markdown)$/i.test(a));
      if (!path) return;
      w.runtime?.WindowShow?.();
      w.runtime?.WindowSetAlwaysOnTop?.(true);
      setTimeout(() => w.runtime?.WindowSetAlwaysOnTop?.(false), 200);
      window.go?.main?.App?.FlashTaskbar?.(3);
      window.go?.main?.App?.OpenPath(path)
        .then((res: { content: string; path: string; name: string } | null) => {
          if (res) openFileInTab(res);
        })
        .catch((e: unknown) => console.error('打开第二实例文件失败:', e));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [openFileInTab]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 12) {
        d.moved = true;
        document.body.classList.add('dragging');
      }
      if (!d.moved) return;
      try {
        window.getSelection()?.removeAllRanges();
      } catch {
        /* ignore */
      }
      const tab = tabsRef.current.find((t) => t.id === d.id);
      const name = tab?.name || '未命名';
      const inside =
        e.clientX >= 0 && e.clientX <= window.innerWidth && e.clientY >= 0 && e.clientY <= window.innerHeight;
      if (inside) {
        const overEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const overTab = overEl?.closest('.tab') as HTMLElement | null;
        const overId = overTab?.getAttribute('data-id');
        if (overId && overId !== d.id && overTab) {
          const rect = overTab.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          reorderTab(d.id, overId, after);
          setGhost({ name, x: e.clientX, y: e.clientY });
          return;
        }
      }
      if (tabsRef.current.length <= 1) {
        try {
          const rt = (window as any).runtime;
          const nx = e.screenX - d.offsetX;
          const ny = e.screenY - d.offsetY;
          rt.WindowSetPosition(nx, ny);
          windowPosRef.current = { x: nx, y: ny };
        } catch {
          /* ignore */
        }
        setGhost(null);
      } else {
        const gx = Math.max(0, Math.min(window.innerWidth - 40, e.clientX));
        const gy = Math.max(0, Math.min(window.innerHeight - 40, e.clientY));
        setGhost({ name, x: gx, y: gy });
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      document.body.classList.remove('dragging');
      setGhost(null);
      try {
        d?.el.releasePointerCapture?.(d.pointerId);
      } catch {
        /* ignore */
      }
      if (!d || !d.moved) return;

      const sx = e.screenX;
      const sy = e.screenY;
      const target = windowsRef.current.find(
        (wd) =>
          wd.pid !== pidRef.current &&
          sx >= wd.x && sx <= wd.x + wd.w &&
          sy >= wd.y && sy <= wd.y + wd.h,
      );
      if (target) {
        sendTabToWindow(target.uid, d.id);
        return;
      }
      if (tabsRef.current.length <= 1) {
        return;
      }
      detachTab(d.id);
    };
    const onLostCapture = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d && e.pointerId === d.pointerId && d.moved) {
        try {
          d.el.setPointerCapture(d.pointerId);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('lostpointercapture', onLostCapture);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('lostpointercapture', onLostCapture);
    };
  }, [detachTab, sendTabToWindow, reorderTab]);

  useEffect(() => {
    window.go?.main?.App?.GetPid()
      .then((p: number) => {
        pidRef.current = p;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const update = async () => {
      try {
        const rt = (window as any).runtime;
        const pos = await rt.WindowGetPosition();
        const size = await rt.WindowGetSize();
        windowPosRef.current = { x: pos.x, y: pos.y };
        await window.go?.main?.App?.RegisterWindow(pos.x, pos.y, size.w, size.h);
        const ws = await window.go?.main?.App?.GetWindows();
        if (ws) windowsRef.current = ws;
      } catch {
        /* ignore */
      }
    };
    update();
    timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const handler = () => {
      window.go?.main?.App?.UnregisterWindow().catch(() => {});
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleOpen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleOpen]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (promptingRef.current) return;
      for (const t of tabsRef.current) {
        if (!t.path) continue;
        let mt: number | undefined;
        try {
          mt = await (window as any).go?.main?.App?.GetFileModTime(t.path);
        } catch {
          mt = undefined;
        }
        if (!mt) {
          if (fileMtimeRef.current[t.id] !== -1) {
            fileMtimeRef.current[t.id] = -1;
            promptingRef.current = true;
            window.confirm(
              `文件 "${t.name}" 已被移动、重命名或删除。\n当前编辑内容仍保留，保存时将另存为新文件。`,
            );
            promptingRef.current = false;
          }
          continue;
        }
        const prev = fileMtimeRef.current[t.id];
        if (!prev) {
          fileMtimeRef.current[t.id] = mt;
          continue;
        }
        if (prev !== -1 && prev !== mt) {
          promptingRef.current = true;
          const ok = window.confirm(
            `文件 "${t.name}" 已在外部被修改。\n\n点"确定"重新加载最新内容；点"取消"保留当前编辑内容。`,
          );
          promptingRef.current = false;
          if (ok) {
            await reloadTab(t.id);
          } else {
            fileMtimeRef.current[t.id] = mt;
          }
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [reloadTab]);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="app-icon">📝</span>
          <span className="app-title">MD Tool</span>
        </div>
        <div className="titlebar-center">
          <span className="file-name">
            {activeTab ? activeTab.name : '无打开文档'}
            {activeTab?.isModified && ' •'}
          </span>
        </div>
        <div className="titlebar-right">
          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={() => newDoc()} title="新建">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新建
            </button>
            <button className="toolbar-btn" onClick={handleOpen} title="打开 (Ctrl+O)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
              打开
            </button>
            <button className="toolbar-btn primary" onClick={handleSave} title="保存 (Ctrl+S)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17,21 17,13 7,13 7,21" />
                <polyline points="7,3 7,8 15,8" />
              </svg>
              保存
            </button>
          </div>
          <div className="toolbar-divider" />
          <div className="toolbar-group">
            <button className="toolbar-btn" onClick={() => handleExport('.html')} title="导出 HTML">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7,10 12,15 17,10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              导出
            </button>
          </div>
          <div className="toolbar-divider" />
          <div className="toolbar-group">
            <button
              className={'toolbar-btn' + (viewMode === 'source' ? ' active' : '')}
              onClick={toggleView}
              title="切换源码/预览"
            >
              {viewMode === 'wysiwyg' ? '源码' : '预览'}
            </button>
          </div>
        </div>
      </div>

      {tabs.length > 0 && (
        <div className="tabbar">
          {tabs.map((t) => (
            <div
              key={t.id}
              data-id={t.id}
              className={'tab' + (t.id === activeId ? ' active' : '')}
              onClick={() => switchTab(t.id)}
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest('.tab-close')) return;
                const el = e.currentTarget as HTMLElement;
                try {
                  el.setPointerCapture(e.pointerId);
                } catch {
                  /* ignore */
                }
                const win = windowPosRef.current;
                dragRef.current = {
                  id: t.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  startScreenX: e.screenX,
                  startScreenY: e.screenY,
                  offsetX: e.screenX - win.x,
                  offsetY: e.screenY - win.y,
                  moved: false,
                  pointerId: e.pointerId,
                  el,
                };
              }}
              title={t.path || t.name}
            >
              <span className="tab-name">
                {t.name}
                {t.isModified && ' •'}
              </span>
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                title="关闭"
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}

      {ghost && (
        <div className="tab-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.name}
        </div>
      )}

      <div className="editor-container">
        <div
          className="editor-wrapper"
          ref={editorRef}
          style={{
            display: activeTab && viewMode === 'wysiwyg' ? 'block' : 'none',
          }}
        />
        <textarea
          className="source-editor"
          style={{ display: activeTab && viewMode === 'source' ? 'block' : 'none' }}
          value={sourceContent}
          onChange={(e) => {
            const v = e.target.value;
            setSourceContent(v);
            patchActive({ content: v, isModified: true });
          }}
          spellCheck={false}
          placeholder="在此查看/编辑 Markdown 源码..."
        />
      </div>
      <div className="statusbar">
        <span>{activeTab ? activeTab.name : '无打开文档'}</span>
        <span>{activeTab?.isModified ? '已修改' : '已保存'}</span>
        <span className="author-info">
          版本: v1.0.0&nbsp;&nbsp;作者: Hunter&nbsp;&nbsp;wx: cht12306&nbsp;&nbsp;联系邮箱: <a href="mailto:1261660791@qq.com">1261660791@qq.com</a>
        </span>
      </div>
    </div>
  );
}

export default App;
