const WebSocket = require('ws')
const http = require('http');
const express = require('express');
const TransparentJSONSocket = require('./lib/server/socket');
const Sync9Server = require('./lib/server/sync9_server');
const ShareDBServer = require('./lib/server/sharedb_server');
const port = 1200;

var backend = new Sync9Server(startServer);

function startServer() {
  // Create a web server to serve files and listen to WebSocket connections
  // Connect any incoming WebSocket connection to the server
  var wss = new WebSocket.Server({port: port});
  wss.on('connection', function(ws) {
    var stream = new TransparentJSONSocket(ws);
    backend.listen(stream);
  });

  server.listen(port);
  console.log(`Listening on http://localhost:${port}`);
}