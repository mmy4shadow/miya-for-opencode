import type { SkillDescriptor } from '../skills/loader';
export interface CapabilitySchema {
    id: string;
    version: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
    sideEffects: string[];
    permissions: string[];
    auditFields: string[];
    fallbackPlan: string;
}
export declare function buildGatewayCapabilitySchemas(methods: string[]): CapabilitySchema[];
export declare function buildSkillCapabilitySchemas(skills: SkillDescriptor[]): CapabilitySchema[];
export declare function buildToolCapabilitySchemas(toolNames: string[]): CapabilitySchema[];
