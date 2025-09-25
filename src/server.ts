import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  CreateMessageResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import z from "zod";
import fs from "node:fs/promises";
function createMcpServer() {
  const server = new McpServer({
    name: "test",
    version: "0.1",
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  });

  server.tool(
    "create-user",
    "Create a new user in the database",
    {
      name: z.string(),
      email: z.string(),
      address: z.string(),
      phone: z.string(),
    },
    {
      title: "Create User",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async (params) => {
      try {
        const id = await createUser(params);
        return {
          content: [
            {
              type: "text",
              text: `User ${id} created successfully`,
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: "failed to save user",
            },
          ],
        };
      }
    },
  );

  server.resource(
    "users",
    "users://all",
    {
      description: "Get all users data from the database",
      title: "Users",
      mimeType: "application/json",
    },
    async (uri) => {
      const users = await import("./data/users.json", {
        with: { type: "json" },
      }).then((m) => m.default);

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(users),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.resource(
    "user-details",
    new ResourceTemplate("users://{userId}/profile", {
      list: undefined,
    }),
    {
      description: "Get a user's details from the database",
      title: "Users",
      mimeType: "application/json",
    },
    async (uri, { userId }) => {
      const users = await import("./data/users.json", {
        with: { type: "json" },
      }).then((m) => m.default);
      const user = users.find((u) => u.id === parseInt(userId as string));

      if (user === null) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ error: `User ${userId} not found` }),
              mimeType: "application/json",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(user),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.prompt(
    "generate-fake-user",
    "Generate a fake user based on a given name",
    {
      name: z.string(),
    },
    ({ name }) => {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Generate a fake user with the name ${name}. The user should have a realistic email, address, and phone number.`,
            },
          },
        ],
      };
    },
  );

  server.tool(
    "create-random-user",
    "Create a random user with fake data",
    {
      title: "Create random user",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    async () => {
      const res = await server.server.request(
        {
          method: "sampling/createMessage",
          params: {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: 'Generate fake user data. The user should have a realistic email, address, and phone number. Return this data as a JSON object with no other text or formatter so it can be used with JSON.parse\nExample: {"id": 3,"name": "Charlie Brown","email": "charlie@test.com","address": "123 Main St, Omaha, NE","phone": "555-8765"}',
                },
              },
            ],
            maxTokens: 1024,
          },
        },
        CreateMessageResultSchema,
      );

      if (res.content.type !== "text") {
        return {
          content: [{ type: "text", text: "Failed to generate user data" }],
        };
      }

      try {
        const fakeUser = JSON.parse(
          res.content.text
            .trim()
            .replace(/^```json/, "")
            .replace(/```$/, ""),
        );
        const id = await createUser(fakeUser);
        return {
          content: [{ type: "text", text: `User ${id} created successfully` }],
        };
      } catch {
        return {
          content: [{ type: "text", text: "Failed to parse user data" }],
        };
      }
    },
  );

  return server;
}

async function createUser(user: {
  name: string;
  email: string;
  address: string;
  phone: string;
}) {
  const users = await import("./data/users.json", {
    with: { type: "json" },
  }).then((m) => m.default);

  const id = users.length + 1;

  users.push({ id, ...user });

  fs.writeFile("./src/data/users.json", JSON.stringify(users, null, 2));

  return id;
}
// HTTP server with session-based Streamable HTTP transport
const app = express();
app.use(express.json());

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
      // enableDnsRebindingProtection: true,
      // allowedHosts: ["127.0.0.1"],
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided",
      },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req as any, res as any, req.body);
});

const handleSessionRequest = async (req: any, res: any) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;
app.listen(PORT, () => {
  console.log(`MCP HTTP server listening on port ${PORT}`);
});
