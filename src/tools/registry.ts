import { z, type ZodTypeAny } from "zod";

import type { ToolSpec } from "../model/ModelClient.ts";

export interface ToolContext {
    boardId: string;
    toolCallId: string;
}

export interface ToolDefinition<Schema extends ZodTypeAny> {
    name: string;
    description: string;
    schema: Schema;
    execute(args: z.infer<Schema>, context: ToolContext): Promise<unknown>;
}

type AnyTool = ToolDefinition<ZodTypeAny>;

export class ToolInputError extends Error {}

export class ToolRegistry {
    private readonly tools = new Map<string, AnyTool>();

    register<Schema extends ZodTypeAny>(tool: ToolDefinition<Schema>): this {
        this.tools.set(tool.name, tool as unknown as AnyTool);
        return this;
    }

    specs(): ToolSpec[] {
        return [...this.tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: jsonSchema(tool.schema),
        }));
    }

    async execute(name: string, args: unknown, context: ToolContext): Promise<unknown> {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new ToolInputError(`Unknown tool "${name}"`);
        }
        const parsed = tool.schema.safeParse(args);
        if (!parsed.success) {
            throw new ToolInputError(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
        }
        return tool.execute(parsed.data, context);
    }
}

function jsonSchema(schema: ZodTypeAny): Record<string, unknown> {
    if (schema instanceof z.ZodObject) {
        const shape = schema.shape as Record<string, ZodTypeAny>;
        const required = Object.entries(shape)
            .filter(([, field]) => !field.isOptional())
            .map(([key]) => key);
        return {
            type: "object",
            properties: Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, jsonSchema(field)])),
            required,
            additionalProperties: false,
        };
    }
    if (schema instanceof z.ZodOptional) {
        const inner = jsonSchema(schema.unwrap() as ZodTypeAny);
        return schema.description ? { ...inner, description: schema.description } : inner;
    }
    if (schema instanceof z.ZodEnum) {
        return { type: "string", enum: schema.options as string[], description: schema.description };
    }
    if (schema instanceof z.ZodArray) {
        return { type: "array", items: jsonSchema(schema.element as ZodTypeAny), description: schema.description };
    }
    if (schema instanceof z.ZodNumber) {
        return { type: "number", description: schema.description };
    }
    return { type: "string", description: schema.description };
}
