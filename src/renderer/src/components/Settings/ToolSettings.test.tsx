import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '../../i18n';
import { ToolSettings } from './ToolSettings';

const getToolConfigsMock = vi.fn();
const saveToolConfigMock = vi.fn();

describe('ToolSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToolConfigsMock.mockResolvedValue([]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      db: {
        getToolConfigs: getToolConfigsMock,
        saveToolConfig: saveToolConfigMock,
      },
    };
    if (!window.crypto.randomUUID) {
      Object.defineProperty(window.crypto, 'randomUUID', {
        configurable: true,
        value: vi.fn(() => 'tool-config-id'),
      });
    }
  });

  it('loads built-in tool configs without Paper Search CLI settings', async () => {
    render(<ToolSettings />);

    expect(await screen.findByText(/Built-in tools list|通用内置工具列表/)).toBeTruthy();
    expect(screen.queryByLabelText(/EasyScholar SecretKey/)).toBeNull();
    expect(getToolConfigsMock).toHaveBeenCalledTimes(1);
  });
});
