import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  closeCanvasDoc,
  getCanvasDoc,
  openCanvasDoc,
  readCanvasState,
  renderCanvasDoc,
} from './state';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-canvas-test-'));
}

describe('canvas state', () => {
  test('opens and renders a canvas document', () => {
    const projectDir = tempProjectDir();
    const doc = openCanvasDoc(projectDir, {
      title: 'Runtime Board',
      type: 'markdown',
      content: '# hello',
    });
    expect(doc.id.startsWith('canvas_')).toBe(true);

    const rendered = renderCanvasDoc(projectDir, {
      docID: doc.id,
      content: '# updated',
      merge: false,
    });
    expect(rendered?.content).toBe('# updated');
    expect(getCanvasDoc(projectDir, doc.id)?.content).toBe('# updated');

    closeCanvasDoc(projectDir, doc.id);
    expect(readCanvasState(projectDir).events.length).toBe(3);
  });
});
