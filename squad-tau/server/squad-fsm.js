const SQUAD_STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    REVISING: 'revising',
});

class SquadFSM {
    constructor() {
        this.state = SQUAD_STATES.IDLE;
    }

    activate() {
        if (this.state !== SQUAD_STATES.IDLE) {
            throw new Error(`Cannot activate from state: ${this.state}`);
        }
        this.state = SQUAD_STATES.ACTIVE;
    }

    deactivate() {
        this.state = SQUAD_STATES.IDLE;
    }

    revise() {
        if (this.state !== SQUAD_STATES.ACTIVE) {
            throw new Error(`Cannot revise from state: ${this.state}`);
        }
        this.state = SQUAD_STATES.REVISING;
    }

    reactivate() {
        if (this.state !== SQUAD_STATES.REVISING) {
            throw new Error(`Cannot reactivate from state: ${this.state}`);
        }
        this.state = SQUAD_STATES.ACTIVE;
    }

    isIdle() {
        return this.state === SQUAD_STATES.IDLE;
    }

    isActive() {
        return this.state === SQUAD_STATES.ACTIVE;
    }

    isRevising() {
        return this.state === SQUAD_STATES.REVISING;
    }
}

export default SquadFSM;
