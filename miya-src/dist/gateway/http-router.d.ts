import type { IncomingMessage, ServerResponse } from 'node:http';
export declare function normalizeNodeHeaders(headers: IncomingMessage['headers']): HeadersInit;
export declare function toNodeRequest(req: IncomingMessage, hostname: string, port: number): Request;
export declare function sendNodeResponse(req: IncomingMessage, res: ServerResponse, response: Response): Promise<void>;
export declare function reserveGatewayPort(hostname: string, configuredPort: number): number;
