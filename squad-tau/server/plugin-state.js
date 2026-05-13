let currentRun = null;
let squadSnapshot = null;

export function setCurrentRun(run) {
    currentRun = run;
}
export function getCurrentRun() {
    return currentRun;
}
export function clearCurrentRun() {
    if (currentRun?._unsubSnapshot) {
        for (const unsub of currentRun._unsubSnapshot) unsub?.();
    }
    currentRun = null;
}

export function setSquadSnapshot(snap) {
    squadSnapshot = snap;
}
export function getSquadSnapshot() {
    return squadSnapshot;
}
export function clearSquadSnapshot() {
    squadSnapshot = null;
}
