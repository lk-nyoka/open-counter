// Lambda entry (API Gateway HTTP API, payload v2). Bridges to the same MCP server
// using the SDK's Web Standard transport so no Node http objects are needed.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import rawSpecs from "./specs.generated.js";
import { withEnv } from "./registry.js";
import { buildServer } from "./server.js";
import { getDeps } from "./deps.js";

// Specs are compiled in (npm run gen:specs) because the Lambda bundle has no specs/ directory.
const specs = new Map<string, BusinessSpec>(rawSpecs.map((r) => withEnv(BusinessSpecSchema.parse(r))).map((x) => [x.slug, x]));

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const slug = event.pathParameters?.slug ?? "";
  const spec = specs.get(slug);
  if (!spec) return { statusCode: 404, body: JSON.stringify({ error: "unknown business" }) };

  const body = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString() : event.body;
  const url = `https://${event.requestContext.domainName}${event.rawPath}`;
  const request = new Request(url, {
    method: event.requestContext.http.method,
    headers: event.headers as Record<string, string>,
    body: ["GET", "HEAD"].includes(event.requestContext.http.method) ? undefined : body,
  });

  const server = buildServer(spec, await getDeps());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => (headers[k] = v));
  return { statusCode: response.status, headers, body: await response.text() };
};
