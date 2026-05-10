/**
 * Extract text content from message content blocks.
 * @param {Object[]} content
 * @returns {string}
 */
export function extractText(content) {
    if (!Array.isArray(content)) return '';
    return content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
}
