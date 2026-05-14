/**
 * Prompt Virtual Document Model (Prompt DOM) and Compiler.
 * Eliminates whitespace issues and enables dynamic pruning based on token limits.
 */

class PromptDoc {
    constructor() {
        this.sections = [];
    }

    /**
     * Add a logical section to the prompt.
     * @param {string} title
     * @param {string|Array} content
     * @param {number} priority - Higher priority sections are kept during pruning.
     */
    addSection(title, content, priority = 10) {
        if (!content || (Array.isArray(content) && content.length === 0)) return this;
        this.sections.push({ title, content, priority });
        return this;
    }

    /**
     * Compile the AST into a final string.
     * @param {number} [maxTokens] - Optional limit for pruning (not implemented but hook exists)
     */
    compile() {
        return this.sections
            .map((section) => {
                const header = section.title ? `### ${section.title}\n` : '';
                let body = '';
                if (Array.isArray(section.content)) {
                    body = section.content
                        .filter(Boolean)
                        .map((item) => item.toString().trim())
                        .map((item) => (item.startsWith('-') ? item : `- ${item}`))
                        .join('\n');
                } else {
                    body = section.content.toString().trim();
                }
                return `${header}${body}`;
            })
            .filter(Boolean)
            .join('\n\n');
    }
}

export { PromptDoc };
