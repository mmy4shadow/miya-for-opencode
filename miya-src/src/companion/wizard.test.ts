import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  startCompanionWizard,
  submitCompanionWizardInput,
  tickCompanionTrainingJobs,
} from './wizard';

function tempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-companion-wizard-test-'));
}

describe('companion wizard', () => {
  test('advances from collect to training completion', () => {
    const projectDir = tempProjectDir();
    const started = startCompanionWizard(projectDir);
    expect(started.step).toBe('collect_images');

    const submitted = submitCompanionWizardInput(projectDir, {
      imageMediaIDs: ['img-1'],
      audioMediaIDs: ['aud-1'],
      personaText: '温柔、简洁',
    });
    expect(submitted.jobs.length).toBeGreaterThan(0);

    let lastStep = submitted.step;
    for (let i = 0; i < 20; i += 1) {
      const tick = tickCompanionTrainingJobs(projectDir);
      lastStep = tick.state.step;
      if (lastStep === 'done') break;
    }
    expect(lastStep).toBe('done');
  });
});
