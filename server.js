const WebSocket = require('ws')
const TransparentJSONSocket = require('./lib/server/socket');
const Sync9Server = require('./lib/server/sync9_server');
const port = 1200;
const path = '/interoperability'
var backend = new Sync9Server(startServer);

function startServer() {
  // Create a web server to serve files and listen to WebSocket connections
  // Connect any incoming WebSocket connection to the server
  var wss = new WebSocket.Server({port: port, path: path});
  wss.on('connection', function(ws) {
    var stream = new TransparentJSONSocket(ws);
    backend.listen(stream);
  });

  console.log(`Listening on http://localhost${path}:${port}`);
}