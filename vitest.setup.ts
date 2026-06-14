// Vitest setup for renderer (jsdom) tests.
//
// React 19 + @testing-library/react 16 兼容：
// React 19 的 React.act 仅在 NODE_ENV !== 'production' 时导出。
// testing-library 16 的 act-compat 在模块加载时检查 typeof React.act，
// 若为 undefined 则后续 render() 报 "React.act is not a function"。
// NODE_ENV=test 已在 vitest.config.ts 顶层设置（必须在模块加载前）。
// 这里设置 IS_REACT_ACT_ENVIRONMENT 让 testing-library 启用 act 兼容层。

// 自动 cleanup：vitest 不像 jest-globals 那样自动注入 afterEach(cleanup)，
// 不清理会导致跨测试 DOM 残留，render 查询时报 "Found multiple elements"。
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
});
