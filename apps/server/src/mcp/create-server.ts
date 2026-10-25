import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { IntegrationDeps } from "./actions";
import {
  actionBoardList,
  actionBoardMove,
  actionHobieQueueTask,
  actionMeetingImport,
  actionNotesAppend,
  actionNotesRead,
  actionPanelPostUpdate,
  actionTodoistAddTask,
} from "./actions";

export function createCommandCenterMcp(deps: IntegrationDeps, clientId: string): McpServer {
  const server = new McpServer({ name: "command-center", version: deps.cfg.version }, { capabilities: { tools: {} } });

  server.registerTool(
    "notes_read",
    { description: "Read the dashboard notes markdown file.", inputSchema: {} },
    async () => {
      const result = await actionNotesRead(deps);
      if (result.redacted) {
        return { content: [{ type: "text", text: JSON.stringify({ content: "", redacted: true }) }] };
      }
      return { content: [{ type: "text", text: result.content || "(empty)" }] };
    },
  );

  server.registerTool(
    "notes_append",
    {
      description: "Append a line to notes (tagged with the MCP client id).",
      inputSchema: { text: z.string().describe("Markdown or plain text to append") },
    },
    async ({ text }) => {
      const result = await actionNotesAppend(deps, clientId, text);
      if (result.redacted) {
        return { content: [{ type: "text", text: JSON.stringify({ content: "", redacted: true }) }] };
      }
      return { content: [{ type: "text", text: `Appended. Notes now ${result.content.length} chars.` }] };
    },
  );

  server.registerTool(
    "panel_post_update",
    {
      description: "Post a short update to the Activity panel.",
      inputSchema: {
        panel: z.string().optional().describe("Panel id label (default activity)"),
        markdown: z.string().describe("Update text"),
      },
    },
    async ({ panel, markdown }) => {
      const row = await actionPanelPostUpdate(deps, clientId, panel ?? "activity", markdown);
      return { content: [{ type: "text", text: `Posted update ${row.id}` }] };
    },
  );

  server.registerTool(
    "todoist_add_task",
    {
      description: "Add a task to the owner's Todoist inbox (server token).",
      inputSchema: { content: z.string().describe("Task title / content") },
    },
    async ({ content }) => {
      const task = await actionTodoistAddTask(deps, content);
      return { content: [{ type: "text", text: `Created Todoist task ${task.id}: ${task.content}` }] };
    },
  );

  server.registerTool(
    "board_list",
    { description: "List kanban board cards and column counts.", inputSchema: {} },
    async () => {
      const { cards, counts } = await actionBoardList(deps);
      const lines = cards.map((c) => `${c.column}: ${c.title} (${c.id})`).join("\n");
      return {
        content: [
          {
            type: "text",
            text: lines ? `${lines}\n\ncounts: ${JSON.stringify(counts)}` : `Empty board. counts: ${JSON.stringify(counts)}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "board_move",
    {
      description: "Move a board card to another column.",
      inputSchema: {
        id: z.string(),
        column: z.enum(["Backlog", "Ready for Hobie", "Waiting", "Blocked on me", "Done"]),
        position: z.number().optional(),
      },
    },
    async ({ id, column, position }) => {
      const { card } = await actionBoardMove(deps, clientId, id, column, position);
      return { content: [{ type: "text", text: `Moved to ${card.column} (${card.id})` }] };
    },
  );

  server.registerTool(
    "meeting_import",
    {
      description: "Import a meeting transcript as a sensitive note in the Meetings space (idempotent by Plaud sourceId).",
      inputSchema: {
        sourceId: z.string().describe("Plaud file id for idempotency"),
        title: z.string(),
        recordedAt: z.string().describe("ISO-8601 timestamp"),
        durationSec: z.number().optional(),
        participants: z.array(z.string()).optional(),
        transcript: z.union([
          z.string(),
          z.array(
            z.object({
              speaker: z.string().optional(),
              startSec: z.number().optional(),
              text: z.string(),
            }),
          ),
        ]),
      },
    },
    async (input) => {
      const result = await actionMeetingImport(deps, input as Record<string, unknown>);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              noteId: result.note.id,
              created: result.created,
              summaryStatus: result.summaryStatus,
            }),
          },
        ],
      };
    },
  );

  server.registerTool(
    "hobie_queue_task",
    {
      description: "Queue a task for Hobie (owner assistant).",
      inputSchema: {
        title: z.string(),
        body: z.string().optional(),
        urgent: z.boolean().optional(),
      },
    },
    async ({ title, body, urgent }) => {
      const task = await actionHobieQueueTask(deps, clientId, title, body ?? "", Boolean(urgent));
      return {
        content: [{ type: "text", text: `Queued ${task.id}${task.urgent ? " (urgent)" : ""} at ${task.createdAt}` }],
      };
    },
  );

  return server;
}
