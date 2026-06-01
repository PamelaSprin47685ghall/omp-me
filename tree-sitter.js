import { checkSyntax, isFileEditTool, extractFilePath, hasSyntaxCheckMarker, formatSyntaxDiagnostics, appendSyntaxDiagnostics } from 'engine/tree-sitter';

export { checkSyntax, isFileEditTool, extractFilePath, hasSyntaxCheckMarker, formatSyntaxDiagnostics, appendSyntaxDiagnostics };

export function supportsSyntaxDiagnosticsTool(toolName) {
  return isFileEditTool(toolName);
}
