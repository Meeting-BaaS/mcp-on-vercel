import { TOOL_DOC_URLS } from "../docs-mapping";

/**
 * Enhances the tool's description with a link to its documentation
 * 
 * @param toolName The name of the tool to get documentation for
 * @param description The original tool description
 * @returns An enhanced description with documentation link if available
 */
export function enhanceDescriptionWithDocs(
  toolName: string,
  description: string
): string {
  // Get the documentation URL for this tool
  const docUrl = TOOL_DOC_URLS[toolName];
  
  // If we have documentation, enhance the description
  if (docUrl) {
    // Add documentation link to the description
    return `${description}\n\nDocumentation: ${docUrl}`;
  }
  
  // If no documentation found, return the original description
  return description;
}

/**
 * Gets documentation URL for a specific tool
 * 
 * @param toolName The name of the tool
 * @returns The documentation URL, or null if not found
 */
export function getDocUrlForTool(toolName: string): string | null {
  return TOOL_DOC_URLS[toolName] || null;
}

/**
 * Gets documentation URL from the OpenAPI schema for a specific operation
 * (Can be implemented to automatically extract URLs from OpenAPI schema)
 * 
 * @param operationId The OpenAPI operation ID
 * @returns The documentation URL, or null if not found
 */
export async function getDocsFromOpenApi(operationId: string): Promise<string | null> {
  // TODO: Implement fetching from OpenAPI schema
  // This would parse the OpenAPI JSON and extract doc URLs or build them
  
  return null;
} 