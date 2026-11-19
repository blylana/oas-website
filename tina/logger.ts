import { getRequestContext } from './context';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogFields = Record<string, unknown>;

type Bindings = LogFields;

const levelRank: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	fatal: 50,
};

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
const minimumLevel = levelRank[configuredLevel] ? configuredLevel : 'info';
const sensitiveKey = /(authorization|cookie|token|secret|password|api[-_]?key|private[-_]?key)/i;
const sensitiveValue = /(?:Bearer\s+[A-Za-z0-9._~+/=-]+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+)/gi;
const MAX_STRING_LENGTH = 2_000;

function sanitizeText(value: string) {
	const redacted = value.replace(sensitiveValue, '[REDACTED]');
	return redacted.length > MAX_STRING_LENGTH ? `${redacted.slice(0, MAX_STRING_LENGTH)}…` : redacted;
}

function serializeError(error: Error) {
	return {
		name: error.name,
		message: sanitizeText(error.message),
		...(error.stack ? { stack: sanitizeText(error.stack) } : {}),
		...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}),
		...('status' in error && typeof error.status === 'number' ? { status: error.status } : {}),
	};
}

function sanitize(value: unknown, key?: string, depth = 0): unknown {
	if (key && sensitiveKey.test(key)) return '[REDACTED]';
	if (value instanceof Error) return serializeError(value);
	if (typeof value === 'string') {
		return sanitizeText(value);
	}
	if (value === null || typeof value !== 'object' || depth > 5) return value;
	if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, undefined, depth + 1));

	const result: Record<string, unknown> = {};
	for (const [entryKey, entryValue] of Object.entries(value)) {
		result[entryKey] = sanitize(entryValue, entryKey, depth + 1);
	}
	return result;
}

function requestBindings(): LogFields {
	const context = getRequestContext();
	return {
		...(context?.requestId ? { requestId: context.requestId } : {}),
		...(context?.userId ? { userId: context.userId } : {}),
		...(context?.login ? { githubLogin: context.login } : {}),
	};
}

export type Logger = {
	child(bindings: Bindings): Logger;
	debug(event: string, fields?: LogFields): void;
	info(event: string, fields?: LogFields): void;
	warn(event: string, fields?: LogFields): void;
	error(event: string, fields?: LogFields): void;
	fatal(event: string, fields?: LogFields): void;
};

function createLogger(bindings: Bindings = {}): Logger {
	const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
		if (levelRank[level] < levelRank[minimumLevel]) return;

		const payload = {
			timestamp: new Date().toISOString(),
			service: 'oas-website',
			environment: process.env.NODE_ENV || 'development',
			pid: process.pid,
			...(sanitize(bindings) as Bindings),
			...(sanitize(fields) as Bindings),
			...requestBindings(),
			level,
			event,
		};

		try {
			process.stdout.write(`${JSON.stringify(payload)}\n`);
		} catch {
			// Logging must never change the outcome of the request being logged.
		}
	};

	return {
		child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
		debug: (event, fields) => write('debug', event, fields),
		info: (event, fields) => write('info', event, fields),
		warn: (event, fields) => write('warn', event, fields),
		error: (event, fields) => write('error', event, fields),
		fatal: (event, fields) => write('fatal', event, fields),
	};
}

export const logger = createLogger();

