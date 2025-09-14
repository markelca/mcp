import "dotenv/config";
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateText, jsonSchema, ToolSet } from "ai";
import {
  CreateMessageRequestSchema,
  Prompt,
  PromptMessage,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { OPENROUTER_MODEL_URI, REASONING_EFFORT } from "./constants";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

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

  mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const texts: string[] = [];
    for (const message of request.params.messages) {
      const text = await handleServerMessagePrompt(message);
      if (text != null) {
        texts.push(text);
      }
    }

    return {
      role: "user",
      model: OPENROUTER_MODEL_URI,
      stopReason: "endTurn",
      content: {
        type: "text",
        text: texts.join("\n"),
      },
    };
  });

  console.log("You are connected");

  while (true) {
    const option = await select({
      message: "What would you like to do?",
      choices: ["Query", "Tools", "Resources", "Prompts"],
    });

    switch (option) {
      case "Query":
        await handleQuery(tools);
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
        break;
      case "Resources":
        const resourceUri = await select({
          message: "Select a resource",
          choices: [
            ...resources.map((resource) => ({
              name: resource.name,
              value: resource.uri,
              description: resource.description,
            })),
            ...resourceTemplates.map((template) => ({
              name: template.name,
              value: template.uriTemplate,
              description: template.description,
            })),
          ],
        });
        const uri =
          resources.find((r) => r.uri === resourceUri)?.uri ??
          resourceTemplates.find((rt) => rt.uriTemplate === resourceUri)
            ?.uriTemplate;
        if (uri == null) {
          console.error("Resource not found");
        } else {
          await handleResource(uri);
        }
        break;
      case "Prompts":
        const promptName = await select({
          message: "Select a prompt",
          choices: prompts.map((prompt) => ({
            name: prompt.name,
            value: prompt.name,
            description: prompt.description,
          })),
        });
        const prompt = prompts.find((p) => p.name === promptName);
        if (prompt == null) {
          console.error("Prompt not found.");
        } else {
          await handlePrompt(prompt);
        }
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

async function handleResource(uri: string) {
  let finalUri = uri;
  const paramMatches = uri.match(/{([^}]+)}/g);

  if (paramMatches != null) {
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.replace("{", "").replace("}", "");
      const paramValue = await input({
        message: `Enter value for ${paramName}:`,
      });
      finalUri = finalUri.replace(paramMatch, paramValue);
    }
  }
  const res = await mcp.readResource({
    uri: finalUri,
  });
  console.log(
    JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2),
  );
}

async function handlePrompt(prompt: Prompt) {
  const args: Record<string, string> = {};
  for (const arg of prompt.arguments ?? []) {
    args[arg.name] = await input({
      message: `Enter value for ${arg.name}:`,
    });
  }

  const res = await mcp.getPrompt({
    name: prompt.name,
    arguments: args,
  });

  for (const msg of res.messages) {
    console.log(await handleServerMessagePrompt(msg));
  }
}

async function handleServerMessagePrompt(msg: PromptMessage) {
  if (msg.content.type != "text") {
    return;
  }

  console.log(msg.content.text);

  const run = await confirm({
    message: "Would you like to run the above prompt?",
    default: true,
  });

  if (!run) {
    return;
  }

  const { text } = await generateText({
    model: openrouter.chat(OPENROUTER_MODEL_URI, {
      provider: {
        require_parameters: true,
      },
      reasoning: {
        effort: "minimal" as "high" | "medium" | "low", // The minimal option only exists for this model, so this type cast is used to satisfy the linter
      },
    }),
    prompt: msg.content.text,
  });

  return text;
}

async function handleQuery(tools: Tool[]) {
  const query = await input({ message: "Enter your query" });

  const parsedTools = tools.reduce((obj, t) => {
    return {
      ...obj,
      [t.name]: {
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema),
        execute: async (args: Record<string, any>) => {
          return await mcp.callTool({
            name: t.name,
            arguments: args,
          });
        },
      },
    };
  }, {});

  const { text, toolResults } = await generateText({
    model: openrouter.chat(OPENROUTER_MODEL_URI, {
      provider: {
        require_parameters: true,
      },
      reasoning: {
        effort: REASONING_EFFORT,
      },
    }),
    prompt: query,
    tools: parsedTools as ToolSet,
  });

  if (text) {
    console.log(text);
  } else if (toolResults) {
    for (const result of toolResults) {
      for (const content of result?.output?.content || []) {
        console.log(content?.text);
      }
    }
  } else {
    console.log("No text generated");
  }
}

main();
