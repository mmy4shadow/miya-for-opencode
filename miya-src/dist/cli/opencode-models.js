function isFreeModel(record) {
    const inputCost = record.cost?.input ?? 0;
    const outputCost = record.cost?.output ?? 0;
    const cacheReadCost = record.cost?.cache?.read ?? 0;
    const cacheWriteCost = record.cost?.cache?.write ?? 0;
    return (inputCost === 0 &&
        outputCost === 0 &&
        cacheReadCost === 0 &&
        cacheWriteCost === 0);
}
function parseDailyRequestLimit(record) {
    const explicitLimit = record.quota?.requestsPerDay ??
        record.meta?.requestsPerDay ??
        record.meta?.dailyLimit;
    if (typeof explicitLimit === 'number' && Number.isFinite(explicitLimit)) {
        return explicitLimit;
    }
    const source = `${record.id} ${record.name ?? ''}`.toLowerCase();
    const match = source.match(/\b(300|2000|5000)\b(?:\s*(?:req|requests|rpd|\/day))?/);
    if (!match)
        return undefined;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function normalizeDiscoveredModel(record, providerFilter) {
    if (providerFilter && record.providerID !== providerFilter)
        return null;
    const fullModel = `${record.providerID}/${record.id}`;
    return {
        providerID: record.providerID,
        model: fullModel,
        name: record.name ?? record.id,
        status: record.status ?? 'active',
        contextLimit: record.limit?.context ?? 0,
        outputLimit: record.limit?.output ?? 0,
        reasoning: record.capabilities?.reasoning === true,
        toolcall: record.capabilities?.toolcall === true,
        attachment: record.capabilities?.attachment === true,
        dailyRequestLimit: parseDailyRequestLimit(record),
        costInput: record.cost?.input,
        costOutput: record.cost?.output,
    };
}
export function parseOpenCodeModelsVerboseOutput(output, providerFilter, freeOnly = true) {
    const lines = output.split(/\r?\n/);
    const models = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]?.trim();
        if (!line || !line.includes('/'))
            continue;
        const isModelHeader = /^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(line);
        if (!isModelHeader)
            continue;
        let jsonStart = -1;
        for (let search = index + 1; search < lines.length; search++) {
            if (lines[search]?.trim().startsWith('{')) {
                jsonStart = search;
                break;
            }
            if (/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(lines[search]?.trim() ?? '')) {
                break;
            }
        }
        if (jsonStart === -1)
            continue;
        let braceDepth = 0;
        const jsonLines = [];
        let jsonEnd = -1;
        for (let cursor = jsonStart; cursor < lines.length; cursor++) {
            const current = lines[cursor] ?? '';
            jsonLines.push(current);
            for (const char of current) {
                if (char === '{')
                    braceDepth++;
                if (char === '}')
                    braceDepth--;
            }
            if (braceDepth === 0 && jsonLines.length > 0) {
                jsonEnd = cursor;
                break;
            }
        }
        if (jsonEnd === -1)
            continue;
        try {
            const parsed = JSON.parse(jsonLines.join('\n'));
            const normalized = normalizeDiscoveredModel(parsed, providerFilter);
            if (!normalized)
                continue;
            if (freeOnly && !isFreeModel(parsed))
                continue;
            if (normalized)
                models.push(normalized);
        }
        catch {
            // Ignore malformed blocks and continue parsing the next model.
        }
        index = jsonEnd;
    }
    return models;
}
async function discoverFreeModelsByProvider(providerID) {
    try {
        const proc = Bun.spawn(['opencode', 'models', '--refresh', '--verbose'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        if (proc.exitCode !== 0) {
            return {
                models: [],
                error: stderr.trim() || 'Failed to fetch OpenCode models.',
            };
        }
        return {
            models: parseOpenCodeModelsVerboseOutput(stdout, providerID, true),
        };
    }
    catch {
        return {
            models: [],
            error: 'Unable to run `opencode models --refresh --verbose`.',
        };
    }
}
export async function discoverModelCatalog() {
    try {
        const proc = Bun.spawn(['opencode', 'models', '--refresh', '--verbose'], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;
        if (proc.exitCode !== 0) {
            return {
                models: [],
                error: stderr.trim() || 'Failed to fetch OpenCode models.',
            };
        }
        return {
            models: parseOpenCodeModelsVerboseOutput(stdout, undefined, false),
        };
    }
    catch {
        return {
            models: [],
            error: 'Unable to run `opencode models --refresh --verbose`.',
        };
    }
}
export async function discoverOpenCodeFreeModels() {
    return discoverFreeModelsByProvider('opencode');
}
export async function discoverProviderFreeModels(providerID) {
    return discoverFreeModelsByProvider(providerID);
}
