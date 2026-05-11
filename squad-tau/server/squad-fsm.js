const SQUAD_STATES = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
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

    isIdle() {
        return this.state === SQUAD_STATES.IDLE;
    }

    isActive() {
        return this.state === SQUAD_STATES.ACTIVE;
    }
}

export default SquadFSM;
