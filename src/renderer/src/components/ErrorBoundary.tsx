/**
 * 应用级 React Error Boundary。
 *
 * 任何子组件渲染异常时,捕获并显示降级 UI,
 * 避免单点渲染错误把整个应用搞黑屏。
 */
import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] React 渲染崩溃:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo } = this.state;
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg-canvas)] p-8 overflow-auto">
        <div className="max-w-2xl w-full bg-[var(--color-bg-surface)] border border-[var(--color-danger)]/30 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--color-danger)]/20 flex items-center justify-center text-[var(--color-danger)] text-xl">
              ⚠
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
                界面渲染出错了
              </h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                应用没崩,只是某个面板的某次渲染出了问题
              </p>
            </div>
          </div>

          <div className="text-[11px] font-mono text-[var(--color-danger)] bg-[var(--color-danger-dim)]/20 rounded p-3 break-words">
            {error?.message || String(error)}
          </div>

          {errorInfo?.componentStack && (
            <details className="text-[10px] text-[var(--color-text-muted)]">
              <summary className="cursor-pointer hover:text-[var(--color-text-secondary)]">
                查看 React 组件栈 (展开)
              </summary>
              <pre className="mt-2 max-h-[280px] overflow-auto bg-[var(--color-bg-sunken)] p-2 rounded whitespace-pre-wrap">
                {errorInfo.componentStack}
              </pre>
            </details>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={this.handleReset}
              className="btn btn-secondary text-xs px-3 py-1.5 cursor-pointer"
            >
              重试渲染
            </button>
            <button
              onClick={this.handleReload}
              className="btn btn-primary text-xs px-3 py-1.5 cursor-pointer"
            >
              重载应用
            </button>
          </div>
        </div>
      </div>
    );
  }
}
