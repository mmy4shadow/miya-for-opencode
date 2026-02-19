import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  collectAuditSnapshot,
  renderAuditReportMarkdown,
  writeAuditReport,
} from '../../tools/audit-report-generator';

function makeTempProjectDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'miya-audit-report-test-'));
}

describe('audit report generation', () => {
  test('collects snapshot from integration report and baselines', () => {
    const projectDir = makeTempProjectDir();
    const integrationPath = path.join(
      projectDir,
      '.opencode',
      'miya',
      'reports',
      'integration-latest.json',
    );
    const baselinePath = path.join(
      projectDir,
      'test',
      'baselines',
      'benchmarks.json',
    );
    fs.mkdirSync(path.dirname(integrationPath), { recursive: true });
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(
      integrationPath,
      JSON.stringify({
        ok: true,
        exitCode: 0,
        durationMs: 1234,
        startedAt: '2026-02-19T01:00:00.000Z',
        finishedAt: '2026-02-19T01:00:01.234Z',
      }),
    );
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        benchmarks: {
          action_ledger_append_and_query_500: {
            elapsedMs: 5000,
            sampleSize: 500,
            updatedAt: '2026-02-19T00:00:00.000Z',
          },
        },
      }),
    );

    const snapshot = collectAuditSnapshot(projectDir);
    expect(snapshot.integration.available).toBe(true);
    expect(snapshot.integration.ok).toBe(true);
    expect(snapshot.performance.benchmarkCount).toBe(1);
  });

  test('writes markdown and json report files', () => {
    const projectDir = makeTempProjectDir();
    const snapshot = collectAuditSnapshot(projectDir);
    const markdown = renderAuditReportMarkdown(snapshot);
    expect(markdown).toContain('# Automated Audit Snapshot');

    const written = writeAuditReport(projectDir, snapshot);
    expect(fs.existsSync(written.markdownFile)).toBe(true);
    expect(fs.existsSync(written.jsonFile)).toBe(true);
  });
});
