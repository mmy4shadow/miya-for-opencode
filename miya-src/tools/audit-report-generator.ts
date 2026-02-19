#!/usr/bin/env bun

import * as fs from 'node:fs';
import * as path from 'node:path';

interface IntegrationReport {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

interface BenchmarkRecord {
  elapsedMs: number;
  sampleSize: number;
  updatedAt: string;
}

interface BenchmarksFile {
  benchmarks?: Record<string, BenchmarkRecord>;
}

export interface AuditSnapshot {
  generatedAt: string;
  integration: {
    available: boolean;
    ok?: boolean;
    exitCode?: number;
    durationMs?: number;
    startedAt?: string;
    finishedAt?: string;
  };
  performance: {
    baselineFile: string;
    benchmarkCount: number;
    benchmarks: Record<string, BenchmarkRecord>;
  };
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function collectAuditSnapshot(projectDir: string): AuditSnapshot {
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
  const integration = readJsonFile<IntegrationReport>(integrationPath);
  const baselines = readJsonFile<BenchmarksFile>(baselinePath);
  const benchmarkMap =
    baselines?.benchmarks && typeof baselines.benchmarks === 'object'
      ? baselines.benchmarks
      : {};
  return {
    generatedAt: new Date().toISOString(),
    integration: integration
      ? {
          available: true,
          ok: integration.ok,
          exitCode: integration.exitCode,
          durationMs: integration.durationMs,
          startedAt: integration.startedAt,
          finishedAt: integration.finishedAt,
        }
      : { available: false },
    performance: {
      baselineFile: path.relative(projectDir, baselinePath),
      benchmarkCount: Object.keys(benchmarkMap).length,
      benchmarks: benchmarkMap,
    },
  };
}

export function renderAuditReportMarkdown(snapshot: AuditSnapshot): string {
  const lines: string[] = [];
  lines.push('# Automated Audit Snapshot');
  lines.push('');
  lines.push(`- Generated At: ${snapshot.generatedAt}`);
  lines.push(
    `- Integration Report: ${snapshot.integration.available ? 'available' : 'missing'}`,
  );
  if (snapshot.integration.available) {
    lines.push(`- Integration OK: ${snapshot.integration.ok ? 'yes' : 'no'}`);
    lines.push(`- Integration Exit Code: ${snapshot.integration.exitCode ?? -1}`);
    lines.push(`- Integration Duration (ms): ${snapshot.integration.durationMs ?? 0}`);
  }
  lines.push(`- Performance Baseline File: \`${snapshot.performance.baselineFile}\``);
  lines.push(`- Benchmark Count: ${snapshot.performance.benchmarkCount}`);
  lines.push('');
  lines.push('## Benchmarks');
  if (snapshot.performance.benchmarkCount === 0) {
    lines.push('- none');
  } else {
    for (const [name, record] of Object.entries(snapshot.performance.benchmarks)) {
      lines.push(
        `- ${name}: ${record.elapsedMs.toFixed(2)}ms @ n=${record.sampleSize} (updated ${record.updatedAt})`,
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeAuditReport(
  projectDir: string,
  snapshot: AuditSnapshot,
): { markdownFile: string; jsonFile: string } {
  const reportDir = path.join(projectDir, 'test', 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const markdownFile = path.join(reportDir, 'audit-latest.md');
  const jsonFile = path.join(reportDir, 'audit-latest.json');
  fs.writeFileSync(markdownFile, renderAuditReportMarkdown(snapshot), 'utf-8');
  fs.writeFileSync(jsonFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf-8');
  return { markdownFile, jsonFile };
}

if (import.meta.main) {
  const projectDir = process.cwd();
  const snapshot = collectAuditSnapshot(projectDir);
  const { markdownFile, jsonFile } = writeAuditReport(projectDir, snapshot);
  process.stdout.write(`[audit-report] markdown=${markdownFile}\n`);
  process.stdout.write(`[audit-report] json=${jsonFile}\n`);
}
