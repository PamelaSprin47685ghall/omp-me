/**
 * @typedef {Object} FooOptions
 * @property {number} [capacity=100]
 * @property {boolean} [strict=false]
 */

/**
 * @typedef {Object} FooResult
 * @property {boolean} success
 * @property {*} [data]
 * @property {string} [error]
 */

export class Foo {
    #items = [];
    #capacity;
    #strict;

    constructor(options = {}) {
        const { capacity = 100, strict = false } = options;

        if (typeof capacity !== 'number' || capacity <= 0 || !Number.isInteger(capacity)) {
            throw new TypeError('capacity must be a positive integer');
        }
        if (typeof strict !== 'boolean') {
            throw new TypeError('strict must be a boolean');
        }

        this.#capacity = capacity;
        this.#strict = strict;
    }

    add(item) {
        if (this.#strict && item == null) {
            throw new TypeError('null or undefined not allowed in strict mode');
        }
        if (this.#items.length >= this.#capacity) {
            throw new RangeError(`capacity limit ${this.#capacity} reached`);
        }
        this.#items.push(item);
        return this.#items.length - 1;
    }

    get(index) {
        if (typeof index !== 'number' || !Number.isInteger(index)) {
            throw new TypeError('index must be an integer');
        }
        if (index < 0 || index >= this.#items.length) {
            throw new RangeError('index out of bounds');
        }
        return this.#items[index];
    }

    remove(index) {
        if (typeof index !== 'number' || !Number.isInteger(index)) {
            throw new TypeError('index must be an integer');
        }
        if (index < 0 || index >= this.#items.length) {
            throw new RangeError('index out of bounds');
        }
        const removed = this.#items.splice(index, 1)[0];
        return removed;
    }

    size() {
        return this.#items.length;
    }

    clear() {
        this.#items = [];
    }

    getAll() {
        return [...this.#items];
    }

    getStats() {
        return {
            size: this.#items.length,
            capacity: this.#capacity,
            utilization: this.#items.length / this.#capacity,
            strict: this.#strict,
        };
    }
}

export function createFoo(options) {
    return new Foo(options);
}
