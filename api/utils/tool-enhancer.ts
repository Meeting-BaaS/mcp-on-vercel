import { TOOL_DOC_URLS } from "../docs-mapping";

/**
 * Enhances a tool description with documentation link
 * 
 * @param toolName The name of the tool
 * @param description The original description
 * @returns The enhanced description with documentation link
 */
export function enhanceToolDescription(toolName: string, description: string): string {
  // Get the documentation URL for this tool
  const docUrl = TOOL_DOC_URLS[toolName];
  
  // If documentation exists, enhance the description
  if (docUrl) {
    // Add documentation link to the description
    return `${description}\n\nDocumentation: ${docUrl}`;
  }
  
  // If no documentation found, return original description
  return description;
} 