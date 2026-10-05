import type { Run } from "../domain/types.ts";
import type { Sticky } from "../tools/board.ts";

const COLORS: Record<Sticky["color"], string> = { yellow: "#ffe58a", pink: "#ffc2d6", blue: "#bfe3ff", green: "#c8f0c0" };

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function timeline(run: Run): string {
    const longest = Math.max(1, ...run.spans.map((span) => span.durationMs));
    return run.spans
        .map((span) => {
            const width = Math.max(2, Math.round((span.durationMs / longest) * 100));
            const details = Object.entries(span.attributes)
                .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(String(value))}`)
                .join(" · ");
            const kind = span.name.split(".")[0] ?? "other";
            return `<li class="span ${escapeHtml(kind)}"><span class="name">${escapeHtml(span.name)}</span><span class="bar" style="width:${width}%"></span><span class="meta">${span.durationMs} ms ${details}</span></li>`;
        })
        .join("");
}

function board(stickies: Sticky[]): string {
    const groups = new Map<string, Sticky[]>();
    for (const sticky of stickies) {
        const key = sticky.group ?? "Ungrouped";
        groups.set(key, [...(groups.get(key) ?? []), sticky]);
    }
    return [...groups.entries()]
        .map(
            ([group, items]) =>
                `<section class="cluster"><h3>${escapeHtml(group)}</h3><div class="notes">${items
                    .map((sticky) => `<div class="note" style="background:${COLORS[sticky.color]}">${escapeHtml(sticky.text)}</div>`)
                    .join("")}</div></section>`,
        )
        .join("");
}

export function renderTrace(run: Run, stickies: Sticky[]): string {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(run.runId)}</title><style>
body{margin:0;font-family:Inter,Segoe UI,system-ui,sans-serif;background:#f5f6fa;color:#1b1f2a}
header{padding:20px 28px;background:#fff;border-bottom:1px solid #e4e7ee;display:flex;gap:24px;align-items:baseline;flex-wrap:wrap}
header h1{font-size:18px;margin:0}.pill{padding:3px 10px;border-radius:99px;font-size:12px;font-weight:700;background:#e8f7ec;color:#16723a}
.pill.running,.pill.queued{background:#fff4d6;color:#8a5a00}.pill.failed{background:#fde8e8;color:#a61b1b}
.stat{color:#5c6475;font-size:13px}main{display:grid;grid-template-columns:1.1fr 1fr;gap:24px;padding:24px 28px}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:#5c6475;margin:0 0 12px}
ol{list-style:none;margin:0;padding:0;display:grid;gap:8px}.span{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;background:#fff;border:1px solid #e4e7ee;border-radius:10px;padding:10px 12px;font-size:13px}
.span .name{font-weight:600}.bar{height:8px;border-radius:4px;align-self:center;background:#6c63ff}.span.tool .bar{background:#13a37f}.span.context .bar{background:#c2c7d3}
.meta{grid-column:2;color:#5c6475;font-size:12px}.cluster{background:#fff;border:1px solid #e4e7ee;border-radius:12px;padding:12px 14px;margin-bottom:12px}
.cluster h3{margin:0 0 10px;font-size:14px}.notes{display:flex;flex-wrap:wrap;gap:8px}.note{width:150px;min-height:70px;padding:10px;border-radius:6px;font-size:13px;box-shadow:0 2px 4px rgb(0 0 0/8%)}
@media (max-width:760px){main{grid-template-columns:1fr}}
</style></head><body><header><h1>${escapeHtml(run.goal)}</h1><span class="pill ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
<span class="stat">${run.steps} model steps · ${run.usage.inputTokens + run.usage.outputTokens} tokens · ${run.spans.length} spans</span></header>
<main><div><h2>Trace</h2><ol>${timeline(run)}</ol></div><div><h2>Board</h2>${board(stickies)}</div></main></body></html>`;
}
