import type { Span } from "../domain/types.ts";

export type Clock = () => number;

export async function traced<T>(
    spans: Span[],
    name: string,
    clock: Clock,
    action: () => Promise<T>,
    attributes: (result: T) => Span["attributes"] = () => ({}),
): Promise<T> {
    const started = clock();
    try {
        const result = await action();
        spans.push({ name, startedAt: new Date(started).toISOString(), durationMs: clock() - started, attributes: attributes(result) });
        return result;
    } catch (error) {
        spans.push({
            name,
            startedAt: new Date(started).toISOString(),
            durationMs: clock() - started,
            attributes: { error: error instanceof Error ? error.message : String(error) },
        });
        throw error;
    }
}
