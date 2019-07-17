const WebSocket = require('ws')
const TransparentJSONSocket = require('./lib/server/socket');
const Sync9Server = require('./lib/server/sync9_server');
const https = require('https');
const express = require('express');
const port = 1200;
const path = '/interoperability';
const fs = require('fs');
var backend = new Sync9Server(startServer);

function startServer() {
  // Create a web server to serve files and listen to WebSocket connections
  var app = express();
  app.use(path, express.static('static'));
  var server = https.createServer({
    key: fs.readFileSync('/etc/letsencrypt/live/invisible.college/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/invisible.college/cert.pem'),

  }, app);
  // Connect any incoming WebSocket connection to the server
  var wss = new WebSocket.Server({server: server});
  wss.on('connection', function(ws) {
    var stream = new TransparentJSONSocket(ws);
    backend.listen(stream);
  });

  server.listen(port, () => console.log(`Listening on http://localhost:${port}${path}:`));
}