import { beforeEach, describe, expect, it } from 'vitest';
import { useContextModalStore } from './contextModalStore';

beforeEach(() => {
  useContextModalStore.setState({ isOpen: false });
});

describe('useContextModalStore', () => {
  it('open() sets isOpen=true', () => {
    expect(useContextModalStore.getState().isOpen).toBe(false);
    useContextModalStore.getState().open();
    expect(useContextModalStore.getState().isOpen).toBe(true);
  });

  it('close() sets isOpen=false', () => {
    useContextModalStore.setState({ isOpen: true });
    useContextModalStore.getState().close();
    expect(useContextModalStore.getState().isOpen).toBe(false);
  });

  it('toggle() flips isOpen', () => {
    expect(useContextModalStore.getState().isOpen).toBe(false);
    useContextModalStore.getState().toggle();
    expect(useContextModalStore.getState().isOpen).toBe(true);
    useContextModalStore.getState().toggle();
    expect(useContextModalStore.getState().isOpen).toBe(false);
  });
});
