import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Model Selection Surface direction wiring', () => {
  const modelSelectionSurfaceSource = fs.readFileSync(
    path.join(process.cwd(), 'src/renderer/src/components/ChatArea/modelSelection/ModelSelectionSurface.tsx'),
    'utf-8'
  );
  const globalsCss = fs.readFileSync(
    path.join(process.cwd(), 'src/renderer/src/styles/globals.css'),
    'utf-8'
  );

  it('marks welcome and composer selectors with distinct direction classes', () => {
    expect(modelSelectionSurfaceSource).toContain('model-selector model-selector--welcome');
    expect(modelSelectionSurfaceSource).toContain('model-selector model-selector--composer');
  });

  it('opens the welcome selector downward and composer selector upward', () => {
    expect(globalsCss).toMatch(/\.model-selector--welcome\s+\.model-dropdown\s*\{[^}]*top:\s*calc\(100%\s*\+\s*6px\)/s);
    expect(globalsCss).toMatch(/\.model-selector--composer\s+\.model-dropdown\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*6px\)/s);
  });

  it('does not force all model dropdowns upward by default', () => {
    const baseRule = globalsCss.match(/\.model-dropdown\s*\{(?<body>[^}]*)\}/s);

    expect(baseRule?.groups?.body ?? '').not.toContain('bottom: calc(100% + 6px)');
  });
});
