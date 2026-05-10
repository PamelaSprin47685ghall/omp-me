const SquadFSM = require('./squad-fsm.js');
console.log('Type:', typeof SquadFSM);
const fsm = new SquadFSM();
console.log('isIdle:', fsm.isIdle());
