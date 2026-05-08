export default class SquadFSM {
    constructor() {
        this.state = 'idle';
        this.originalTask = '';
    }

    isActive() {
        return this.state !== 'idle';
    }

    isRevising() {
        return this.state === 'revising';
    }

    toActive() {
        this.state = 'active';
    }

    toRevising() {
        this.state = 'revising';
    }

    toIdle() {
        this.state = 'idle';
    }
}
