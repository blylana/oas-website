export class HttpError extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.code = code;
	}
}

export function toErrorResponse(error: unknown) {
	if (error instanceof HttpError) {
		return {
			status: error.status,
			body: { error: error.code, message: error.message },
		};
	}
	return {
		status: 500,
		body: { error: 'internal_error', message: 'Unexpected server error' },
	};
}
