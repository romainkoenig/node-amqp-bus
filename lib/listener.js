'use strict';

const co = require('co');
const EventEmitter = require('events');
const createClient = require('./client');

/**
 * Return a bus listener with helper methods to register listeners and listen to the bus' messages
 * The instance inherits EventEmitter and can emit following events :
 * - connected : when the listener is connected to the bus, takes no arguments
 *
 * @return {Object} bus listener instance
 */
function createListener(url) {
  const queues = [];
  const handlers = {};

  const instance = Object.create(EventEmitter.prototype);
  instance.queues = queues;
  instance.handlers = handlers;
  instance.on = on;
  instance.listen = co.wrap(listen);
  instance.connection = null;
  instance.client = null;
  return instance;

  /**
   * Register a new handler for a given queue and key
   * @param {String} queue Queue
   * @param {String} key Key
   * @param {Function} handler Handler
   */
  function on(queue, key, handler) {
    if (!handlers[queue]) {
      queues.push(queue);
      handlers[queue] = {};
    }
    handlers[queue][key] = handler;
  }

  /**
   * Start listening on registered handlers.
   * You should not override an existing handler after listen
   *
   * @param {String} exchange Exchange name
   */
  function* listen(exchange) {
    if (instance.connection) return instance.connection;
    instance.connection = yield createClient(url);
    instance.client = yield instance.connection;
    instance.emit('connect');

    instance.client.on('error', (err, metadata) => instance.emit('handle_error', err, metadata));

    for (const queue of queues) {
      for (const key of Object.keys(handlers[queue])) {
        yield instance.client.setupQueue(exchange, queue, key);
      }
      yield instance.client.consume(queue, createConsumeHandler(queue));
    }
  }

  function createConsumeHandler(queue) {
    return (message, fields) => {
      let handler = handlers[queue][fields.routingKey];
      if (!handler) {
        handler = () => Promise.resolve();
        instance.emit('unhandle', queue, message, fields);
      }
      return co.wrap(handler)(message, fields);
    };
  }
}

module.exports = createListener;