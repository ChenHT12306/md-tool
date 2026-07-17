import { useState, useRef, useCallback, useEffect } from 'react';
import { Crepe } from '@milkdown/crepe';
import { replaceAll, getMarkdown } from '@milkdown/kit/utils';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

function App() {
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe>();
  const [currentPath, setCurrentPath] = useState('');
  const [fileName, setFileName] = useState('未命名');
  const [isModified, setIsModified] = useState(false);
  const [viewMode, setViewMode] = useState<'wysiwyg' | 'source'>('wysiwyg');
  const [sourceContent, setSourceContent] = useState('');

  const getMarkdown = useCallback(async () => {
    if (crepeRef.current) {
      return crepeRef.current.getMarkdown();
    }
    return '';
  }, []);

  const setContent = useCallback((markdown: string) => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    const editor = crepe.editor;
    editor.action(replaceAll(markdown));
  }, []);

  const handleOpen = useCallback(async () => {
    try {
      const result = await window.go?.main?.App?.OpenFile();
      if (result && crepeRef.current) {
        setContent(result.content);
        setCurrentPath(result.path);
        setFileName(result.name);
        setIsModified(false);
      }
    } catch (e) {
      console.error('打开文件失败:', e);
    }
  }, []);

  const handleSave = useCallback(async () => {
    try {
      const content = await getMarkdown();
      const result = await window.go?.main?.App?.SaveFile(content, currentPath);
      if (result) {
        setCurrentPath(result.path);
        setFileName(result.name);
        setIsModified(false);
      }
    } catch (e) {
      console.error('保存失败:', e);
    }
  }, [currentPath, getMarkdown]);

  const handleExport = useCallback(async (ext: string) => {
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
  }, [getMarkdown]);

  const toggleView = useCallback(async () => {
    if (viewMode === 'wysiwyg') {
      const md = await getMarkdown();
      setSourceContent(md);
      setViewMode('source');
    } else {
      setContent(sourceContent);
      setViewMode('wysiwyg');
    }
  }, [viewMode, sourceContent, getMarkdown, setContent]);

  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const crepe = new Crepe({
      root: container,
      defaultValue: '# 欢迎使用 MD Review\n\n开始编写你的 Markdown 文档吧！\n\n> 提示：使用顶部工具栏格式化文本，无需记忆 Markdown 语法。',
    });

    crepe.create().then(() => {
      crepeRef.current = crepe;
      crepe.on((api) => {
        api.markdownUpdated((ctx, markdown) => {
          setIsModified(true);
        });
      });

      const startupFile = window.go?.main?.App?.GetStartupFile?.();
      Promise.resolve(startupFile).then((path?: string) => {
        if (!path) return;
        window.go?.main?.App?.OpenPath(path)
          .then((res: { content: string; path: string; name: string } | null) => {
            if (res && crepeRef.current) {
              setContent(res.content);
              setCurrentPath(res.path);
              setFileName(res.name);
              setIsModified(false);
            }
          })
          .catch((e: unknown) => console.error('打开启动文件失败:', e));
      });
    });

    return () => {
      crepe.destroy();
    };
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

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-left">
          <span className="app-icon">📝</span>
          <span className="app-title">MD Tool</span>
        </div>
        <div className="titlebar-center">
          <span className="file-name">
            {fileName}
            {isModified && ' •'}
          </span>
        </div>
        <div className="titlebar-right">
          <div className="toolbar-group">
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
      <div className="editor-container">
        <div
          className="editor-wrapper"
          ref={editorRef}
          style={{ display: viewMode === 'wysiwyg' ? 'block' : 'none' }}
        />
        <textarea
          className="source-editor"
          style={{ display: viewMode === 'source' ? 'block' : 'none' }}
          value={sourceContent}
          onChange={(e) => {
            setSourceContent(e.target.value);
            setIsModified(true);
          }}
          spellCheck={false}
          placeholder="在此查看/编辑 Markdown 源码..."
        />
      </div>
      <div className="statusbar">
        <span>{fileName}</span>
        <span>{isModified ? '已修改' : '已保存'}</span>
        <span className="author-info">
          版本: v1.0.0&nbsp;&nbsp;作者: Hunter&nbsp;&nbsp;联系邮箱: <a href="mailto:1261660791@qq.com">1261660791@qq.com</a>
        </span>
      </div>
    </div>
  );
}

export default App;
