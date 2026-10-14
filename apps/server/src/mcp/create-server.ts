import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import type { IntegrationDeps } from "./actions";
import {
  actionHobieQueueTask,
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
      const { content } = await actionNotesRead(deps);
      return { content: [{ type: "text", text: content || "(empty)" }] };
    },
  );

  server.registerTool(
    "notes_append",
    {
      description: "Append a line to notes (tagged with the MCP client id).",
      inputSchema: { text: z.string().describe("Markdown or plain text to append") },
    },
    async ({ text }) => {
      const { content } = await actionNotesAppend(deps, clientId, text);
      return { content: [{ type: "text", text: `Appended. Notes now ${content.length} chars.` }] };
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
