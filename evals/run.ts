import { loadConfig } from "../src/config.ts";
import { createContainer } from "../src/container.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";

interface Result {
    scenario: Scenario;
    passed: boolean;
    detail: string;
    steps: number;
    tokens: number;
}

const container = await createContainer({ ...loadConfig(), mongoUrl: undefined });

async function evaluate(scenario: Scenario, index: number): Promise<Result> {
    const boardId = `eval-${index}`;
    for (const sticky of scenario.board) {
        await container.boards.upsert(boardId, sticky);
    }
    const { runId } = await container.runs.start(boardId, scenario.goal);
    await container.runs.drain();
    const run = await container.runs.get(runId);
    const stickies = await container.boards.list(boardId);
    const tokens = run.usage.inputTokens + run.usage.outputTokens;
    const failures: string[] = [];
    if (run.status !== "completed") {
        failures.push(`run ${run.status}${run.error ? `: ${run.error}` : ""}`);
    }
    if (run.steps > scenario.maxSteps) {
        failures.push(`${run.steps} steps > ${scenario.maxSteps}`);
    }
    for (const [id, group] of Object.entries(scenario.expectGroups)) {
        const actual = stickies.find((sticky) => sticky.id === id)?.group;
        if (actual !== group) {
            failures.push(`${id} in "${actual ?? "none"}", expected "${group}"`);
        }
    }
    const hasAction = stickies.some((sticky) => /^action/i.test(sticky.text));
    if (hasAction !== scenario.expectActionItem) {
        failures.push(hasAction ? "unexpected action item" : "missing action item");
    }
    return { scenario, passed: failures.length === 0, detail: failures.join("; ") || "ok", steps: run.steps, tokens };
}

const results: Result[] = [];
for (const [index, scenario] of SCENARIOS.entries()) {
    results.push(await evaluate(scenario, index));
}
await container.close();

for (const { scenario, passed, detail, steps, tokens } of results) {
    const mark = passed ? "\u001b[32m✔\u001b[0m" : "\u001b[31m✘\u001b[0m";
    console.log(`${mark} ${scenario.name.padEnd(44)} ${String(steps).padStart(2)} steps ${String(tokens).padStart(5)} tokens  ${detail}`);
}
const passedCount = results.filter((result) => result.passed).length;
console.log(`\n${passedCount}/${results.length} scenarios passed`);
process.exitCode = passedCount === results.length ? 0 : 1;
