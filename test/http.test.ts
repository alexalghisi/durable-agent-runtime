import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { retroFacilitator } from "../src/model/facilitator.ts";
import { ScriptedModel } from "../src/model/scripted.ts";
import { InMemoryRunStore } from "../src/runtime/runStore.ts";
import type { RunService } from "../src/runtime/runService.ts";
import { InMemoryBoardStore } from "../src/tools/boardStores.ts";
import { buildApp } from "../src/http/app.ts";
import { ManualClock, executorFor, serviceFor } from "./helpers.ts";

let app: FastifyInstance;
let service: RunService;

beforeEach(() => {
    const clock = new ManualClock();
    const runs = new InMemoryRunStore();
    const boards = new InMemoryBoardStore();
    service = serviceFor(runs, executorFor(runs, boards, new ScriptedModel(retroFacilitator), clock), clock);
    app = buildApp(service, boards);
});

afterEach(async () => {
    await app.close();
});

describe("HTTP API", () => {
    it("runs an agent on a board and exposes its result and trace", async () => {
        await app.inject({ method: "POST", url: "/boards/b1/stickies", payload: { id: "n1", text: "Deploys need a rollback plan" } });

        const started = await app.inject({ method: "POST", url: "/boards/b1/runs", payload: { goal: "Cluster the notes" } });
        expect(started.statusCode).toBe(202);
        const { runId } = started.json<{ runId: string }>();
        await service.drain();

        const run = await app.inject({ method: "GET", url: `/runs/${runId}` });
        expect(run.json()).toMatchObject({ status: "completed", boardId: "b1" });
        expect(run.json()).not.toHaveProperty("messages");

        const trace = await app.inject({ method: "GET", url: `/runs/${runId}/trace` });
        expect(trace.json<{ spans: { name: string }[] }>().spans.map((span) => span.name)).toContain("tool.group_stickies");

        const board = await app.inject({ method: "GET", url: "/boards/b1/stickies" });
        expect(board.json()).toContainEqual({ id: "n1", text: "Deploys need a rollback plan", color: "yellow", group: "Release process" });
    });

    it("escapes user content in the trace view", async () => {
        const started = await app.inject({ method: "POST", url: "/boards/b2/runs", payload: { goal: "<script>alert(1)</script>" } });
        await service.drain();
        const view = await app.inject({ method: "GET", url: `/runs/${started.json<{ runId: string }>().runId}/view` });
        expect(view.headers["content-type"]).toContain("text/html");
        expect(view.body).not.toContain("<script>alert(1)</script>");
        expect(view.body).toContain("&#60;script&#62;");
    });

    it("validates request bodies", async () => {
        const response = await app.inject({ method: "POST", url: "/boards/b1/runs", payload: { goal: "" } });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: { code: "invalid_request" } });
    });

    it("returns 404 for unknown runs", async () => {
        const response = await app.inject({ method: "GET", url: "/runs/run_missing" });
        expect(response.statusCode).toBe(404);
    });
});
