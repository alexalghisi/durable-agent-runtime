import type { Message, Run, ToolCall } from "../domain/types.ts";
import { compact, type Summarize } from "../memory/context.ts";
import type { ModelClient } from "../model/ModelClient.ts";
import { traced, type Clock } from "../observability/tracer.ts";
import { ToolInputError, type ToolRegistry } from "../tools/registry.ts";
import type { RunStore } from "./runStore.ts";

export interface ExecutorOptions {
    owner: string;
    maxSteps: number;
    leaseMs: number;
    contextBudget: number;
    keepRecentTurns: number;
    clock: Clock;
}

export class LeaseUnavailableError extends Error {}

function pendingToolCalls(messages: Message[]): ToolCall[] {
    const lastAssistant = messages.findLastIndex((message) => message.role === "assistant");
    const assistant = messages[lastAssistant];
    if (!assistant?.toolCalls?.length) {
        return [];
    }
    const answered = new Set(messages.slice(lastAssistant + 1).map((message) => message.toolCallId));
    return assistant.toolCalls.filter((call) => !answered.has(call.id));
}

export class AgentExecutor {
    private readonly store: RunStore;
    private readonly model: ModelClient;
    private readonly tools: ToolRegistry;
    private readonly summarize: Summarize;
    private readonly options: ExecutorOptions;

    constructor(store: RunStore, model: ModelClient, tools: ToolRegistry, summarize: Summarize, options: ExecutorOptions) {
        this.store = store;
        this.model = model;
        this.tools = tools;
        this.summarize = summarize;
        this.options = options;
    }

    async execute(runId: string): Promise<Run> {
        const { owner, leaseMs, clock } = this.options;
        const run = await this.store.claim(runId, owner, clock(), leaseMs);
        if (!run) {
            throw new LeaseUnavailableError(`Run ${runId} is finished or owned by another worker`);
        }
        try {
            await this.drive(run);
        } catch (error) {
            run.status = "failed";
            run.error = error instanceof Error ? error.message : String(error);
            await this.checkpoint(run);
        } finally {
            await this.store.release(runId, owner);
        }
        return run;
    }

    private async checkpoint(run: Run): Promise<void> {
        run.updatedAt = new Date(this.options.clock()).toISOString();
        if (run.lease) {
            run.lease.expiresAt = this.options.clock() + this.options.leaseMs;
        }
        await this.store.save(run);
    }

    private async drive(run: Run): Promise<void> {
        while (run.status === "running") {
            for (const call of pendingToolCalls(run.messages)) {
                run.messages.push(await this.runTool(run, call));
                await this.checkpoint(run);
            }
            if (run.steps >= this.options.maxSteps) {
                run.status = "failed";
                run.error = `Stopped after ${this.options.maxSteps} model steps`;
                break;
            }
            run.messages = await traced(
                run.spans,
                "context.compact",
                this.options.clock,
                () => compact(run.messages, this.options.contextBudget, this.options.keepRecentTurns, this.summarize),
                (messages) => ({ messages: messages.length }),
            );
            const response = await traced(
                run.spans,
                "model.complete",
                this.options.clock,
                () => this.model.complete(run.messages, this.tools.specs()),
                (result) => ({
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    toolCalls: result.toolCalls.length,
                }),
            );
            run.steps += 1;
            run.usage.inputTokens += response.usage.inputTokens;
            run.usage.outputTokens += response.usage.outputTokens;
            run.messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
            if (response.toolCalls.length === 0) {
                run.status = "completed";
                run.output = response.content;
            }
            await this.checkpoint(run);
        }
        await this.checkpoint(run);
    }

    private async runTool(run: Run, call: ToolCall): Promise<Message> {
        try {
            const result = await traced(
                run.spans,
                `tool.${call.name}`,
                this.options.clock,
                () => this.tools.execute(call.name, call.arguments, { boardId: run.boardId, toolCallId: call.id }),
                () => ({ toolCallId: call.id }),
            );
            return { role: "tool", toolCallId: call.id, content: JSON.stringify(result) };
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const prefix = error instanceof ToolInputError ? "Invalid arguments" : "Tool failed";
            return { role: "tool", toolCallId: call.id, content: `${prefix}: ${reason}` };
        }
    }
}
