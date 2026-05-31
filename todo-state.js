export function cloneTask(task) {
    return task.notes?.length ? { ...task, notes: [...task.notes] } : { ...task };
}

export function clonePhases(phases) {
    return phases.map((phase) => ({ name: phase.name, tasks: (phase.tasks || []).map(cloneTask) }));
}

export function getLatestTodoPhasesFromEntries(entries) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type === 'custom' && entry.customType === 'user_todo_edit' && Array.isArray(entry.data?.phases)) {
            return clonePhases(entry.data.phases);
        }
        if (entry?.type !== 'message') continue;
        const message = entry.message;
        if (message?.role !== 'toolResult' || message?.toolName !== 'todo_write' || message?.isError) continue;
        if (!Array.isArray(message?.details?.phases)) continue;
        return clonePhases(message.details.phases);
    }
    return [];
}
