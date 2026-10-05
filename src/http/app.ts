import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { Run } from "../domain/types.ts";
import { STICKY_COLORS, type BoardStore } from "../tools/board.ts";
import { RunNotFoundError, type RunService } from "../runtime/runService.ts";
import { renderTrace } from "./traceView.ts";

const startRun = z.object({ goal: z.string().min(3).max(2000) });
const newSticky = z.object({ id: z.string().min(1).max(64), text: z.string().min(1).max(280), color: z.enum(STICKY_COLORS).default("yellow") });

function summary(run: Run) {
    const { messages, lease, ...rest } = run;
    return { ...rest, messageCount: messages.length };
}

export function buildApp(runs: RunService, boards: BoardStore, logger = false): FastifyInstance {
    const app = Fastify({ logger });

    app.setErrorHandler((error, _request, reply) => {
        if (error instanceof RunNotFoundError) {
            return reply.status(404).send({ error: { code: "run_not_found", message: error.message } });
        }
        if (error instanceof z.ZodError) {
            return reply.status(422).send({ error: { code: "invalid_request", message: error.issues.map((issue) => issue.message).join("; ") } });
        }
        app.log.error(error);
        return reply.status(500).send({ error: { code: "internal", message: "Unexpected error" } });
    });

    app.get("/healthz", async () => ({ status: "ok" }));

    app.post<{ Params: { boardId: string } }>("/boards/:boardId/stickies", async (request, reply) => {
        const sticky = newSticky.parse(request.body);
        await boards.upsert(request.params.boardId, sticky);
        return reply.status(201).send(sticky);
    });

    app.get<{ Params: { boardId: string } }>("/boards/:boardId/stickies", async (request) => boards.list(request.params.boardId));

    app.post<{ Params: { boardId: string } }>("/boards/:boardId/runs", async (request, reply) => {
        const { goal } = startRun.parse(request.body);
        const run = await runs.start(request.params.boardId, goal);
        return reply.status(202).send(summary(run));
    });

    app.get<{ Params: { runId: string } }>("/runs/:runId", async (request) => summary(await runs.get(request.params.runId)));

    app.get<{ Params: { runId: string } }>("/runs/:runId/trace", async (request) => {
        const run = await runs.get(request.params.runId);
        return { runId: run.runId, status: run.status, usage: run.usage, spans: run.spans, messages: run.messages };
    });

    app.get<{ Params: { runId: string } }>("/runs/:runId/view", async (request, reply) => {
        const run = await runs.get(request.params.runId);
        return reply.type("text/html").send(renderTrace(run, await boards.list(run.boardId)));
    });

    app.post<{ Params: { runId: string } }>("/runs/:runId/resume", async (request, reply) => {
        const run = await runs.resume(request.params.runId);
        return reply.status(202).send(summary(run));
    });

    return app;
}
