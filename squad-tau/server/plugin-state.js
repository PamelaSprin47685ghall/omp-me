let currentRun = null;
export function setCurrentRun(run) {
    currentRun = run;
}
export function getCurrentRun() {
    return currentRun;
}
export function clearCurrentRun() {
    currentRun = null;
}
