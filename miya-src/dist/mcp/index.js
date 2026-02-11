import { context7 } from './context7';
import { grep_app } from './grep-app';
import { websearch } from './websearch';
const allBuiltinMcps = {
    websearch,
    context7,
    grep_app,
};
/**
 * Creates MCP configurations, excluding disabled ones
 */
export function createBuiltinMcps(disabledMcps = []) {
    return Object.fromEntries(Object.entries(allBuiltinMcps).filter(([name]) => !disabledMcps.includes(name)));
}
