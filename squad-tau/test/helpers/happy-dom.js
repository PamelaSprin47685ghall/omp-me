import { Window } from 'happy-dom';

const win = new Window();
globalThis.document = win.document;
globalThis.window = win;
globalThis.navigator = win.navigator;
globalThis.Node = win.Node;
globalThis.Event = win.Event;
globalThis.KeyboardEvent = win.KeyboardEvent;
globalThis.MouseEvent = win.MouseEvent;
globalThis.requestAnimationFrame = (cb) => {
    queueMicrotask(() => cb(Date.now()));
    return 0;
};
globalThis.cancelAnimationFrame = () => {};
