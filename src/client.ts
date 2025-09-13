import { input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

const mcp = new Client(
  {
    name: "test-client",
    version: "1.0.0",
  },
  {
    capabilities: {
      sampling: {},
    },
  },
);

const transport = new StdioClientTransport({
  command: "node",
  args: ["build/server.js"],
  stderr: "ignore",
});

async function main() {
  await mcp.connect(transport);

  const [{ tools }, { resources }, { prompts }, { resourceTemplates }] =
    await Promise.all([
      mcp.listTools(),
      mcp.listResources(),
      mcp.listPrompts(),
      mcp.listResourceTemplates(),
    ]);

  console.log("You are connected");

  while (true) {
    const option = await select({
      message: "What would you like to do?",
      choices: ["Query", "Tools", "Resources", "Prompts"],
    });

    switch (option) {
      case "Query":
        break;
      case "Tools":
        const toolName = await select({
          message: "Select a tool",
          choices: tools.map((tool) => ({
            name: tool.annotations?.title || tool.name,
            value: tool.name,
            description: tool.description,
          })),
        });
        const tool = tools.find((t) => t.name === toolName);
        if (tool == null) {
          console.error("Tool not found");
        } else {
          await handleTool(tool);
        }
        // console.log(toolName);
        break;
      case "Resources":
        break;
      case "Prompts":
        break;
    }
  }
}

async function handleTool(tool: Tool) {
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    tool.inputSchema.properties ?? {},
  )) {
    args[key] = await input({
      message: `Enter value for ${key} (${(value as { type: string }).type}):`,
    });
  }
  const res = await mcp.callTool({ name: tool.name, arguments: args });

  console.log((res.content as [{ text: string }])[0].text);
}

main();
