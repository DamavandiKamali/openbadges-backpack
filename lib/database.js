var configuration = require('./configuration')
  , mongo = require('mongodb')
  , conf = configuration.get('database')
  , EventEmitter = require('events').EventEmitter

var server = new mongo.Server(conf.host, conf.port, {});
var conn = new mongo.Db(conf.name, server, {})

// action buffer -- used to buffer commands before we open the connection
var actions = new EventEmitter();
actions.setMaxListeners(1);
actions.__buf = []
actions.push = function(act){
  this.__buf.push(act);
  this.emit('queue', act, this.__buf);
}
actions.flush = function(){
  var ret = this.__buf;
  this.__buf = []
  return ret;
}

// make a really thin wrapper around client and collection methods
function Client() { }
Client.prototype.command = function() {
  var args = Array.prototype.slice.call(arguments)
    , command = args.shift();
  actions.push(function(client){
    client[command].apply(client, args);
  });
}
Client.prototype.collection = function(name, callback) {
  this.command('collection', name, callback);
}


function Collection(name) {
  this.name = name;
  this.client = new Client();
}
Collection.prototype.command = function() {
  var args = Array.prototype.slice.call(arguments)
    , command = args.shift();
  this.client.collection(this.name, function(err, col){
    if (err) throw err;
    col[command].apply(col, args);
  });
}
Collection.prototype.insert = function(data, opts, callback) {
  if ('function' === typeof opts) callback = opts, opts = {};
  this.command('insert', data, callback);
}
Collection.prototype.update = function(selector, data, opts, callback) {
  if ('function' === typeof opts) callback = opts, opts = {};
  this.command('update', selector, data, opts, callback);
}
// really annoying that upserting doesn't return the doc
Collection.prototype.upsert = function(selector, data, callback) {
  this.update(selector, data, {upsert: true}, callback);
}
Collection.prototype.remove = function(selector, opts, callback) {
  if ('function' === typeof opts) callback = opts, opts = {};
  this.command('remove', selector, callback);
}
// `find` just had to go and be different, didn't it.
Collection.prototype.find = function(query, opts, callback) {
  if ('function' === typeof opts) callback = opts, opts = {};
  this.client.collection(this.name, function(err, col){
    if (err) throw err;
    col.find(query, opts).toArray(callback);
  });
}

// *side effect of requiring*
// open a connection to the database, flush all buffered commands
conn.open(function(err, client) {
  if (err) throw err;
  function execAction(action) {
    return action(client);
  }
  // first flush buffer.
  actions.flush().forEach(execAction)
  // then listen on queues.
  actions.on('queue', execAction);
});

exports.collection = function(name) { return new Collection(name); }
exports.client = new Client();
exports.connection = conn;
exports.using = conn.databaseName;
exports.ObjectID = conn.bson_serializer.ObjectID;